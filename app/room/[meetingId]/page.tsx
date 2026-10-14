"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Copy, Disc, Focus, LayoutGrid, LoaderCircle, MessageCircle, Mic, MicOff, MonitorUp, PhoneOff, Radio, Send, ShieldCheck, UserPlus, Users, Video, VideoOff, X } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { requestJson } from "@/lib/client-api";
import { formatTimeLimit, initialsOf } from "@/lib/format";
import { SfuSession, type PublishedTrack } from "@/lib/sfu-client";
import { deriveRoomBaseKey, generateRoomKeySecret, roomKeySecretFromLocation, supportsE2EE } from "@/lib/e2ee";

type PeerInfo = { peerId: string; userId: string; name: string };
type RemotePeer = PeerInfo & { stream: MediaStream | null };
type ChatMessage = { messageId: string; from: string; name: string; text: string; sentAt: string; to?: string; isPrivate?: boolean };
type RoomData = { token: string; wsUrl: string; iceServers: RTCIceServer[]; hasTurn?: boolean; sfuEnabled?: boolean; timeLimit?: { minutes: number; endsAt: string } | null; meeting: { id: string; title: string } };
type RoomContact = { id: string; name: string; username: string };

export default function MeetingRoomPage() {
  const params = useParams<{ meetingId: string }>();
  const router = useRouter();
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef(new Map<string, RTCPeerConnection>());
  const peerDirectoryRef = useRef(new Map<string, PeerInfo>());
  const pendingCandidatesRef = useRef(new Map<string, RTCIceCandidateInit[]>());
  const intentionallyLeavingRef = useRef(false);
  const isChatOpenRef = useRef(false);
  const selfIdRef = useRef("");
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);
  const remoteStreamsRef = useRef(new Map<string, MediaStream>());
  const avStateRef = useRef({ camera: true, mic: true });
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const recordRafRef = useRef(0);
  const recordTimerRef = useRef(0);
  const recordStartRef = useRef(0);
  const recordAudioContextRef = useRef<AudioContext | null>(null);
  const roomToastTimerRef = useRef(0);
  // The socket handlers are created once at mount, so they must read the room
  // through a ref — the `room` state they close over is the first render's null,
  // which used to make createPeerConnection bail before creating any connection.
  const roomRef = useRef<RoomData | null>(null);
  // Group calls run through the SFU when the server has credentials for one:
  // one connection per participant instead of a mesh, so calls scale past four.
  const sfuRef = useRef<SfuSession | null>(null);
  const pulledPeersRef = useRef(new Set<string>());
  // Socket identities we held before reconnects — a half-open old "us" can
  // still appear in the server's room-state until it times out.
  const priorSelfIdsRef = useRef(new Set<string>());
  const [room, setRoom] = useState<RoomData | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remotePeers, setRemotePeers] = useState<RemotePeer[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageText, setMessageText] = useState("");
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isMicEnabled, setIsMicEnabled] = useState(false);
  const [isCameraEnabled, setIsCameraEnabled] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [shareInfo, setShareInfo] = useState<{ surface: string; label: string } | null>(null);
  const [presentingPeerIds, setPresentingPeerIds] = useState<string[]>([]);
  const [peerAvState, setPeerAvState] = useState<Record<string, { camera: boolean; mic: boolean }>>({});
  const [peerConnState, setPeerConnState] = useState<Record<string, string>>({});
  const [chatTarget, setChatTarget] = useState("everyone");
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [contacts, setContacts] = useState<RoomContact[]>([]);
  const [invitedIds, setInvitedIds] = useState<string[]>([]);
  const [invitingId, setInvitingId] = useState("");
  const [recordingState, setRecordingState] = useState<"idle" | "recording" | "uploading">("idle");
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [roomToast, setRoomToast] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [hasEnded, setHasEnded] = useState(false);
  // Set to the room's limit in minutes once an optional time limit runs out.
  const [timeUpMinutes, setTimeUpMinutes] = useState<number | null>(null);
  const [isConnecting, setIsConnecting] = useState(true);
  const [layout, setLayout] = useState<"grid" | "spotlight">("grid");
  const [isE2ee, setIsE2ee] = useState(false);
  // The simulcast layer each peer's video was last asked to deliver.
  const lastLayerRef = useRef(new Map<string, string>());
  // "self" or a peerId for everyone currently producing audible sound.
  const [speakingIds, setSpeakingIds] = useState<string[]>([]);
  // The most recent remote speaker — keeps the spotlight from falling back to
  // an arbitrary tile every time the current speaker pauses for breath.
  const [lastSpeakerId, setLastSpeakerId] = useState("");

  function showRoomToast(message: string) {
    setRoomToast(message);
    window.clearTimeout(roomToastTimerRef.current);
    roomToastTimerRef.current = window.setTimeout(() => setRoomToast(null), 3600);
  }

  async function copyInviteLink() {
    const link = window.location.href;
    let copied = false;
    try {
      await Promise.race([
        navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject(new Error("unavailable")),
        new Promise((_, reject) => window.setTimeout(() => reject(new Error("timeout")), 1500)),
      ]);
      copied = true;
    } catch {}
    if (!copied) {
      try {
        const helper = document.createElement("textarea");
        helper.value = link;
        document.body.appendChild(helper);
        helper.select();
        copied = document.execCommand("copy");
        helper.remove();
      } catch {}
    }
    showRoomToast(copied ? "Room link copied — anyone with it can join" : `Copy this link to invite: ${link}`);
  }

  async function openInvitePanel() {
    setIsInviteOpen((current) => !current);
    if (contacts.length > 0) return;
    try {
      const data = await requestJson<{ contacts?: RoomContact[] }>("/api/contacts");
      setContacts(data.contacts || []);
    } catch {
      // The invite list just stays empty; the copy-link path still works.
    }
  }

  async function inviteContact(contact: RoomContact) {
    if (isE2ee) {
      showRoomToast("This room is encrypted — share the room link instead; it carries the key");
      return;
    }
    setInvitingId(contact.id);
    try {
      await requestJson("/api/calls", {
        method: "POST",
        body: { toUserId: contact.id, meetingId: params.meetingId },
        fallbackError: `We could not invite ${contact.name}`,
      });
      setInvitedIds((current) => [...current, contact.id]);
      showRoomToast(`Ringing ${contact.name.split(" ")[0]}...`);
    } catch (inviteError) {
      showRoomToast(inviteError instanceof Error ? inviteError.message : `We could not invite ${contact.name}`);
    } finally {
      setInvitingId("");
    }
  }

  function sendSignal(message: Record<string, unknown>) {
    if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify(message));
  }

  /** Tells the room which SFU session and tracks are ours, so peers can pull them. */
  function announceSfu() {
    const sfu = sfuRef.current;
    if (sfu?.sessionId) sendSignal({ type: "sfu-state", sessionId: sfu.sessionId, tracks: sfu.published });
  }

  /** Pulls a newly announced participant's tracks down through our SFU connection. */
  function pullSfuPeer(from: string, remoteSessionId: string, tracks: PublishedTrack[]) {
    const sfu = sfuRef.current;
    if (!sfu) return;
    const peer = peerDirectoryRef.current.get(from) || { peerId: from, userId: "", name: "Guest" };
    // A device-less join announces zero tracks: mark it connected but DON'T
    // consume the peer, so a later announcement carrying real tracks still pulls
    // (guards against an announcement that arrives before publishing settled).
    if (tracks.length === 0) {
      setPeerConnState((current) => ({ ...current, [from]: "connected" }));
      return;
    }
    if (pulledPeersRef.current.has(from)) return;
    pulledPeersRef.current.add(from);
    setPeerConnState((current) => ({ ...current, [from]: "connecting" }));
    const initialRid = remoteStreamsRef.current.size < 2 ? "a" : "b";
    lastLayerRef.current.set(from, initialRid);
    sfu.pullPeer(from, remoteSessionId, tracks, initialRid)
      .then((stream) => {
        // The peer left while we were pulling — don't re-add a ghost tile, and
        // release whatever media did arrive (dropPeer closes the SFU tracks).
        if (!pulledPeersRef.current.has(from)) {
          stream.getTracks().forEach((track) => track.stop());
          void sfu.dropPeer(from);
          return;
        }
        remoteStreamsRef.current.set(from, stream);
        updatePeer(peer, stream);
        setPeerConnState((current) => ({ ...current, [from]: "connected" }));
      })
      .catch(() => {
        // Allow a later announcement to retry the pull.
        pulledPeersRef.current.delete(from);
        setPeerConnState((current) => ({ ...current, [from]: "failed" }));
      });
  }

  function updatePeer(peer: PeerInfo, stream: MediaStream | null) {
    setRemotePeers((current) => {
      const found = current.find((item) => item.peerId === peer.peerId);
      if (found) return current.map((item) => item.peerId === peer.peerId ? { ...item, ...peer, stream: stream || item.stream } : item);
      return [...current, { ...peer, stream }];
    });
  }

  function removePeer(peerId: string) {
    void sfuRef.current?.dropPeer(peerId);
    pulledPeersRef.current.delete(peerId);
    lastLayerRef.current.delete(peerId);
    peersRef.current.get(peerId)?.close();
    peersRef.current.delete(peerId);
    peerDirectoryRef.current.delete(peerId);
    pendingCandidatesRef.current.delete(peerId);
    remoteStreamsRef.current.delete(peerId);
    setRemotePeers((current) => current.filter((peer) => peer.peerId !== peerId));
    setPresentingPeerIds((current) => current.filter((id) => id !== peerId));
    setPeerAvState((current) => { const next = { ...current }; delete next[peerId]; return next; });
    setPeerConnState((current) => { const next = { ...current }; delete next[peerId]; return next; });
  }

  async function createPeerConnection(peer: PeerInfo, shouldOffer: boolean) {
    const currentRoom = roomRef.current;
    if (!currentRoom || !localStreamRef.current) return null;
    const existing = peersRef.current.get(peer.peerId);
    if (existing) return existing;

    peerDirectoryRef.current.set(peer.peerId, peer);
    const connection = new RTCPeerConnection({ iceServers: currentRoom.iceServers });
    peersRef.current.set(peer.peerId, connection);

    // Always negotiate one video and one audio slot, even when this device has no
    // camera or mic. Without a receive-only slot the other side has nowhere to send
    // its media, which silently makes the call one-way.
    const outgoingVideo = screenTrackRef.current || localStreamRef.current.getVideoTracks()[0] || null;
    const outgoingAudio = localStreamRef.current.getAudioTracks()[0] || null;
    if (outgoingVideo) connection.addTransceiver(outgoingVideo, { direction: "sendrecv", streams: [localStreamRef.current] });
    else connection.addTransceiver("video", { direction: "recvonly" });
    if (outgoingAudio) connection.addTransceiver(outgoingAudio, { direction: "sendrecv", streams: [localStreamRef.current] });
    else connection.addTransceiver("audio", { direction: "recvonly" });
    connection.onicecandidate = (event) => {
      if (event.candidate) sendSignal({ type: "ice-candidate", to: peer.peerId, payload: event.candidate.toJSON() });
    };
    connection.ontrack = (event) => {
      const inbound = remoteStreamsRef.current.get(peer.peerId) || new MediaStream();
      if (!inbound.getTracks().some((track) => track.id === event.track.id)) inbound.addTrack(event.track);
      remoteStreamsRef.current.set(peer.peerId, inbound);
      event.track.onunmute = () => updatePeer(peer, inbound);
      updatePeer(peer, inbound);
    };
    connection.onconnectionstatechange = () => {
      setPeerConnState((current) => ({ ...current, [peer.peerId]: connection.connectionState }));
      // A failed connection means ICE found no usable network path — almost always
      // a missing TURN relay. Surface it instead of leaving a silent black tile.
      if (connection.connectionState === "failed") showRoomToast("Could not connect media to this person — a TURN relay is needed on this network");
      if (["failed", "closed"].includes(connection.connectionState)) removePeer(peer.peerId);
    };

    if (shouldOffer) {
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      sendSignal({ type: "offer", to: peer.peerId, payload: connection.localDescription });
    }
    return connection;
  }

  useEffect(() => {
    let cancelled = false;
    let reconnectAttempts = 0;
    let reconnectTimer = 0;
    // A fresh mount is a fresh intent to be here: the previous cleanup (or
    // StrictMode's dev double-mount) left this ref true, which would otherwise
    // make the new socket close itself the moment it opens.
    intentionallyLeavingRef.current = false;
    // These instances never change, so capturing them satisfies the linter's
    // "ref may differ at cleanup" concern while meaning the same thing.
    const peers = peersRef.current;
    const pulledPeers = pulledPeersRef.current;
    async function connectRoom() {
      try {
        const roomResponse = await fetch("/api/realtime/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ meetingId: params.meetingId }) });
        const data = await roomResponse.json();
        if (roomResponse.status === 410) { if (!cancelled) { if (data.timeLimitReached) setTimeUpMinutes(Number(data.minutes) || 0); else setHasEnded(true); setError(data.error || "This meeting has ended."); } return; }
        if (!roomResponse.ok) throw new Error(data.error || "Unable to open this meeting.");
        if (cancelled) return;
        roomRef.current = data;
        setRoom(data);

        // Explicit processing constraints: browser noise suppression, echo
        // cancellation, and auto gain — the "clean audio" defaults the big
        // meeting apps rely on.
        const audioConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
        let stream: MediaStream | null = null;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: audioConstraints });
        } catch {
          try {
            stream = await navigator.mediaDevices.getUserMedia({ video: true });
          } catch {
            try {
              stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
            } catch {
              stream = new MediaStream();
            }
          }
        }
        if (cancelled) { stream.getTracks().forEach((track) => track.stop()); return; }
        const preferences = readAvPreferences();
        stream.getVideoTracks().forEach((track) => { track.enabled = preferences.camera; });
        stream.getAudioTracks().forEach((track) => { track.enabled = preferences.mic; });
        avStateRef.current = preferences;
        setIsCameraEnabled(preferences.camera);
        setIsMicEnabled(preferences.mic);
        localStreamRef.current = stream;
        setLocalStream(stream);
        // An encrypted room link carries its key in the URL fragment — the one
        // part of a URL browsers never send to any server.
        const keySecret = roomKeySecretFromLocation();
        let e2eeKey: CryptoKey | null = null;
        if (keySecret && data.sfuEnabled) {
          if (!supportsE2EE()) {
            stream.getTracks().forEach((track) => track.stop());
            setError("This room is end-to-end encrypted and this browser does not support it. Try Chrome, Edge, or Safari.");
            return;
          }
          e2eeKey = await deriveRoomBaseKey(keySecret);
        }
        // In mesh mode media is direct peer-to-peer DTLS — end-to-end by nature.
        setIsE2ee(Boolean(keySecret));
        if (data.sfuEnabled) {
          const sfu = new SfuSession(data.token, data.iceServers, (state) => {
            if (state === "failed") showRoomToast("The media connection failed — check your network and reload");
          }, e2eeKey);
          sfuRef.current = sfu;
          // Publishing runs in parallel with the socket handshake; the room is
          // told about our tracks as soon as both are ready.
          sfu.connect(stream)
            .then(() => announceSfu())
            .catch(() => showRoomToast("Could not join group media — others may not see or hear you"));
        }
        openSocket(data);
      } catch (requestError) {
        if (!cancelled) { stopAllMedia(); setError(requestError instanceof Error ? requestError.message : "Unable to open this meeting."); }
      }
    }

    /**
     * Terminal teardown: the error/ended screens hide every control, so the
     * camera and mic must never stay hot behind them.
     */
    function stopAllMedia() {
      screenTrackRef.current?.stop();
      screenTrackRef.current = null;
      sfuRef.current?.close();
      sfuRef.current = null;
      peers.forEach((peer) => peer.close());
      peers.clear();
      remoteStreamsRef.current.clear();
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
    }

    function scheduleReconnect() {
      if (cancelled || intentionallyLeavingRef.current) return;
      if (reconnectAttempts >= 6) {
        stopAllMedia();
        setError("The realtime signaling server disconnected.");
        return;
      }
      reconnectAttempts += 1;
      showRoomToast("Connection lost — reconnecting...");
      reconnectTimer = window.setTimeout(() => { void reconnect(); }, Math.min(1000 * 2 ** reconnectAttempts, 8000));
    }

    async function reconnect() {
      if (cancelled || intentionallyLeavingRef.current) return;
      try {
        const response = await fetch("/api/realtime/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ meetingId: params.meetingId }) });
        const data = await response.json();
        if (response.status === 410) { stopAllMedia(); if (data.timeLimitReached) setTimeUpMinutes(Number(data.minutes) || 0); else setHasEnded(true); setError(data.error || "This meeting has ended."); return; }
        if (!response.ok) throw new Error();
        if (cancelled || intentionallyLeavingRef.current) return;
        roomRef.current = data;
        // Remember the identity the old socket had: the server may still list
        // it in room-state until the half-open connection times out.
        if (selfIdRef.current) priorSelfIdsRef.current.add(selfIdRef.current);
        // Mesh connections are tied to our old socket identity — peers rebuild
        // them against our new one. SFU media rides its own connection to
        // the SFU and survives the signaling drop untouched.
        if (!sfuRef.current) {
          peers.forEach((peer) => peer.close());
          peers.clear();
          pendingCandidatesRef.current.clear();
          remoteStreamsRef.current.clear();
          peerDirectoryRef.current.clear();
          setRemotePeers([]);
          setPeerConnState({});
          setPeerAvState({});
          setPresentingPeerIds([]);
        }
        openSocket(data);
      } catch {
        scheduleReconnect();
      }
    }

    function openSocket(data: RoomData) {
        const socket = new WebSocket(`${data.wsUrl}${data.wsUrl.includes("?") ? "&" : "?"}token=${encodeURIComponent(data.token)}`);
        socketRef.current = socket;
        // announceSfu runs after BOTH the join and the SFU publish — whichever
        // finishes last actually sends (the early call no-ops: sessionId empty
        // or socket not open). Without this, a publish that beats the socket
        // handshake would drop its announcement and leave this peer invisible.
        socket.onopen = () => {
          if (cancelled || intentionallyLeavingRef.current) { socket.close(); return; }
          setIsConnecting(false);
          sendSignal({ type: "join" });
          // Everyone re-learns our current state — on first join AND reconnects.
          sendSignal({ type: "av-state", camera: avStateRef.current.camera, mic: avStateRef.current.mic });
          if (screenTrackRef.current) sendSignal({ type: "screen-share", active: true });
          announceSfu();
        };
        socket.onmessage = async (event) => {
          const message = JSON.parse(event.data) as { type: string; selfId?: string; participants?: PeerInfo[]; peerId?: string; userId?: string; name?: string; from?: string; payload?: RTCSessionDescriptionInit | RTCIceCandidateInit; text?: string; messageId?: string; sentAt?: string; active?: boolean; to?: string; isPrivate?: boolean; camera?: boolean; mic?: boolean; sessionId?: string; tracks?: PublishedTrack[] };
          if (message.type === "room-state") {
            // Only the server sends room-state, and only after it accepted our
            // token and join — the session is proven, so retries reset here
            // (resetting in onopen let a handshake-then-reject loop run forever).
            if (reconnectAttempts > 0) showRoomToast("Reconnected");
            reconnectAttempts = 0;
            selfIdRef.current = message.selfId || "";
            // room-state is the authoritative roster: drop anyone who left while
            // our socket was down, and any half-open ghost of our former self.
            const alive = new Set((message.participants || []).map((participant) => participant.peerId));
            for (const peerId of Array.from(peerDirectoryRef.current.keys())) {
              if (!alive.has(peerId)) removePeer(peerId);
            }
            setPresentingPeerIds((current) => current.filter((id) => alive.has(id)));
            for (const participant of message.participants || []) {
              if (priorSelfIdsRef.current.has(participant.peerId)) continue;
              peerDirectoryRef.current.set(participant.peerId, participant);
              updatePeer(participant, null);
              // In SFU mode media flows via the SFU — existing peers announce
              // their tracks to us in response to our peer-joined broadcast.
              if (!sfuRef.current) await createPeerConnection(participant, true);
            }
          }
          if (message.type === "peer-joined" && message.peerId && message.name) {
            const peer = { peerId: message.peerId, userId: message.userId || "", name: message.name };
            peerDirectoryRef.current.set(peer.peerId, peer);
            updatePeer(peer, null);
            sendSignal({ type: "av-state", camera: avStateRef.current.camera, mic: avStateRef.current.mic });
            if (screenTrackRef.current) sendSignal({ type: "screen-share", active: true });
            announceSfu();
          }
          if (message.type === "sfu-state" && message.from && message.sessionId) {
            pullSfuPeer(message.from, message.sessionId, Array.isArray(message.tracks) ? message.tracks : []);
          }
          if (message.type === "offer" && message.from && message.payload && !sfuRef.current) {
            const peer = peerDirectoryRef.current.get(message.from) || { peerId: message.from, userId: "", name: "Guest" };
            const connection = await createPeerConnection(peer, false);
            if (!connection) return;
            await connection.setRemoteDescription(message.payload as RTCSessionDescriptionInit);
            const queued = pendingCandidatesRef.current.get(message.from) || [];
            for (const candidate of queued) await connection.addIceCandidate(candidate);
            pendingCandidatesRef.current.delete(message.from);
            const answer = await connection.createAnswer();
            await connection.setLocalDescription(answer);
            sendSignal({ type: "answer", to: message.from, payload: connection.localDescription });
          }
          if (message.type === "answer" && message.from && message.payload && !sfuRef.current) {
            const connection = peersRef.current.get(message.from);
            if (connection) {
              await connection.setRemoteDescription(message.payload as RTCSessionDescriptionInit);
              const queued = pendingCandidatesRef.current.get(message.from) || [];
              for (const candidate of queued) await connection.addIceCandidate(candidate);
              pendingCandidatesRef.current.delete(message.from);
            }
          }
          if (message.type === "ice-candidate" && message.from && message.payload && !sfuRef.current) {
            const connection = peersRef.current.get(message.from);
            if (connection?.remoteDescription) await connection.addIceCandidate(message.payload as RTCIceCandidateInit);
            else pendingCandidatesRef.current.set(message.from, [...(pendingCandidatesRef.current.get(message.from) || []), message.payload as RTCIceCandidateInit]);
          }
          if (message.type === "screen-share" && message.from) {
            const from = message.from;
            setPresentingPeerIds((current) => message.active ? (current.includes(from) ? current : [...current, from]) : current.filter((id) => id !== from));
          }
          if (message.type === "av-state" && message.from) {
            const from = message.from;
            setPeerAvState((current) => ({ ...current, [from]: { camera: Boolean(message.camera), mic: Boolean(message.mic) } }));
          }
          if (message.type === "encrypted-restart" && message.from) {
            // The room's key changed under us. Our media cannot survive it —
            // stop everything and point at the only fix: the new link.
            intentionallyLeavingRef.current = true;
            stopAllMedia();
            socketRef.current?.close();
            setError("This room was restarted end-to-end encrypted. Ask the person who restarted it for the new room link.");
          }
          if (message.type === "peer-left" && message.peerId) removePeer(message.peerId);
          if (message.type === "chat" && message.messageId && message.name && message.text) {
            setMessages((current) => [...current, { messageId: message.messageId as string, from: message.from || "", name: message.name as string, text: message.text as string, sentAt: message.sentAt || new Date().toISOString(), to: message.to, isPrivate: message.isPrivate }]);
            if (!isChatOpenRef.current && message.from !== selfIdRef.current) setUnreadCount((current) => current + 1);
          }
        };
        // A dropped socket recovers on its own; onclose drives the retries.
        socket.onerror = () => {};
        socket.onclose = (event) => {
          if (intentionallyLeavingRef.current || cancelled) return;
          // 1008 = the server rejected our token; retrying with the same
          // credentials would loop forever.
          if (event.code === 1008) {
            stopAllMedia();
            setError("This room session is no longer valid. Go back and rejoin the meeting.");
            return;
          }
          scheduleReconnect();
        };
    }
    connectRoom();
    return () => {
      cancelled = true;
      intentionallyLeavingRef.current = true;
      if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
      window.clearInterval(recordRafRef.current);
      window.clearInterval(recordTimerRef.current);
      window.clearTimeout(roomToastTimerRef.current);
      window.clearTimeout(reconnectTimer);
      recordAudioContextRef.current?.close().catch(() => {});
      screenTrackRef.current?.stop();
      socketRef.current?.close();
      sfuRef.current?.close();
      sfuRef.current = null;
      pulledPeers.clear();
      peers.forEach((peer) => peer.close());
      peers.clear();
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
    // The socket and its handlers are deliberately created once per meeting;
    // re-running on every render would tear the call down mid-conversation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.meetingId]);

  useEffect(() => {
    if (localVideoRef.current && localStream) localVideoRef.current.srcObject = localStream;
  }, [localStream]);

  // With MEETING_TIME_LIMIT_MINUTES set, rooms stop after that long: two gentle
  // reminders, then a friendly stop. Without it the room carries no timeLimit
  // and none of this runs.
  useEffect(() => {
    const limit = room?.timeLimit;
    if (!limit) return;
    const endsAt = new Date(limit.endsAt).getTime();
    if (!Number.isFinite(endsAt)) return;
    const timers: number[] = [];
    const remind = (msBefore: number, label: string) => {
      const delay = endsAt - msBefore - Date.now();
      if (delay > 0) timers.push(window.setTimeout(() => showRoomToast(`This meeting ends in ${label}`), delay));
    };
    remind(15 * 60 * 1000, "15 minutes");
    remind(5 * 60 * 1000, "5 minutes");
    const untilEnd = endsAt - Date.now();
    timers.push(window.setTimeout(() => {
      intentionallyLeavingRef.current = true;
      sendSignal({ type: "leave" });
      setTimeUpMinutes(limit.minutes);
    }, Math.max(untilEnd, 0)));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- driven by the room payload only
  }, [room]);

  // Active-speaker detection: sample every participant's audio level a few
  // times a second and tag whoever is above the noise floor. Muted tracks
  // produce silence, so they fall out naturally.
  useEffect(() => {
    if (!room) return;
    const audioContext = new AudioContext();
    const monitors = new Map<string, { stream: MediaStream; source: MediaStreamAudioSourceNode; analyser: AnalyserNode }>();
    const lastLoudAt = new Map<string, number>();
    const sample = new Uint8Array(512);
    // How long someone stays "speaking" after their last loud sample — natural
    // pauses between words must not make the highlight (or spotlight) flap.
    const HOLD_MS = 1200;

    function detach(key: string) {
      const entry = monitors.get(key);
      if (!entry) return;
      try { entry.source.disconnect(); } catch { /* already gone */ }
      monitors.delete(key);
      lastLoudAt.delete(key);
    }

    function attach(key: string, stream: MediaStream | null) {
      if (!stream || stream.getAudioTracks().length === 0) return;
      if (monitors.get(key)?.stream === stream) return;
      detach(key); // the stream was replaced — release the old audio nodes
      try {
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 512;
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);
        monitors.set(key, { stream, source, analyser });
      } catch {
        // The stream may be mid-teardown; the next tick retries.
      }
    }

    const timer = window.setInterval(() => {
      // Autoplay policy can start the context suspended; resuming is idempotent.
      void audioContext.resume().catch(() => {});
      // Departed peers must stop being polled (and their nodes released).
      for (const key of Array.from(monitors.keys())) {
        if (key !== "self" && !remoteStreamsRef.current.has(key)) detach(key);
      }
      attach("self", localStreamRef.current);
      remoteStreamsRef.current.forEach((stream, peerId) => attach(peerId, stream));
      const now = Date.now();
      const speaking: string[] = [];
      monitors.forEach(({ analyser }, key) => {
        analyser.getByteTimeDomainData(sample);
        let sum = 0;
        for (let i = 0; i < sample.length; i += 1) { const deviation = sample[i] - 128; sum += deviation * deviation; }
        if (Math.sqrt(sum / sample.length) > 8) lastLoudAt.set(key, now);
        if (now - (lastLoudAt.get(key) ?? 0) < HOLD_MS) speaking.push(key);
      });
      const remoteSpeaker = speaking.find((key) => key !== "self");
      if (remoteSpeaker) setLastSpeakerId(remoteSpeaker);
      setSpeakingIds((current) => (current.length === speaking.length && speaking.every((id) => current.includes(id)) ? current : speaking));
    }, 400);

    return () => {
      window.clearInterval(timer);
      monitors.forEach(({ source }) => { try { source.disconnect(); } catch { /* closing anyway */ } });
      audioContext.close().catch(() => {});
    };
  }, [room]);

  useEffect(() => {
    isChatOpenRef.current = isChatOpen;
    if (isChatOpen) setUnreadCount(0);
  }, [isChatOpen]);

  function toggleMic() {
    const enabled = !isMicEnabled;
    localStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = enabled; });
    setIsMicEnabled(enabled);
    avStateRef.current = { ...avStateRef.current, mic: enabled };
    writeAvPreferences(avStateRef.current);
    sendSignal({ type: "av-state", camera: avStateRef.current.camera, mic: enabled });
  }

  function toggleCamera() {
    const enabled = !isCameraEnabled;
    localStreamRef.current?.getVideoTracks().forEach((track) => { track.enabled = enabled; });
    setIsCameraEnabled(enabled);
    avStateRef.current = { ...avStateRef.current, camera: enabled };
    writeAvPreferences(avStateRef.current);
    sendSignal({ type: "av-state", camera: enabled, mic: avStateRef.current.mic });
  }

  async function stopScreenShare() {
    if (!screenTrackRef.current || !localStreamRef.current) return;
    screenTrackRef.current.onended = null;
    screenTrackRef.current.stop();
    screenTrackRef.current = null;
    const cameraTrack = localStreamRef.current.getVideoTracks()[0] || null;
    if (sfuRef.current) {
      await sfuRef.current.replaceVideoTrack(cameraTrack);
    } else {
      for (const connection of Array.from(peersRef.current.values())) {
        const videoTransceiver = connection.getTransceivers().find((transceiver) => (transceiver.sender.track?.kind || transceiver.receiver.track?.kind) === "video");
        await videoTransceiver?.sender.replaceTrack(cameraTrack);
      }
    }
    setLocalStream(localStreamRef.current);
    sendSignal({ type: "screen-share", active: false });
    setShareInfo(null);
    setIsScreenSharing(false);
  }

  async function startScreenShare() {
    if (!localStreamRef.current || screenTrackRef.current) return;
    let displayStream: MediaStream;
    try {
      displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    } catch {
      return;
    }
    const displayTrack = displayStream.getVideoTracks()[0];
    if (!displayTrack) return;
    screenTrackRef.current = displayTrack;
    if (sfuRef.current) {
      // The published video slot now carries the screen; viewers notice nothing
      // but the picture changing. Joining without any camera means there is no
      // video slot to reuse — surface that instead of silently doing nothing.
      if (sfuRef.current.published.some((track) => track.kind === "video")) {
        await sfuRef.current.replaceVideoTrack(displayTrack);
      } else {
        displayTrack.stop();
        screenTrackRef.current = null;
        showRoomToast("Screen sharing needs a camera-enabled join on this device");
        return;
      }
    } else {
      for (const [peerId, connection] of Array.from(peersRef.current.entries())) {
        const videoTransceiver = connection.getTransceivers().find((transceiver) => (transceiver.sender.track?.kind || transceiver.receiver.track?.kind) === "video");
        if (!videoTransceiver) continue;
        await videoTransceiver.sender.replaceTrack(displayTrack);
        if (videoTransceiver.direction !== "sendrecv") {
          videoTransceiver.direction = "sendrecv";
          const offer = await connection.createOffer();
          await connection.setLocalDescription(offer);
          sendSignal({ type: "offer", to: peerId, payload: connection.localDescription });
        }
      }
    }
    displayTrack.onended = () => { void stopScreenShare(); };
    const settings = displayTrack.getSettings() as MediaTrackSettings & { displaySurface?: string };
    setShareInfo({ surface: settings.displaySurface || "", label: displayTrack.label || "" });
    setLocalStream(new MediaStream([displayTrack]));
    sendSignal({ type: "screen-share", active: true });
    setIsScreenSharing(true);
  }

  async function toggleScreenShare() {
    if (isScreenSharing) await stopScreenShare();
    else await startScreenShare();
  }

  function startRecording() {
    if (recordingState !== "idle") return;
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    const context = canvas.getContext("2d");
    if (!context) return;

    const audioContext = new AudioContext();
    const mixer = audioContext.createMediaStreamDestination();
    let audioSourceCount = 0;
    const connectAudio = (stream: MediaStream) => {
      if (stream.getAudioTracks().length > 0) {
        audioContext.createMediaStreamSource(stream).connect(mixer);
        audioSourceCount += 1;
      }
    };
    if (localStreamRef.current) connectAudio(localStreamRef.current);
    // remoteStreamsRef holds every participant's inbound stream in both mesh
    // and SFU modes, so the mix is mode-agnostic.
    for (const stream of Array.from(remoteStreamsRef.current.values())) connectAudio(stream);
    void audioContext.resume().catch(() => {});
    recordAudioContextRef.current = audioContext;

    const draw = () => {
      const videos = Array.from(document.querySelectorAll<HTMLVideoElement>(".native-video-grid video")).filter((video) => video.readyState >= 2);
      context.fillStyle = "#11182b";
      context.fillRect(0, 0, canvas.width, canvas.height);
      const count = Math.max(videos.length, 1);
      const cols = Math.ceil(Math.sqrt(count));
      const rows = Math.ceil(count / cols);
      const cellWidth = canvas.width / cols;
      const cellHeight = canvas.height / rows;
      videos.forEach((video, index) => {
        const col = index % cols;
        const row = Math.floor(index / cols);
        const sourceWidth = video.videoWidth || 16;
        const sourceHeight = video.videoHeight || 9;
        const scale = Math.min(cellWidth / sourceWidth, cellHeight / sourceHeight);
        const width = sourceWidth * scale;
        const height = sourceHeight * scale;
        context.drawImage(video, col * cellWidth + (cellWidth - width) / 2, row * cellHeight + (cellHeight - height) / 2, width, height);
      });
    };
    draw();
    // setInterval (not requestAnimationFrame) so the composite keeps painting when the tab is backgrounded
    recordRafRef.current = window.setInterval(draw, 100);

    const canvasStream = canvas.captureStream(30);
    const combined = new MediaStream([...canvasStream.getVideoTracks(), ...(audioSourceCount > 0 ? mixer.stream.getAudioTracks() : [])]);
    const withAudio = audioSourceCount > 0 && MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus");
    const mimeType = withAudio ? "video/webm;codecs=vp8,opus" : MediaRecorder.isTypeSupported("video/webm;codecs=vp8") ? "video/webm;codecs=vp8" : "video/webm";
    const recorder = new MediaRecorder(combined, { mimeType, videoBitsPerSecond: 2_500_000 });
    recordChunksRef.current = [];
    recorder.ondataavailable = (event) => { if (event.data.size > 0) recordChunksRef.current.push(event.data); };
    recorder.onstop = () => { void finishRecording(); };
    recorder.start(1000);
    mediaRecorderRef.current = recorder;
    recordStartRef.current = Date.now();
    setRecordingSeconds(0);
    recordTimerRef.current = window.setInterval(() => setRecordingSeconds(Math.floor((Date.now() - recordStartRef.current) / 1000)), 1000);
    setRecordingState("recording");
  }

  function stopRecording() {
    if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
  }

  async function finishRecording() {
    window.clearInterval(recordRafRef.current);
    window.clearInterval(recordTimerRef.current);
    recordAudioContextRef.current?.close().catch(() => {});
    recordAudioContextRef.current = null;
    mediaRecorderRef.current = null;
    const blob = new Blob(recordChunksRef.current, { type: "video/webm" });
    recordChunksRef.current = [];
    if (blob.size < 1000) {
      setRecordingState("idle");
      showRoomToast("The recording was empty");
      return;
    }

    setRecordingState("uploading");
    const filename = `${room?.meeting.title || "Meeting"} — ${new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.webm`;
    try {
      // The browser uploads straight to the storage bucket with a presigned URL.
      const signed = await requestJson<{ uploadUrl?: string; key?: string; publicUrl?: string; message?: string }>("/api/uploads/sign", {
        method: "POST",
        body: { filename, contentType: "video/webm" },
        fallbackError: "We could not prepare the upload",
      });
      if (!signed.uploadUrl) throw new Error(signed.message || "We could not prepare the upload");
      const uploadResponse = await fetch(signed.uploadUrl, { method: "PUT", headers: { "Content-Type": "video/webm" }, body: blob });
      if (!uploadResponse.ok) throw new Error("The recording could not be uploaded to storage");
      const metadataPayload = { provider: "storage", key: signed.key, publicUrl: signed.publicUrl, filename, contentType: "video/webm", size: blob.size, meetingId: params.meetingId };

      await requestJson("/api/recordings", { method: "POST", body: metadataPayload, fallbackError: "We could not save the recording" });
      showRoomToast("Recording saved to your cloud");
    } catch (recordError) {
      showRoomToast(recordError instanceof Error ? recordError.message : "The recording upload failed");
    } finally {
      setRecordingState("idle");
    }
  }

  function leaveRoom() {
    intentionallyLeavingRef.current = true;
    sendSignal({ type: "leave" });
    socketRef.current?.close();
    router.push("/");
  }

  function sendChat(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!messageText.trim()) return;
    const target = chatTarget !== "everyone" && remotePeers.some((peer) => peer.peerId === chatTarget) ? chatTarget : null;
    sendSignal(target ? { type: "chat", text: messageText, to: target } : { type: "chat", text: messageText });
    setMessageText("");
  }

  // Spotlight order of precedence: your own screen share, then someone else
  // presenting, then the most recent speaker, then simply the first
  // participant. Every tier is checked against live tiles so a stale id can
  // never point the spotlight at nothing.
  const activePresenter = presentingPeerIds.find((id) => remotePeers.some((peer) => peer.peerId === id));
  const stickySpeaker = remotePeers.some((peer) => peer.peerId === lastSpeakerId) ? lastSpeakerId : "";
  const featuredKey = isScreenSharing
    ? "self"
    : activePresenter || stickySpeaker || remotePeers[0]?.peerId || "self";

  // Ask the SFU for the right simulcast layer per tile: the featured tile gets
  // full quality, spotlight strip tiles get thumbnails, and grids scale with
  // headcount. Debounced so a burst of layout changes sends one update.
  useEffect(() => {
    const sfu = sfuRef.current;
    if (!sfu || remotePeers.length === 0) return;
    const timer = window.setTimeout(() => {
      for (const peer of remotePeers) {
        const wanted = layout === "spotlight"
          ? (peer.peerId === featuredKey ? "a" : "c")
          : (presentingPeerIds.includes(peer.peerId) || remotePeers.length <= 2 ? "a" : "b");
        if (lastLayerRef.current.get(peer.peerId) !== wanted) {
          lastLayerRef.current.set(peer.peerId, wanted);
          // Only keep the bookkeeping when the SFU actually applied it — a
          // pull still in flight returns false and a later run retries.
          sfu.setPeerLayer(peer.peerId, wanted)
            .then((applied) => { if (!applied) lastLayerRef.current.delete(peer.peerId); })
            .catch(() => lastLayerRef.current.delete(peer.peerId));
        }
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [layout, featuredKey, remotePeers, presentingPeerIds]);


  function peerName(peerId: string) {
    return peerDirectoryRef.current.get(peerId)?.name || remotePeers.find((peer) => peer.peerId === peerId)?.name || "Guest";
  }

  if (timeUpMinutes !== null) return <RoomState title="Time's up for this room" detail={timeUpMinutes > 0 ? `Meetings here run for up to ${formatTimeLimit(timeUpMinutes)}. Start a fresh room to keep going.` : "This meeting reached its time limit. Start a fresh room to keep going."} action={() => router.push("/")} actionLabel="Start a new room" />;
  if (hasEnded) return <RoomState title="This meeting has ended" detail="The room closed after everyone left. Start a new meeting to talk again." action={() => router.push("/")} actionLabel="Back to dashboard" />;
  if (error) return <RoomState title="This room is not ready" detail={error} action={() => router.push("/")} actionLabel="Back to dashboard" />;
  if (!room || isConnecting) return <RoomState title="Opening your meeting room" detail="Starting your camera, microphone, and private signaling connection." />;

  return <div className="native-room"><header className="native-room-header"><button className="room-brand" onClick={() => router.push("/")}><span className="brand-mark"><i /><i /><i /></span><span>meet</span></button><div className="native-room-title"><span><Radio size={12} /> Live room</span><strong>{room.meeting.title}</strong></div>{recordingState === "recording" && <span className="rec-pill"><i /> REC {formatRecordingTime(recordingSeconds)}</span>}{recordingState === "uploading" && <span className="rec-pill is-uploading"><LoaderCircle className="room-spinner" size={11} /> Saving...</span>}<div className="room-invite-wrap"><button className="room-invite-button" onClick={() => void openInvitePanel()} aria-expanded={isInviteOpen}><UserPlus size={14} /> Invite</button>{isInviteOpen && <><button className="invite-backdrop" onClick={() => setIsInviteOpen(false)} aria-label="Close invite panel" /><div className="invite-panel"><div className="invite-panel-head"><strong>Invite to this room</strong><button onClick={() => setIsInviteOpen(false)} aria-label="Close"><X size={14} /></button></div><button className="invite-copy-row" onClick={() => void copyInviteLink()}><Copy size={13} /> Copy room link{isE2ee ? " (carries the encryption key)" : ""}</button>{!isE2ee && supportsE2EE() && <button className="invite-copy-row" onClick={() => {
                // Tell everyone first: their current media cannot survive the
                // key change, and a silent restart would leave them staring at
                // frozen "connected" tiles.
                sendSignal({ type: "encrypted-restart" });
                window.setTimeout(() => { window.location.hash = `k=${generateRoomKeySecret()}`; window.location.reload(); }, 200);
              }}><ShieldCheck size={13} /> Restart this room end-to-end encrypted{remotePeers.length > 0 ? " (everyone will need the new link)" : ""}</button>}<p className="invite-panel-kicker">{isE2ee ? "Inviting people" : "Your contacts"}</p><div className="invite-contact-list">{isE2ee ? <p className="invite-empty">This room is end-to-end encrypted — the key travels only inside the room link, so share the link above. Ringing a contact would bring them in without the key.</p> : contacts.length === 0 ? <p className="invite-empty">No contacts yet — people appear here after you meet them.</p> : contacts.filter((contact) => !remotePeers.some((peer) => peer.userId === contact.id)).map((contact) => <div className="invite-contact" key={contact.id}><span className="invite-avatar">{initialsOf(contact.name)}</span><span className="invite-contact-copy"><strong>{contact.name}</strong><small>@{contact.username}</small></span><button onClick={() => void inviteContact(contact)} disabled={invitingId === contact.id || invitedIds.includes(contact.id)}>{invitedIds.includes(contact.id) ? "Ringing" : invitingId === contact.id ? "..." : "Invite"}</button></div>)}</div></div></>}</div><div className="native-room-status"><ShieldCheck size={14} /> {isE2ee ? "End-to-end encrypted" : "Private room"}</div></header><main className="native-room-main"><section className={`native-stage ${isChatOpen ? "chat-open" : ""}`}><div className={`native-video-grid ${layout === "spotlight" ? "layout-spotlight" : ""}`}><VideoTile stream={localStream} name="You" local muted cameraEnabled={isCameraEnabled || isScreenSharing} presenting={isScreenSharing} speaking={speakingIds.includes("self")} featured={featuredKey === "self"} /><div className="native-room-count"><Users size={13} /> {remotePeers.length + 1} in room</div>{isScreenSharing && <div className="sharing-banner"><span className="sharing-pulse"><MonitorUp size={13} /></span><span className="sharing-copy"><strong>You&apos;re sharing {describeShareSurface(shareInfo?.surface)}</strong>{shareInfo?.label && <small>{shareInfo.label}</small>}</span><button onClick={() => void stopScreenShare()}>Stop sharing</button></div>}{remotePeers.length === 0 && !isScreenSharing && <button className="native-invite-hint" onClick={() => void copyInviteLink()}><Copy size={12} /> You&apos;re the only one here — copy the room link to invite others</button>}{remotePeers.map((peer) => <VideoTile key={peer.peerId} stream={peer.stream} name={peer.name} cameraEnabled={peerAvState[peer.peerId]?.camera ?? true} micEnabled={peerAvState[peer.peerId]?.mic ?? true} presenting={presentingPeerIds.includes(peer.peerId)} connectionState={peerConnState[peer.peerId]} speaking={speakingIds.includes(peer.peerId)} featured={featuredKey === peer.peerId} />)}</div>{isChatOpen && <aside className="native-chat">
              <div className="native-chat-header"><div><strong>Room chat</strong><span>Messages disappear when the room ends</span></div><button onClick={() => setIsChatOpen(false)} aria-label="Close chat"><X size={16} /></button></div>
              <div className="chat-target-row" role="group" aria-label="Send message to">
                <button type="button" className={`chat-target ${chatTarget === "everyone" ? "is-active" : ""}`} onClick={() => setChatTarget("everyone")}><Users size={11} /> Everyone</button>
                {remotePeers.map((peer) => <button type="button" key={peer.peerId} className={`chat-target ${chatTarget === peer.peerId ? "is-active" : ""}`} onClick={() => setChatTarget(peer.peerId)}>{peer.name.split(" ")[0]}</button>)}
              </div>
              <div className="native-chat-messages">{messages.length === 0 ? <div className="native-chat-empty"><MessageCircle size={22} /><p>Say hello to everyone in the room.</p></div> : messages.map((message) => {
                const mine = message.from === selfIdRef.current;
                const label = message.isPrivate ? (mine ? `You → ${peerName(message.to || "")} · private` : `${message.name} → you · private`) : (mine ? "You" : message.name);
                return <div className={`native-chat-message ${message.isPrivate ? "is-private" : ""}`} key={message.messageId}><strong>{label}</strong><p>{message.text}</p></div>;
              })}</div>
              <form className="native-chat-form" onSubmit={sendChat}><input value={messageText} onChange={(event) => setMessageText(event.target.value)} placeholder={chatTarget === "everyone" ? "Message everyone..." : `Message ${peerName(chatTarget).split(" ")[0]} privately...`} /><button aria-label="Send message"><Send size={15} /></button></form>
            </aside>}</section><footer className="native-toolbar"><div className="native-toolbar-group"><button className={`room-control ${isMicEnabled ? "" : "is-off"}`} onClick={toggleMic} aria-label={isMicEnabled ? "Mute microphone" : "Unmute microphone"}>{isMicEnabled ? <Mic size={18} /> : <MicOff size={18} />}</button><button className={`room-control ${isCameraEnabled ? "" : "is-off"}`} onClick={toggleCamera} aria-label={isCameraEnabled ? "Turn camera off" : "Turn camera on"}>{isCameraEnabled ? <Video size={18} /> : <VideoOff size={18} />}</button><button className={`room-control ${isScreenSharing ? "is-active" : ""}`} onClick={() => void toggleScreenShare()} aria-label={isScreenSharing ? "Stop sharing screen" : "Share screen"}><MonitorUp size={18} /></button><button className={`room-control ${layout === "spotlight" ? "is-active" : ""}`} onClick={() => setLayout((current) => current === "grid" ? "spotlight" : "grid")} aria-label={layout === "grid" ? "Switch to spotlight view" : "Switch to grid view"}>{layout === "grid" ? <Focus size={18} /> : <LayoutGrid size={18} />}</button><button className={`room-control ${recordingState === "recording" ? "is-recording" : ""}`} onClick={() => recordingState === "recording" ? stopRecording() : startRecording()} disabled={recordingState === "uploading"} aria-label={recordingState === "recording" ? "Stop recording" : "Start recording"}>{recordingState === "uploading" ? <LoaderCircle className="room-spinner" size={18} /> : <Disc size={18} />}</button><button className={`room-control ${isChatOpen ? "is-active" : ""}`} onClick={() => setIsChatOpen((current) => !current)} aria-label={unreadCount > 0 ? `Open chat, ${unreadCount} unread ${unreadCount === 1 ? "message" : "messages"}` : "Open chat"}><MessageCircle size={18} />{unreadCount > 0 && <span className="chat-unread-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}</button></div><button className="leave-room-button" onClick={leaveRoom}><PhoneOff size={16} /> Leave room</button><div className="native-toolbar-group"><span className="room-quality"><span /> Secure connection</span></div></footer></main>{roomToast && <div className="toast"><span><Check size={15} /></span>{roomToast}</div>}</div>;
}

function VideoTile({ stream, name, local = false, muted = false, cameraEnabled = true, micEnabled = true, presenting = false, connectionState, speaking = false, featured = false }: { stream: MediaStream | null; name: string; local?: boolean; muted?: boolean; cameraEnabled?: boolean; micEnabled?: boolean; presenting?: boolean; connectionState?: string; speaking?: boolean; featured?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hasVideo = Boolean(stream && stream.getVideoTracks().length > 0 && cameraEnabled);
  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream;
  }, [stream, hasVideo]);
  return <div className={`native-video-tile ${local ? "is-local" : ""} ${presenting ? "is-presenting" : ""} ${speaking ? "is-speaking" : ""} ${featured ? "is-featured" : ""}`}>
    {hasVideo ? <video ref={videoRef} autoPlay playsInline muted={muted} /> : <div className="native-video-placeholder"><span>{initialsOf(name)}</span></div>}
    {!hasVideo && stream && !local && <audio ref={(element) => { if (element && element.srcObject !== stream) element.srcObject = stream; }} autoPlay />}
    {!local && connectionState && connectionState !== "connected" && <span className={`tile-conn ${connectionState === "failed" ? "is-failed" : ""}`}>{connectionState === "failed" ? "Connection failed" : "Connecting..."}</span>}
    <span className="native-video-name">{!micEnabled && <MicOff size={11} />}{name}{presenting ? " · Presenting" : ""}</span>
    {local && <span className="native-you-pill">You</span>}
  </div>;
}

function describeShareSurface(surface?: string) {
  if (surface === "monitor") return "your entire screen";
  if (surface === "window") return "an app window";
  if (surface === "browser") return "a browser tab";
  return "your screen";
}

const AV_PREFERENCES_KEY = "converge_av_preferences";

/** You join muted with the camera off until you choose otherwise; the choice then sticks. */
function readAvPreferences() {
  try {
    const stored = window.localStorage.getItem(AV_PREFERENCES_KEY);
    if (!stored) return { camera: false, mic: false };
    const parsed = JSON.parse(stored) as { camera?: boolean; mic?: boolean };
    return { camera: parsed.camera === true, mic: parsed.mic === true };
  } catch {
    return { camera: false, mic: false };
  }
}

function writeAvPreferences(preferences: { camera: boolean; mic: boolean }) {
  try {
    window.localStorage.setItem(AV_PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {}
}

function formatRecordingTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function RoomState({ title, detail, action, actionLabel }: { title: string; detail: string; action?: () => void; actionLabel?: string }) {
  return <main className="room-state"><div className="room-state-mark"><Radio size={22} /></div><h1>{title}</h1><p>{detail}</p>{action ? <button className="button button-primary" onClick={action}><ArrowLeft size={15} /> {actionLabel}</button> : <LoaderCircle className="room-spinner" size={19} />}</main>;
}
