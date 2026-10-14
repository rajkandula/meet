import { NextResponse } from "next/server";
import type { ObjectId } from "mongodb";
import { apiHandler, requireUser } from "@/lib/api";
import { getDatabase } from "@/lib/mongodb";
import { tryObjectId, type UserDocument } from "@/lib/auth";
import { workspaceFilter, workspaceIdFrom } from "@/lib/workspace-scope";
import { fallbackContacts } from "@/lib/demo-data";
import type { Meeting } from "@/types/meeting";
import type { ParticipantDocument } from "@/types/db";

export type Contact = { id: string; name: string; username: string; lastMetAt: string; meetingsShared: number; avatarUrl?: string };

export const GET = apiHandler("api/contacts", async (request) => {
  const user = await requireUser();

  const db = await getDatabase();
  if (!db) return NextResponse.json({ contacts: fallbackContacts, source: "demo" });

  const participants = db.collection<ParticipantDocument>("meeting_participants");
  const myId = user._id.toString();
  let myMeetingIds = await participants.distinct("meetingId", { userId: myId });

  // Contacts belong to the workspace where you actually met, so narrow the
  // meetings to that workspace before working out who was in them.
  const workspaceId = workspaceIdFrom(request);
  if (workspaceId) {
    const scope = await workspaceFilter(db, myId, workspaceId);
    const scoped = await db
      .collection<Meeting>("meetings")
      .find({ $and: [{ id: { $in: myMeetingIds } }, scope] }, { projection: { id: 1 } })
      .toArray();
    myMeetingIds = scoped.map((meeting) => meeting.id);
  }
  if (myMeetingIds.length === 0) return NextResponse.json({ contacts: [], source: "mongodb" });

  const others = await participants.find({ meetingId: { $in: myMeetingIds }, userId: { $ne: myId } }).toArray();

  const byUser = new Map<string, Contact>();
  for (const participant of others) {
    const existing = byUser.get(participant.userId);
    if (existing) {
      existing.meetingsShared += 1;
      if (participant.joinedAt > existing.lastMetAt) {
        existing.lastMetAt = participant.joinedAt;
        existing.name = participant.name;
        existing.username = participant.username;
      }
    } else {
      byUser.set(participant.userId, {
        id: participant.userId,
        name: participant.name,
        username: participant.username,
        lastMetAt: participant.joinedAt,
        meetingsShared: 1,
      });
    }
  }

  const contacts = Array.from(byUser.values()).sort((a, b) => b.lastMetAt.localeCompare(a.lastMetAt));

  // Attach current avatars (participation records only capture the name at join time).
  const ids = contacts.map((contact) => tryObjectId(contact.id)).filter(Boolean) as ObjectId[];
  if (ids.length > 0) {
    const profiles = await db.collection<UserDocument>("users").find({ _id: { $in: ids } }, { projection: { passwordHash: 0 } }).toArray();
    const byId = new Map(profiles.map((profile) => [profile._id?.toString(), profile]));
    for (const contact of contacts) {
      const profile = byId.get(contact.id);
      if (profile) {
        contact.avatarUrl = profile.avatarUrl;
        contact.name = profile.name;
        contact.username = profile.username;
      }
    }
  }

  return NextResponse.json({ contacts, source: "mongodb" });
});
