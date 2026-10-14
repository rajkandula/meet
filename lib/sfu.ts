/**
 * Server-side wrapper for a hosted SFU's HTTPS API (optional).
 *
 * The SFU replaces mesh peer-to-peer for group calls: every participant opens
 * ONE PeerConnection to the SFU, pushes their tracks once, and pulls the
 * tracks of everyone else — instead of uploading a full copy of their media to
 * every other participant. This is how calls scale past four people.
 *
 * Any SFU service that speaks this sessions/tracks API works; point
 * REALTIME_SFU_API_URL at its apps base URL. Without it (or the app id and
 * secret) the room uses mesh peer-to-peer.
 *   POST {base}/{appId}/sessions/new                  -> { sessionId }
 *   POST {base}/{appId}/sessions/{id}/tracks/new      -> push local / pull remote tracks
 *   PUT  {base}/{appId}/sessions/{id}/renegotiate     -> complete SFU-initiated renegotiation
 *   PUT  {base}/{appId}/sessions/{id}/tracks/close    -> stop tracks
 *   PUT  {base}/{appId}/sessions/{id}/tracks/update   -> switch simulcast layers
 *
 * The app secret must never reach the browser, so clients talk to
 * /api/sfu, which forwards here.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { ApiError } from "@/lib/api";
import { realtimeSecret } from "@/lib/realtime-token";
import { createLogger } from "@/lib/logger";

const log = createLogger("lib/sfu");

/**
 * A caller may pull anyone's tracks, but only the participant who created a
 * session may push/renegotiate/close it. The plain sessionId is broadcast to
 * the room (peers need it to pull), so it cannot double as proof of ownership.
 * At creation the server hands the owner a private HMAC handle over
 * sessionId+room+user; mutating ops must present it. Stateless by design —
 * no per-session store, so it holds across restarts and multiple app instances.
 */
export function signSfuOwner(sessionId: string, roomId: string, userId: string) {
  return createHmac("sha256", realtimeSecret()).update(`${sessionId}:${roomId}:${userId}`).digest("base64url");
}

export function verifySfuOwner(sessionId: string, ownerToken: string, roomId: string, userId: string) {
  const expected = signSfuOwner(sessionId, roomId, userId);
  const provided = Buffer.from(ownerToken || "", "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return provided.length === expectedBytes.length && timingSafeEqual(provided, expectedBytes);
}

export type SessionDescription = { sdp: string; type: "offer" | "answer" };

export type SfuTrackRequest = {
  location: "local" | "remote";
  mid?: string;
  sessionId?: string;
  trackName?: string;
  /** Receiver-side simulcast preference (pull/update only). */
  simulcast?: { preferredRid?: string; priorityOrdering?: "none" | "asciibetical"; ridNotAvailable?: "none" | "asciibetical" };
};

export type SfuTracksBody = {
  sessionDescription?: SessionDescription;
  tracks?: SfuTrackRequest[];
};

export type SfuCloseBody = {
  sessionDescription?: SessionDescription;
  tracks?: Array<{ mid: string }>;
  force?: boolean;
};

function sfuConfig() {
  // Read at call time, so a deploy can switch modes without a rebuild.
  const baseUrl = process.env.REALTIME_SFU_API_URL?.replace(/\/$/, "");
  const appId = process.env.REALTIME_SFU_APP_ID;
  const appSecret = process.env.REALTIME_SFU_APP_SECRET;
  if (!baseUrl || !appId || !appSecret) return null;
  return { baseUrl, appId, appSecret };
}

/** True when SFU credentials exist — the room switches modes on this. */
export function isSfuConfigured() {
  return sfuConfig() !== null;
}

async function sfuFetch(path: string, method: "GET" | "POST" | "PUT", body?: unknown) {
  const config = sfuConfig();
  if (!config) throw new Error("The SFU is not configured (REALTIME_SFU_API_URL / REALTIME_SFU_APP_ID / REALTIME_SFU_APP_SECRET).");

  const response = await fetch(`${config.baseUrl}/${config.appId}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.appSecret}`,
      "Content-Type": "application/json",
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || payload?.errorCode) {
    // Map upstream failures to a sensible client status instead of a blanket
    // 500: a bad/expired sessionId or malformed SDP is the caller's problem.
    const message = String(payload?.errorDescription || `SFU request failed (${response.status}).`);
    const status = response.status === 404 ? 404 : response.status >= 400 && response.status < 500 ? 400 : 502;
    log.warn("sfu api call failed", { path, method, status: response.status, errorCode: payload?.errorCode, errorDescription: payload?.errorDescription });
    throw new ApiError(message, status);
  }
  return payload as Record<string, unknown>;
}

/** One session per participant — the server-side face of their PeerConnection. */
export async function createSfuSession(): Promise<string> {
  const data = await sfuFetch("/sessions/new", "POST");
  const sessionId = String(data.sessionId || "");
  if (!sessionId) throw new Error("The SFU did not return a session id.");
  return sessionId;
}

/** Push local tracks (with an SDP offer) or pull remote tracks (by owner session + name). */
export function sfuTracksNew(sessionId: string, body: SfuTracksBody) {
  return sfuFetch(`/sessions/${encodeURIComponent(sessionId)}/tracks/new`, "POST", body);
}

/** Completes a renegotiation the SFU initiated (it sent an offer; we answer). */
export function sfuRenegotiate(sessionId: string, body: { sessionDescription: SessionDescription }) {
  return sfuFetch(`/sessions/${encodeURIComponent(sessionId)}/renegotiate`, "PUT", body);
}

/** Stops tracks; force=true skips renegotiation and just halts the data flow. */
export function sfuTracksClose(sessionId: string, body: SfuCloseBody) {
  return sfuFetch(`/sessions/${encodeURIComponent(sessionId)}/tracks/close`, "PUT", body);
}

/** Retargets existing transceivers — used to switch simulcast quality layers. */
export function sfuTracksUpdate(sessionId: string, body: SfuTracksBody) {
  return sfuFetch(`/sessions/${encodeURIComponent(sessionId)}/tracks/update`, "PUT", body);
}
