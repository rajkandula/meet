import { NextResponse } from "next/server";
import { apiHandler, requireUser } from "@/lib/api";
import { getDatabase } from "@/lib/mongodb";
import { getLiveRooms } from "@/lib/realtime-presence";
import { joinedMeetingIds } from "@/lib/meetings";
import { RING_WINDOW_MS, type CallInvite } from "@/types/call";
import type { Meeting } from "@/types/meeting";

export type Notification = {
  id: string;
  kind: "missed-call" | "live-meeting" | "recording";
  title: string;
  detail: string;
  at: string;
  meetingId?: string;
  href?: string;
};

const LOOKBACK_MS = 24 * 60 * 60 * 1000;

export const GET = apiHandler("api/notifications", async () => {
  const user = await requireUser();

  const db = await getDatabase();
  if (!db) return NextResponse.json({ notifications: [], source: "demo" });

  const myId = user._id.toString();
  const now = Date.now();
  const since = new Date(now - LOOKBACK_MS).toISOString();
  const notifications: Notification[] = [];

  // Calls that rang out while you were away.
  const invites = await db
    .collection<CallInvite>("call_invites")
    .find({ toUserId: myId, status: "ringing", createdAt: { $gt: since } })
    .sort({ createdAt: -1 })
    .limit(20)
    .toArray();
  for (const invite of invites) {
    if (now - new Date(invite.createdAt).getTime() <= RING_WINDOW_MS) continue;
    notifications.push({
      id: `missed-${invite.id}`,
      kind: "missed-call",
      title: `Missed call from ${invite.fromName}`,
      detail: "Tap to call them back",
      at: invite.createdAt,
      meetingId: invite.meetingId,
      href: `/room/${invite.meetingId}`,
    });
  }

  // Rooms of yours that have people in them right now.
  const liveRooms = await getLiveRooms();
  const liveIds = Object.keys(liveRooms);
  if (liveIds.length > 0) {
    const participations = await joinedMeetingIds(db, myId);
    const mine = await db
      .collection<Meeting>("meetings")
      .find({ id: { $in: liveIds }, $or: [{ ownerId: myId }, { id: { $in: participations } }] })
      .toArray();
    for (const meeting of mine) {
      const count = liveRooms[meeting.id] || 0;
      notifications.push({
        id: `live-${meeting.id}`,
        kind: "live-meeting",
        title: `${meeting.title} is live`,
        detail: `${count} ${count === 1 ? "person" : "people"} in the room`,
        at: new Date(now).toISOString(),
        meetingId: meeting.id,
        href: `/room/${meeting.id}`,
      });
    }
  }

  // Recordings saved recently.
  const recordings = await db
    .collection<{ id: string; ownerId: string; filename: string; createdAt: string }>("recordings")
    .find({ ownerId: myId, createdAt: { $gt: since } })
    .sort({ createdAt: -1 })
    .limit(5)
    .toArray();
  for (const recording of recordings) {
    notifications.push({
      id: `recording-${recording.id}`,
      kind: "recording",
      title: "Recording saved",
      detail: recording.filename,
      at: recording.createdAt,
      href: "/recordings",
    });
  }

  notifications.sort((a, b) => (a.kind === "live-meeting" ? -1 : b.kind === "live-meeting" ? 1 : b.at.localeCompare(a.at)));

  return NextResponse.json({ notifications: notifications.slice(0, 12), source: "mongodb" });
});
