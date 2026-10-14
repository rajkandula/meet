import { NextResponse } from "next/server";
import { apiHandler, jsonError, readJson } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { createRealtimeToken } from "@/lib/realtime-token";
import { getTurnServers } from "@/lib/turn";
import { getDatabase } from "@/lib/mongodb";
import { fallbackMeetingTitles } from "@/lib/demo-data";
import { isSfuConfigured } from "@/lib/sfu";
import { createLogger } from "@/lib/logger";
import { formatTimeLimit } from "@/lib/format";
import type { Meeting } from "@/types/meeting";
import type { ParticipantDocument } from "@/types/db";

/**
 * Optional cap on how long one room may run, in minutes, counted from the
 * first join. Unset or 0 (the default) means rooms never time out.
 */
function meetingTimeLimitMinutes() {
  const minutes = Number(process.env.MEETING_TIME_LIMIT_MINUTES);
  return Number.isFinite(minutes) && minutes > 0 ? Math.floor(minutes) : 0;
}

const log = createLogger("api/realtime/token");

export const POST = apiHandler("api/realtime/token", async (request) => {
  // Deliberately no requireUser(): anyone with a room link can join as a guest.
  const currentUser = await getCurrentUser();
  const user = currentUser || {
    _id: "guest-" + Math.random().toString(36).slice(2, 9),
    name: "Guest User",
    username: "guest",
  };

  const { meetingId } = await readJson<{ meetingId?: string }>(request);
  if (!meetingId) return jsonError("meetingId is required.", 400);

  const db = await getDatabase();
  const dbMeeting = db ? await db.collection<Meeting>("meetings").findOne({ id: meetingId }) : null;
  if (dbMeeting?.status === "ended") {
    return NextResponse.json({ error: "This meeting has ended.", ended: true }, { status: 410 });
  }
  const meeting = dbMeeting || {
    id: meetingId,
    title: fallbackMeetingTitles[meetingId] || "Instant Meeting Room",
  };

  // Optional time limit (MEETING_TIME_LIMIT_MINUTES): a stored meeting stops
  // once that long has passed since its first join. Ad-hoc rooms with no
  // stored meeting get the same budget per session, so a bare URL is not a
  // way around it. With no limit configured, rooms run for as long as needed.
  const limitMinutes = meetingTimeLimitMinutes();
  let timeLimit: { minutes: number; endsAt: string } | null = null;
  if (limitMinutes > 0) {
    let startedAt = Date.now();
    if (db && dbMeeting) {
      const firstJoin = await db.collection<ParticipantDocument>("meeting_participants")
        .find({ meetingId: dbMeeting.id }).sort({ joinedAt: 1 }).limit(1).toArray();
      if (firstJoin[0]?.joinedAt) startedAt = new Date(firstJoin[0].joinedAt).getTime();
    }
    const endsAt = startedAt + limitMinutes * 60 * 1000;
    if (Date.now() >= endsAt) {
      log.info("meeting time limit reached", { meetingId: meeting.id, limitMinutes });
      return NextResponse.json({
        error: `This meeting reached its time limit of ${formatTimeLimit(limitMinutes)}. Start a fresh room to keep talking.`,
        ended: true,
        timeLimitReached: true,
        minutes: limitMinutes,
      }, { status: 410 });
    }
    timeLimit = { minutes: limitMinutes, endsAt: new Date(endsAt).toISOString() };
  }

  // Record the participation so contacts and "recent meetings" know you were here.
  if (db && currentUser) {
    await db.collection("meeting_participants").updateOne(
      { meetingId: meeting.id, userId: currentUser._id?.toString() },
      { $set: { name: currentUser.name, username: currentUser.username, joinedAt: new Date().toISOString() } },
      { upsert: true },
    );
  }

  const token = createRealtimeToken({
    roomId: meeting.id,
    userId: user._id?.toString() || "guest",
    name: user.name,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 6,
  });
  const iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }> = [
    { urls: process.env.NEXT_PUBLIC_STUN_URL || "stun:stun.l.google.com:19302" },
    ...(await getTurnServers()),
  ];
  const hasTurn = iceServers.some((server) => String(server.urls).includes("turn:") || String(server.urls).includes("turns:"));

  log.info("room token issued", {
    meetingId: meeting.id,
    userId: user._id?.toString(),
    guest: !currentUser,
    hasTurn,
  });
  // Calls regularly fail across NATs without a relay — make that visible early.
  if (!hasTurn) log.warn("no TURN relay configured — cross-network calls will likely fail", { meetingId: meeting.id });

  return NextResponse.json({
    token,
    wsUrl: process.env.REALTIME_WS_URL || "ws://localhost:3005",
    iceServers,
    hasTurn,
    // When SFU credentials exist the room uses one connection through
    // the SFU instead of a mesh — that is what lets calls scale past four.
    sfuEnabled: isSfuConfigured(),
    // Present only when MEETING_TIME_LIMIT_MINUTES is set; null means no limit.
    timeLimit,
    meeting: { id: meeting.id, title: meeting.title },
  });
});
