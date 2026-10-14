/**
 * Browser-side session against the SFU (see lib/sfu.ts).
 *
 * Mesh calling opens a PeerConnection per participant, so every person uploads
 * a full copy of their media to everyone else — which is why mesh calls fall
 * apart around four people. Here each participant owns exactly ONE
 * PeerConnection to the SFU: local tracks are pushed once, and every remote
 * participant's tracks are pulled down over the same connection.
 *
 * All SFU API calls go through /api/sfu (the app secret never reaches the
 * browser), authenticated with the caller's signed room token and, for
 * mutations, an owner handle minted when the session was created.
 *
 * WebRTC renegotiations must not overlap on a single connection, so every
 * operation that touches the SDP runs through a serial queue. Every queued
 * operation is guaranteed to settle (waiters are cancellable and time-boxed),
 * because a single wedged operation would freeze the whole queue.
 */

import { deriveSessionKey, protectReceiver, protectSender } from "@/lib/e2ee";

export type PublishedTrack = { trackName: string; kind: "audio" | "video" };

/**
 * Simulcast: the camera is encoded three times at descending quality and the
 * SFU forwards whichever layer each receiver asked for. Rids are named a > b > c
 * because the SFU's "asciibetical" fallback treats 'a' as most desirable.
 */
const SIMULCAST_LAYERS: RTCRtpEncodingParameters[] = [
  { rid: "a", maxBitrate: 1_200_000 },
  { rid: "b", maxBitrate: 400_000, scaleResolutionDownBy: 2 },
  { rid: "c", maxBitrate: 120_000, scaleResolutionDownBy: 4 },
];

/** How long to wait for a pulled track's ontrack before giving up on it. */
const PULL_TRACK_TIMEOUT_MS = 10_000;

export class SfuSession {
  private pc: RTCPeerConnection;
  private roomToken: string;
  private ownerToken = "";
  private queue: Promise<unknown> = Promise.resolve();
  private trackWaiters = new Map<string, (track: MediaStreamTrack | null) => void>();
  /** peerId -> mids we pulled for them, so a leaver's tracks can be closed. */
  private midsByPeer = new Map<string, string[]>();
  /** The pulled video track per peer, so its simulcast layer can be retargeted. */
  private videoPullByPeer = new Map<string, { mid: string; trackName: string; remoteSessionId: string }>();
  /** Peers that left mid-pull: their in-flight pull must self-clean, not resurrect. */
  private droppedPeers = new Set<string>();
  /** HKDF base from the link secret; per-sender subkeys are derived from it. */
  private e2eeBaseKey: CryptoKey | null;
  private peerSessionKeys = new Map<string, CryptoKey>();
  private keyByMid = new Map<string, CryptoKey>();
  /** Per-peer chain so layer updates for one peer can never race each other. */
  private layerOps = new Map<string, Promise<void>>();

  private _sessionId = "";
  /** True only once publishing has settled — announcing earlier can broadcast an empty track list. */
  ready = false;
  published: PublishedTrack[] = [];

  /** Empty until the session is created AND publishing has settled (see `ready`). */
  get sessionId() {
    return this.ready ? this._sessionId : "";
  }

  constructor(roomToken: string, iceServers: RTCIceServer[], onConnectionState: (state: RTCPeerConnectionState) => void, e2eeBaseKey: CryptoKey | null = null) {
    this.roomToken = roomToken;
    this.e2eeBaseKey = e2eeBaseKey;
    // Chrome's insertable-streams path must be requested at construction time.
    const config: RTCConfiguration & { encodedInsertableStreams?: boolean } = { iceServers, bundlePolicy: "max-bundle" };
    if (e2eeBaseKey) config.encodedInsertableStreams = true;
    this.pc = new RTCPeerConnection(config);
    this.pc.onconnectionstatechange = () => onConnectionState(this.pc.connectionState);
    this.pc.ontrack = (event) => {
      // In an encrypted room every inbound frame is decrypted client-side with
      // the publisher's session subkey (registered before the pull applies its
      // SDP); a receiver without the key renders nothing — never garbage.
      const frameKey = event.transceiver.mid ? this.keyByMid.get(event.transceiver.mid) : undefined;
      if (frameKey) protectReceiver(event.receiver, frameKey);
      const mid = event.transceiver.mid;
      if (!mid) return;
      const waiter = this.trackWaiters.get(mid);
      if (waiter) {
        this.trackWaiters.delete(mid);
        waiter(event.track);
      }
    };
  }

  private async api<T>(body: Record<string, unknown>): Promise<T> {
    const response = await fetch("/api/sfu", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-room-token": this.roomToken },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error((data as { error?: string })?.error || "The group-call server rejected the request.");
    return data as T;
  }

  /** Serializes SDP-touching work — concurrent renegotiations corrupt the connection. */
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Resolves the pull for `mids`, settling (with null) any track that never arrived. */
  private async awaitTracks(mids: string[]): Promise<MediaStreamTrack[]> {
    const arrivals = mids.map((mid) => new Promise<MediaStreamTrack | null>((resolve) => this.trackWaiters.set(mid, resolve)));
    // A track that never fires ontrack (peer left, SFU hiccup) must not wedge the
    // queue: time out, drop the waiter, and settle with null.
    const timeout = new Promise<Array<MediaStreamTrack | null>>((resolve) => setTimeout(() => {
      for (const mid of mids) this.trackWaiters.delete(mid);
      resolve(mids.map(() => null));
    }, PULL_TRACK_TIMEOUT_MS));
    const settled: Array<MediaStreamTrack | null> = await Promise.race([Promise.all(arrivals), timeout]);
    return (settled || []).filter((track): track is MediaStreamTrack => Boolean(track));
  }

  /**
   * Opens the session and pushes the local tracks. Devices may be absent
   * (no camera, mic denied) — only real tracks are published, and the
   * announcement tells everyone else exactly what exists to pull.
   */
  async connect(stream: MediaStream): Promise<PublishedTrack[]> {
    return this.enqueue(async () => {
      const { sessionId, ownerToken } = await this.api<{ sessionId: string; ownerToken: string }>({ op: "session" });
      this._sessionId = sessionId;
      this.ownerToken = ownerToken;

      const tracks = [
        ...stream.getAudioTracks().map((track) => ({ track, kind: "audio" as const })),
        ...stream.getVideoTracks().map((track) => ({ track, kind: "video" as const })),
      ];

      if (tracks.length > 0) {
        // Our outbound frames are encrypted under a subkey bound to this fresh
        // session id — a new key every join.
        const sendKey = this.e2eeBaseKey ? await deriveSessionKey(this.e2eeBaseKey, sessionId) : null;
        const local = tracks.map(({ track, kind }) => {
          const transceiver = this.pc.addTransceiver(track, {
            direction: "sendonly",
            ...(kind === "video" ? { sendEncodings: SIMULCAST_LAYERS } : {}),
          });
          if (sendKey) protectSender(transceiver.sender, sendKey);
          return { transceiver, trackName: `${kind}-${crypto.randomUUID().slice(0, 8)}`, kind };
        });

        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);

        const response = await this.api<{ sessionDescription: RTCSessionDescriptionInit }>({
          op: "tracks",
          sessionId: this._sessionId,
          ownerToken: this.ownerToken,
          body: {
            sessionDescription: { sdp: this.pc.localDescription!.sdp, type: "offer" },
            tracks: local.map(({ transceiver, trackName }) => ({ location: "local", mid: transceiver.mid, trackName })),
          },
        });
        await this.pc.setRemoteDescription(response.sessionDescription);
        this.published = local.map(({ trackName, kind }) => ({ trackName, kind }));
      }

      // Only now is it safe for the room to hear about us: publishing is done,
      // so the announcement carries the real (possibly empty) track list.
      this.ready = true;
      return this.published;
    });
  }

  /**
   * Pulls one remote participant's tracks into this connection and resolves
   * with a MediaStream for their tile. The SFU answers with an offer of its
   * own, which we complete via the renegotiate endpoint.
   */
  async pullPeer(peerId: string, remoteSessionId: string, tracks: PublishedTrack[], preferredRid = "a"): Promise<MediaStream> {
    this.droppedPeers.delete(peerId); // a fresh pull request supersedes a past drop
    return this.enqueue(async () => {
      if (tracks.length === 0 || this.droppedPeers.has(peerId)) return new MediaStream();

      const response = await this.api<{
        requiresImmediateRenegotiation?: boolean;
        sessionDescription?: RTCSessionDescriptionInit;
        tracks?: Array<{ mid?: string; trackName?: string; errorDescription?: string }>;
      }>({
        op: "tracks",
        sessionId: this._sessionId,
        ownerToken: this.ownerToken,
        body: {
          tracks: tracks.map(({ trackName, kind }) => ({
            location: "remote",
            sessionId: remoteSessionId,
            trackName,
            // Ask for a specific quality layer; fall back down the alphabet
            // when the network or publisher cannot sustain it.
            ...(kind === "video" ? { simulcast: { preferredRid, priorityOrdering: "asciibetical", ridNotAvailable: "asciibetical" } } : {}),
          })),
        },
      });

      const mids = (response.tracks || []).filter((track) => track.mid && !track.errorDescription).map((track) => track.mid as string);

      // Register the publisher's decryption subkey for these mids BEFORE the
      // SDP applies — ontrack fires during setRemoteDescription.
      if (this.e2eeBaseKey) {
        let peerKey = this.peerSessionKeys.get(remoteSessionId);
        if (!peerKey) {
          peerKey = await deriveSessionKey(this.e2eeBaseKey, remoteSessionId);
          this.peerSessionKeys.set(remoteSessionId, peerKey);
        }
        for (const mid of mids) this.keyByMid.set(mid, peerKey);
      }

      // The peer left while this pull was in flight: don't resurrect them.
      // Complete the renegotiation the SFU is waiting on, then close the mids.
      if (this.droppedPeers.has(peerId)) {
        if (response.requiresImmediateRenegotiation && response.sessionDescription) {
          await this.pc.setRemoteDescription(response.sessionDescription);
          const answer = await this.pc.createAnswer();
          await this.pc.setLocalDescription(answer);
          await this.api({ op: "renegotiate", sessionId: this._sessionId, ownerToken: this.ownerToken, body: { sessionDescription: { sdp: answer.sdp, type: "answer" } } });
        }
        if (mids.length > 0) await this.api({ op: "close", sessionId: this._sessionId, ownerToken: this.ownerToken, body: { tracks: mids.map((mid) => ({ mid })), force: true } }).catch(() => undefined);
        return new MediaStream();
      }

      this.midsByPeer.set(peerId, [...(this.midsByPeer.get(peerId) || []), ...mids]);
      const videoName = tracks.find(({ kind }) => kind === "video")?.trackName;
      const videoMid = (response.tracks || []).find((track) => track.trackName === videoName && track.mid)?.mid;
      if (videoName && videoMid) this.videoPullByPeer.set(peerId, { mid: videoMid, trackName: videoName, remoteSessionId });

      // Register waiters BEFORE applying the SFU's offer — ontrack fires during
      // setRemoteDescription, and a late listener would miss the tracks.
      const arrivals = this.awaitTracks(mids);

      if (response.requiresImmediateRenegotiation && response.sessionDescription) {
        await this.pc.setRemoteDescription(response.sessionDescription);
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        await this.api({ op: "renegotiate", sessionId: this._sessionId, ownerToken: this.ownerToken, body: { sessionDescription: { sdp: answer.sdp, type: "answer" } } });
      }

      const stream = new MediaStream();
      for (const track of await arrivals) stream.addTrack(track);
      return stream;
    });
  }

  /**
   * Retargets a peer's pulled video to a different simulcast layer:
   * "a" full, "b" half, "c" quarter. No renegotiation involved. Resolves false
   * when the peer's pull has not completed yet, so the caller keeps trying —
   * a silent no-op here would freeze the peer on their pull-time layer forever.
   * Updates for one peer are chained so they can never land out of order.
   */
  async setPeerLayer(peerId: string, rid: string): Promise<boolean> {
    const pulled = this.videoPullByPeer.get(peerId);
    if (!pulled || !this._sessionId) return false;
    const run = async () => {
      const response = await this.api<{ tracks?: Array<{ errorCode?: string; errorDescription?: string }> }>({
        op: "update",
        sessionId: this._sessionId,
        ownerToken: this.ownerToken,
        body: {
          tracks: [{
            location: "remote",
            sessionId: pulled.remoteSessionId,
            trackName: pulled.trackName,
            mid: pulled.mid,
            simulcast: { preferredRid: rid, priorityOrdering: "asciibetical", ridNotAvailable: "asciibetical" },
          }],
        },
      });
      const rejected = response.tracks?.find((track) => track.errorCode);
      if (rejected) throw new Error(rejected.errorDescription || "The SFU rejected the layer change.");
    };
    const previous = this.layerOps.get(peerId) || Promise.resolve();
    const next = previous.then(run, run);
    this.layerOps.set(peerId, next.catch(() => undefined));
    await next;
    return true;
  }

  /** Stops the data flow for a departed participant's tracks (no renegotiation). */
  async dropPeer(peerId: string) {
    this.droppedPeers.add(peerId);
    this.videoPullByPeer.delete(peerId);
    this.layerOps.delete(peerId);
    for (const mid of this.midsByPeer.get(peerId) || []) this.keyByMid.delete(mid);
    const mids = this.midsByPeer.get(peerId) || [];
    this.midsByPeer.delete(peerId);
    // Settle (not delete) any waiter still pending for this peer, so a pull
    // in flight resolves instead of hanging the serial queue forever.
    for (const mid of mids) {
      const waiter = this.trackWaiters.get(mid);
      if (waiter) { this.trackWaiters.delete(mid); waiter(null); }
      // Retire the local recvonly transceiver too, so its m-line is reclaimed at
      // the next renegotiation instead of accumulating over many join/leave cycles.
      const transceiver = this.pc.getTransceivers().find((candidate) => candidate.mid === mid);
      try { transceiver?.stop(); } catch { /* older engines: harmless, m-line just lingers */ }
    }
    if (mids.length === 0 || !this._sessionId) return;
    try {
      await this.enqueue(() => this.api({
        op: "close",
        sessionId: this._sessionId,
        ownerToken: this.ownerToken,
        body: { tracks: mids.map((mid) => ({ mid })), force: true },
      }));
    } catch {
      // The tracks go silent on their own once the publisher is gone.
    }
  }

  /** Swap what the camera slot is sending (camera <-> screen) without renegotiating. */
  async replaceVideoTrack(track: MediaStreamTrack | null) {
    const sender = this.pc.getSenders().find((candidate) => candidate.track?.kind === "video");
    await sender?.replaceTrack(track);
  }

  close() {
    // Settle every pending waiter so no awaiting queue operation is left hanging.
    for (const waiter of Array.from(this.trackWaiters.values())) waiter(null);
    this.trackWaiters.clear();
    this.midsByPeer.clear();
    this.videoPullByPeer.clear();
    this.droppedPeers.clear();
    this.peerSessionKeys.clear();
    this.keyByMid.clear();
    this.layerOps.clear();
    this.pc.close();
  }
}
