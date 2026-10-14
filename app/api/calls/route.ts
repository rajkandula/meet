import { NextResponse } from "next/server";
import { apiHandler, jsonError, readJson, requireDatabase, requireUser } from "@/lib/api";
import { getDatabase } from "@/lib/mongodb";
import { tryObjectId, type UserDocument } from "@/lib/auth";
import { createLogger } from "@/lib/logger";
import { buildMeeting, participatesInMeeting } from "@/lib/meetings";
import { RING_WINDOW_MS, type CallInvite } from "@/types/call";
import type { Meeting } from "@/types/meeting";

const log = createLogger("api/calls");

export const GET = apiHandler("api/calls", async () => {
  const user = await requireUser();

  const db = await getDatabase();
  if (!db) return NextResponse.json({ incoming: [], outgoing: [], source: "demo" });

  const myId = user._id.toString();
  const cutoff = new Date(Date.now() - RING_WINDOW_MS).toISOString();
  const calls = db.collection<CallInvite>("call_invites");
  const [incoming, outgoing] = await Promise.all([
    calls.find({ toUserId: myId, status: "ringing", createdAt: { $gt: cutoff } }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray(),
    calls.find({ fromUserId: myId, status: "ringing", createdAt: { $gt: cutoff } }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray(),
  ]);

  return NextResponse.json({ incoming, outgoing, source: "mongodb" });
});

export const POST = apiHandler("api/calls", async (request) => {
  const user = await requireUser();
  const db = await requireDatabase();

  const body = await readJson<{ toUserId?: string; meetingId?: string; workspaceId?: string }>(request);
  if (!body.toUserId) return jsonError("toUserId is required.", 400);

  // A malformed toUserId reads the same as an unknown user.
  const targetId = tryObjectId(body.toUserId);
  const target = targetId ? await db.collection<UserDocument>("users").findOne({ _id: targetId }) : null;
  if (!target) return jsonError("We could not find that person.", 404);

  const myId = user._id.toString();
  if (target._id?.toString() === myId) return jsonError("You cannot call yourself.", 400);

  const startedAt = new Date();

  function buildInvite(meetingId: string): CallInvite {
    return {
      id: crypto.randomUUID(),
      meetingId,
      fromUserId: myId,
      fromName: user.name,
      fromUsername: user.username,
      toUserId: target!._id?.toString() || "",
      toName: target!.name,
      status: "ringing",
      createdAt: startedAt.toISOString(),
    };
  }

  // Inviting someone into the room the caller is already in.
  if (body.meetingId) {
    const existing = await db.collection<Meeting>("meetings").findOne({ id: body.meetingId });
    // Ringing people into a room is reserved for those who belong to it.
    if (!existing || !(await participatesInMeeting(db, existing, myId))) {
      return jsonError("Join the meeting before inviting others to it.", 403);
    }
    const invite = buildInvite(body.meetingId);
    await db.collection<CallInvite>("call_invites").insertOne(invite);
    log.info("room invite sent", { callId: invite.id, meetingId: body.meetingId, fromUserId: myId, toUserId: invite.toUserId });
    return NextResponse.json({ call: { ...invite }, meetingId: body.meetingId, meetingTitle: existing?.title, source: "mongodb" }, { status: 201 });
  }

  // A fresh direct call: create the room, then ring the other person into it.
  const meeting = buildMeeting({
    ownerId: myId,
    workspaceId: body.workspaceId,
    title: `${user.name.split(" ")[0]} × ${target.name.split(" ")[0]}`,
    date: startedAt,
    attendeeNames: [user.name, target.name],
    status: "live",
  });
  await db.collection<Meeting>("meetings").insertOne(meeting);

  const call = buildInvite(meeting.id);
  await db.collection<CallInvite>("call_invites").insertOne(call);
  log.info("direct call started", { callId: call.id, meetingId: meeting.id, fromUserId: myId, toUserId: call.toUserId });

  return NextResponse.json({ call: { ...call }, meetingId: meeting.id, source: "mongodb" }, { status: 201 });
});
