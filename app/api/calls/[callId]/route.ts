import { NextResponse } from "next/server";
import { apiHandler, jsonError, readJson, requireDatabase, requireUser } from "@/lib/api";
import { createLogger } from "@/lib/logger";
import type { CallInvite, CallStatus } from "@/types/call";

const log = createLogger("api/calls/[callId]");

// Null-prototype map: a plain object literal would resolve inherited keys like
// "constructor"/"__proto__", letting a bogus action slip past the guard below.
const actionToStatus: Record<string, CallStatus> = Object.assign(Object.create(null), { accept: "accepted", decline: "declined", cancel: "cancelled" });

export const PATCH = apiHandler("api/calls/[callId]", async (request, { params }) => {
  const user = await requireUser();
  const db = await requireDatabase();

  const body = await readJson<{ action?: string }>(request);
  const status = typeof body.action === "string" ? actionToStatus[body.action] : undefined;
  if (!status) return jsonError("action must be accept, decline, or cancel.", 400);

  const calls = db.collection<CallInvite>("call_invites");
  const call = await calls.findOne({ id: params.callId });
  if (!call) return jsonError("We could not find that call.", 404);

  const myId = user._id.toString();
  // Only the callee answers or declines; only the caller cancels.
  const allowed = body.action === "cancel" ? call.fromUserId === myId : call.toUserId === myId;
  if (!allowed) return jsonError("This call is not yours to update.", 403);

  await calls.updateOne({ id: call.id }, { $set: { status } });
  log.info("call updated", { callId: call.id, status, byUserId: myId });
  return NextResponse.json({ call: { ...call, status, _id: undefined }, meetingId: call.meetingId });
});
