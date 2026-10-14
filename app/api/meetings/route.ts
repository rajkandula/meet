import { NextResponse } from "next/server";
import { apiHandler, jsonError, readJson, requireUser } from "@/lib/api";
import { getDatabase } from "@/lib/mongodb";
import { createLogger } from "@/lib/logger";
import { buildMeeting, joinedMeetingIds } from "@/lib/meetings";
import { workspaceFilter, workspaceIdFrom } from "@/lib/workspace-scope";
import { fallbackMeetings } from "@/lib/demo-data";
import type { CreateMeetingInput, Meeting } from "@/types/meeting";

const log = createLogger("api/meetings");

export const GET = apiHandler("api/meetings", async (request) => {
  const user = await requireUser();

  const db = await getDatabase();
  if (!db) return NextResponse.json({ meetings: fallbackMeetings, source: "demo" });

  const myId = user._id.toString();
  const joined = await joinedMeetingIds(db, myId);
  const scope = await workspaceFilter(db, myId, workspaceIdFrom(request));
  const meetings = await db.collection<Meeting>("meetings")
    .find({ $and: [{ $or: [{ ownerId: myId }, { id: { $in: joined } }] }, { status: { $ne: "ended" } }, scope] })
    .sort({ dateTime: 1 })
    .limit(50)
    .toArray();
  return NextResponse.json({ meetings, source: "mongodb" });
});

export const POST = apiHandler("api/meetings", async (request) => {
  const user = await requireUser();

  const body = await readJson<Partial<CreateMeetingInput> & { workspaceId?: string }>(request);
  if (!body.title || !body.dateTime) return jsonError("title and dateTime are required", 400);
  if (typeof body.title !== "string" || body.title.length > 200) return jsonError("Please use a shorter meeting title.", 400);

  const date = new Date(body.dateTime);
  if (Number.isNaN(date.getTime())) return jsonError("Please provide a valid date and time.", 400);

  const meeting = buildMeeting({
    ownerId: user._id.toString(),
    workspaceId: body.workspaceId,
    title: body.title,
    date,
    duration: body.duration,
    type: body.type,
    attendeeNames: [user.name],
    status: "upcoming",
  });

  const db = await getDatabase();
  if (db) await db.collection<Meeting>("meetings").insertOne(meeting);
  log.info("meeting created", { meetingId: meeting.id, ownerId: meeting.ownerId, workspaceId: meeting.workspaceId, stored: Boolean(db) });

  return NextResponse.json({ meeting, source: db ? "mongodb" : "demo" }, { status: 201 });
});
