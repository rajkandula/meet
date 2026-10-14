import { NextResponse } from "next/server";
import { apiHandler, jsonError, readJson, requireDatabase, requireUser } from "@/lib/api";
import { realtimeSecret } from "@/lib/realtime-token";
import { createLogger } from "@/lib/logger";
import type { Meeting } from "@/types/meeting";

const log = createLogger("api/meetings/end");

/**
 * Closes a meeting. Called either by the signaling server once a room has sat
 * empty (authenticated with the shared realtime secret) or by the meeting owner.
 */
export const POST = apiHandler("api/meetings/end", async (request) => {
  const body = await readJson<{ meetingId?: string; reason?: string }>(request);
  if (!body.meetingId) return jsonError("meetingId is required.", 400);

  // Only consult the secret when the header is present, so a missing production
  // secret blocks the signaling path without also locking out meeting owners.
  const provided = request.headers.get("x-realtime-secret");
  const fromSignaling = Boolean(provided) && provided === realtimeSecret();

  const db = await requireDatabase();
  const meetings = db.collection<Meeting>("meetings");
  const meeting = await meetings.findOne({ id: body.meetingId });
  if (!meeting) return jsonError("We could not find that meeting.", 404);

  if (!fromSignaling) {
    const user = await requireUser();
    if (meeting.ownerId && meeting.ownerId !== user._id.toString()) {
      return jsonError("Only the meeting owner can end this meeting.", 403);
    }
  }

  if (meeting.status === "ended") return NextResponse.json({ ended: body.meetingId, alreadyEnded: true });

  await meetings.updateOne(
    { id: body.meetingId },
    { $set: { status: "ended", endedAt: new Date().toISOString(), endedReason: body.reason || "manual" } },
  );
  log.info("meeting ended", { meetingId: body.meetingId, reason: body.reason || "manual", by: fromSignaling ? "signaling" : "owner" });

  return NextResponse.json({ ended: body.meetingId });
});
