import { NextResponse } from "next/server";
import { apiHandler, jsonError, readJson } from "@/lib/api";
import { verifyRealtimeToken } from "@/lib/realtime-token";
import { createSfuSession, isSfuConfigured, sfuRenegotiate, sfuTracksClose, sfuTracksNew, sfuTracksUpdate, signSfuOwner, verifySfuOwner, type SfuCloseBody, type SfuTracksBody, type SessionDescription } from "@/lib/sfu";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/sfu");

type SfuRequest =
  | { op: "session" }
  | { op: "tracks"; sessionId: string; ownerToken: string; body: SfuTracksBody }
  | { op: "renegotiate"; sessionId: string; ownerToken: string; body: { sessionDescription: SessionDescription } }
  | { op: "close"; sessionId: string; ownerToken: string; body: SfuCloseBody }
  | { op: "update"; sessionId: string; ownerToken: string; body: SfuTracksBody };

/**
 * The browser's door to the SFU. The app secret stays server-side;
 * callers prove room membership with their signed room token (guests included),
 * and prove ownership of the session they mutate with the HMAC handle minted at
 * creation — so one room member cannot push/close another member's session.
 */
export const POST = apiHandler("api/sfu", async (request) => {
  if (!isSfuConfigured()) return jsonError("Group calling is not configured on this server.", 503);

  const roomToken = request.headers.get("x-room-token") || "";
  const claims = verifyRealtimeToken(roomToken);
  if (!claims) return jsonError("A valid room token is required.", 401);

  const payload = await readJson<SfuRequest>(request);

  if (payload.op === "session") {
    const sessionId = await createSfuSession();
    const ownerToken = signSfuOwner(sessionId, claims.roomId, claims.userId);
    log.info("sfu session created", { roomId: claims.roomId, userId: claims.userId, sfuSessionId: sessionId });
    return NextResponse.json({ sessionId, ownerToken });
  }

  if (!payload.sessionId || typeof payload.sessionId !== "string") return jsonError("sessionId is required.", 400);
  // Mutating ops must operate on a session this caller created.
  if (!verifySfuOwner(payload.sessionId, payload.ownerToken, claims.roomId, claims.userId)) {
    log.warn("sfu op rejected: session not owned by caller", { roomId: claims.roomId, userId: claims.userId, op: payload.op });
    return jsonError("That session is not yours to modify.", 403);
  }

  if (payload.op === "tracks") return NextResponse.json(await sfuTracksNew(payload.sessionId, payload.body || {}));
  if (payload.op === "renegotiate") return NextResponse.json(await sfuRenegotiate(payload.sessionId, payload.body));
  if (payload.op === "close") return NextResponse.json(await sfuTracksClose(payload.sessionId, payload.body || {}));
  if (payload.op === "update") return NextResponse.json(await sfuTracksUpdate(payload.sessionId, payload.body || {}));

  return jsonError("op must be session, tracks, renegotiate, close, or update.", 400);
});
