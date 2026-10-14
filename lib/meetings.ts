/**
 * Meeting queries and construction shared by the routes that deal in meetings.
 */

import type { Db } from "mongodb";
import { initialsOf, meetingDateLabels } from "@/lib/format";
import type { Meeting } from "@/types/meeting";
import type { ParticipantDocument } from "@/types/db";

/** Ids of every meeting this user has joined a room for. */
export function joinedMeetingIds(db: Db, userId: string | undefined) {
  return db.collection<ParticipantDocument>("meeting_participants").distinct("meetingId", { userId });
}

/** True when the user owns the meeting or has joined its room. */
export async function participatesInMeeting(db: Db, meeting: Meeting, userId: string) {
  if (meeting.ownerId === userId) return true;
  const joined = await db.collection<ParticipantDocument>("meeting_participants").findOne({ meetingId: meeting.id, userId });
  return Boolean(joined);
}

type BuildMeetingInput = {
  ownerId: string;
  workspaceId?: string;
  title: string;
  /** The instant the meeting starts (already resolved to a real Date). */
  date: Date;
  duration?: string;
  type?: Meeting["type"];
  /** Display names of the people on the invite; stored as initials. */
  attendeeNames: string[];
  status: Meeting["status"];
};

/**
 * The one place a Meeting document is assembled, so scheduled meetings and
 * direct calls can never drift apart in shape again.
 */
export function buildMeeting(input: BuildMeetingInput): Meeting {
  return {
    id: crypto.randomUUID(),
    ownerId: input.ownerId,
    workspaceId: input.workspaceId,
    roomName: `converge-${crypto.randomUUID()}`,
    title: input.title,
    ...meetingDateLabels(input.date),
    dateTime: input.date.toISOString(),
    duration: input.duration || "30 min",
    type: input.type || "Planning",
    attendees: input.attendeeNames.map(initialsOf),
    attendeeCount: input.attendeeNames.length,
    status: input.status,
    createdAt: new Date().toISOString(),
  };
}
