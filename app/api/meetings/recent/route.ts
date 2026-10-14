import { NextResponse } from "next/server";
import { apiHandler, requireUser } from "@/lib/api";
import { getDatabase } from "@/lib/mongodb";
import { getLiveRooms } from "@/lib/realtime-presence";
import { workspaceFilter, workspaceIdFrom } from "@/lib/workspace-scope";
import type { Meeting } from "@/types/meeting";
import type { ParticipantDocument } from "@/types/db";

export type RecentMeeting = {
  id: string;
  title: string;
  lastActivityAt: string;
  isLive: boolean;
  participantCount: number;
  isEnded: boolean;
  isOwner: boolean;
};

/** A room stays joinable for a while after its scheduled slot; after that it is done. */
const JOINABLE_WINDOW_MS = 12 * 60 * 60 * 1000;

export const GET = apiHandler("api/meetings/recent", async (request) => {
  const user = await requireUser();

  const limitParam = Number(new URL(request.url).searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 50) : 3;

  const db = await getDatabase();
  if (!db) return NextResponse.json({ meetings: [], source: "demo" });

  const myId = user._id.toString();
  const participations = await db
    .collection<ParticipantDocument>("meeting_participants")
    .find({ userId: myId })
    .toArray();

  const lastJoinedByMeeting = new Map<string, string>();
  for (const participation of participations) {
    const previous = lastJoinedByMeeting.get(participation.meetingId);
    if (!previous || participation.joinedAt > previous) lastJoinedByMeeting.set(participation.meetingId, participation.joinedAt);
  }

  const scope = await workspaceFilter(db, myId, workspaceIdFrom(request));
  const meetings = await db
    .collection<Meeting>("meetings")
    .find({ $and: [{ $or: [{ ownerId: myId }, { id: { $in: Array.from(lastJoinedByMeeting.keys()) } }] }, scope] })
    .toArray();

  const liveRooms = await getLiveRooms();
  const now = Date.now();

  const recent: RecentMeeting[] = meetings
    .map((meeting) => {
      const joinedAt = lastJoinedByMeeting.get(meeting.id);
      const lastActivityAt = joinedAt || meeting.createdAt || meeting.dateTime;
      const participantCount = liveRooms[meeting.id] || 0;
      const isLive = participantCount > 0;
      const startedAt = new Date(meeting.dateTime).getTime();
      const expired = Number.isFinite(startedAt) && now - startedAt > JOINABLE_WINDOW_MS;
      return {
        id: meeting.id,
        title: meeting.title,
        lastActivityAt,
        isLive,
        participantCount,
        isEnded: !isLive && (meeting.status === "ended" || expired),
        isOwner: meeting.ownerId === myId,
      };
    })
    .sort((a, b) => {
      if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
      return b.lastActivityAt.localeCompare(a.lastActivityAt);
    })
    .slice(0, limit);

  return NextResponse.json({ meetings: recent, source: "mongodb" });
});
