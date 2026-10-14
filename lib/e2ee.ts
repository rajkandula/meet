/**
 * End-to-end encryption for SFU calls via WebRTC insertable streams.
 *
 * The room key is derived from the invite link's URL FRAGMENT (`#k=...`),
 * which browsers never send over the network — neither our servers nor
 * the SFU ever see it. Every encoded media frame is AES-GCM encrypted
 * before packetization and decrypted after depacketization, so the SFU
 * forwards bytes it cannot read. (This is link-key E2EE in the Jitsi mold:
 * server-blind, but no per-member key rotation — everyone with the link has
 * the key. MLS-grade rotation is a future protocol project.)
 *
 * Frame layout on the wire: ciphertext (incl. 16-byte GCM tag) || 12-byte IV.
 * A frame that fails to decrypt (wrong key, no key) is dropped, so an
 * uninvited puller renders nothing rather than garbage.
 *
 * Two browser APIs cover the field:
 *  - Chrome/Edge: RTCRtpSender/Receiver.createEncodedStreams() (requires
 *    `encodedInsertableStreams: true` on the PeerConnection).
 *  - Safari (and newer engines): RTCRtpScriptTransform with a worker.
 */

const IV_BYTES = 12;

export function generateRoomKeySecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...Array.from(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The `k` param of the URL fragment, if this is an encrypted room link. */
export function roomKeySecretFromLocation(): string | null {
  try {
    return new URLSearchParams(window.location.hash.slice(1)).get("k");
  } catch {
    return null;
  }
}

export function supportsE2EE(): boolean {
  if (typeof window === "undefined") return false;
  const senderProto = (window.RTCRtpSender as unknown as { prototype?: Record<string, unknown> })?.prototype;
  return Boolean(senderProto && "createEncodedStreams" in senderProto) || "RTCRtpScriptTransform" in window;
}

/**
 * The link secret becomes HKDF key material, and every SENDER encrypts under a
 * subkey bound to their own (public) SFU session id. Fresh key per join keeps
 * the AES-GCM random-IV budget per key vanishingly small, and receivers can
 * derive any sender's subkey because session ids ride the public announcements
 * — the secret itself never leaves the URL fragment.
 */
export async function deriveRoomBaseKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`converge-e2ee:${secret}`));
  return crypto.subtle.importKey("raw", digest, "HKDF", false, ["deriveKey"]);
}

export function deriveSessionKey(baseKey: CryptoKey, sessionId: string): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode(sessionId), info: new TextEncoder().encode("converge-frame-key") },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

type EncodedFrame = { data: ArrayBuffer };

async function encryptFrame(key: CryptoKey, frame: EncodedFrame, controller: { enqueue: (frame: EncodedFrame) => void }) {
  try {
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, frame.data);
    const out = new Uint8Array(ciphertext.byteLength + IV_BYTES);
    out.set(new Uint8Array(ciphertext), 0);
    out.set(iv, ciphertext.byteLength);
    frame.data = out.buffer;
    controller.enqueue(frame);
  } catch {
    // Never emit a plaintext frame from an encrypted session.
  }
}

async function decryptFrame(key: CryptoKey, frame: EncodedFrame, controller: { enqueue: (frame: EncodedFrame) => void }) {
  try {
    const bytes = new Uint8Array(frame.data);
    if (bytes.byteLength <= IV_BYTES) return;
    const iv = bytes.slice(bytes.byteLength - IV_BYTES);
    const ciphertext = bytes.slice(0, bytes.byteLength - IV_BYTES);
    frame.data = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    controller.enqueue(frame);
  } catch {
    // Wrong or missing key: drop the frame — show nothing, not noise.
  }
}

type EncodedStreamsEndpoint = { createEncodedStreams?: () => { readable: ReadableStream<EncodedFrame>; writable: WritableStream<EncodedFrame> } };

function pipeThroughCrypto(endpoint: EncodedStreamsEndpoint, key: CryptoKey, mode: "encrypt" | "decrypt") {
  const streams = endpoint.createEncodedStreams?.();
  if (!streams) return false;
  const transform = new TransformStream<EncodedFrame, EncodedFrame>({
    transform: (frame, controller) => (mode === "encrypt" ? encryptFrame(key, frame, controller) : decryptFrame(key, frame, controller)),
  });
  void streams.readable.pipeThrough(transform).pipeTo(streams.writable).catch(() => {
    // The transceiver was stopped mid-stream; nothing to clean up.
  });
  return true;
}

/**
 * The Safari path runs the same transforms inside a worker. The worker source
 * is inlined (Blob URL) so no extra public asset needs shipping.
 */
const WORKER_SOURCE = `
const IV_BYTES = ${IV_BYTES};
onrtctransform = (event) => {
  const { key, mode } = event.transformer.options;
  const transform = new TransformStream({
    async transform(frame, controller) {
      try {
        if (mode === "encrypt") {
          const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
          const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, frame.data);
          const out = new Uint8Array(ciphertext.byteLength + IV_BYTES);
          out.set(new Uint8Array(ciphertext), 0);
          out.set(iv, ciphertext.byteLength);
          frame.data = out.buffer;
          controller.enqueue(frame);
        } else {
          const bytes = new Uint8Array(frame.data);
          if (bytes.byteLength <= IV_BYTES) return;
          const iv = bytes.slice(bytes.byteLength - IV_BYTES);
          const ciphertext = bytes.slice(0, bytes.byteLength - IV_BYTES);
          frame.data = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
          controller.enqueue(frame);
        }
      } catch {
        // Encrypt failure: never leak plaintext. Decrypt failure: drop frame.
      }
    },
  });
  event.transformer.readable.pipeThrough(transform).pipeTo(event.transformer.writable).catch(() => {});
};
`;

let sharedWorker: Worker | null = null;

function cryptoWorker(): Worker {
  if (!sharedWorker) {
    sharedWorker = new Worker(URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "application/javascript" })));
  }
  return sharedWorker;
}

type ScriptTransformable = { transform?: unknown };

/** Wires frame encryption onto an outgoing sender. */
export function protectSender(sender: RTCRtpSender, key: CryptoKey) {
  if (pipeThroughCrypto(sender as unknown as EncodedStreamsEndpoint, key, "encrypt")) return;
  const RtpScriptTransform = (window as unknown as { RTCRtpScriptTransform?: new (worker: Worker, options: unknown) => unknown }).RTCRtpScriptTransform;
  if (RtpScriptTransform) (sender as unknown as ScriptTransformable).transform = new RtpScriptTransform(cryptoWorker(), { key, mode: "encrypt" });
}

/** Wires frame decryption onto an incoming receiver. */
export function protectReceiver(receiver: RTCRtpReceiver, key: CryptoKey) {
  if (pipeThroughCrypto(receiver as unknown as EncodedStreamsEndpoint, key, "decrypt")) return;
  const RtpScriptTransform = (window as unknown as { RTCRtpScriptTransform?: new (worker: Worker, options: unknown) => unknown }).RTCRtpScriptTransform;
  if (RtpScriptTransform) (receiver as unknown as ScriptTransformable).transform = new RtpScriptTransform(cryptoWorker(), { key, mode: "decrypt" });
}
