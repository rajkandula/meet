import { NextResponse } from "next/server";
import { compare, hash } from "bcryptjs";
import { apiHandler, jsonError, readJson, requireDatabase, requireUser } from "@/lib/api";
import { getDatabase } from "@/lib/mongodb";
import {
  NAME_MAX_LENGTH,
  NAME_MIN_LENGTH,
  normalizeUsername,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_ROUNDS,
  USERNAME_PATTERN,
  USERNAME_RULES_MESSAGE,
  type UserDocument,
} from "@/lib/auth";
import { createLogger } from "@/lib/logger";
import { joinedMeetingIds } from "@/lib/meetings";

const log = createLogger("api/profile");

export const GET = apiHandler("api/profile", async () => {
  const user = await requireUser();

  const db = await getDatabase();
  const myId = user._id.toString();
  const stats = { meetings: 0, recordings: 0, contacts: 0, storageBytes: 0 };

  if (db) {
    const participations = await joinedMeetingIds(db, myId);
    stats.meetings = await db.collection("meetings").countDocuments({ $or: [{ ownerId: myId }, { id: { $in: participations } }] });
    const recordings = await db.collection<{ ownerId: string; size: number }>("recordings").find({ ownerId: myId }).toArray();
    stats.recordings = recordings.length;
    stats.storageBytes = recordings.reduce((total, recording) => total + (recording.size || 0), 0);
    const others = await db.collection<{ meetingId: string; userId: string }>("meeting_participants").distinct("userId", { meetingId: { $in: participations }, userId: { $ne: myId } });
    stats.contacts = others.length;
  }

  return NextResponse.json({
    profile: {
      id: myId,
      name: user.name,
      username: user.username,
      avatarUrl: user.avatarUrl,
      joinedAt: user.createdAt instanceof Date ? user.createdAt.toISOString() : new Date().toISOString(),
    },
    stats,
  });
});

export const PATCH = apiHandler("api/profile", async (request) => {
  const user = await requireUser();
  const db = await requireDatabase();

  const body = await readJson<{ name?: string; username?: string; currentPassword?: string; newPassword?: string; avatarUrl?: string | null }>(request);
  const users = db.collection<UserDocument>("users");
  const updates: Partial<UserDocument> = {};

  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name.length < NAME_MIN_LENGTH) return jsonError("Please enter your full name.", 400);
    if (name.length > NAME_MAX_LENGTH) return jsonError("Please use a shorter name.", 400);
    updates.name = name;
  }

  if (body.username !== undefined) {
    const username = typeof body.username === "string" ? normalizeUsername(body.username) : "";
    if (!USERNAME_PATTERN.test(username)) return jsonError(USERNAME_RULES_MESSAGE, 400);
    if (username !== user.username) {
      const taken = await users.findOne({ username });
      if (taken) return jsonError("That username is already taken.", 409);
      updates.username = username;
    }
  }

  if (body.avatarUrl !== undefined) {
    if (body.avatarUrl === null || body.avatarUrl === "") {
      updates.avatarUrl = undefined;
    } else if (typeof body.avatarUrl !== "string") {
      return jsonError("That image could not be used.", 400);
    } else {
      const isHttp = /^https?:\/\//.test(body.avatarUrl);
      const isInlineImage = body.avatarUrl.startsWith("data:image/");
      if (!isHttp && !isInlineImage) return jsonError("That image could not be used.", 400);
      // Inline fallback images are stored in the user document, so keep them small.
      if (isInlineImage && body.avatarUrl.length > 400_000) return jsonError("That image is too large.", 413);
      updates.avatarUrl = body.avatarUrl;
    }
  }

  if (body.newPassword) {
    if (typeof body.newPassword !== "string" || typeof body.currentPassword !== "string" || !body.currentPassword) {
      return jsonError("Enter your current password to set a new one.", 400);
    }
    const valid = await compare(body.currentPassword, user.passwordHash);
    if (!valid) return jsonError("Your current password is not correct.", 403);
    if (body.newPassword.length < PASSWORD_MIN_LENGTH) return jsonError(`Your new password needs at least ${PASSWORD_MIN_LENGTH} characters.`, 400);
    if (body.newPassword.length > PASSWORD_MAX_LENGTH) return jsonError("Please use a shorter password.", 400);
    updates.passwordHash = await hash(body.newPassword, PASSWORD_ROUNDS);
  }

  if (Object.keys(updates).length === 0) return jsonError("Nothing to update.", 400);

  const removingAvatar = "avatarUrl" in updates && updates.avatarUrl === undefined;
  const { avatarUrl: _ignored, ...rest } = updates;
  await users.updateOne({ _id: user._id }, removingAvatar ? { $set: rest, $unset: { avatarUrl: "" } } : { $set: updates });
  const updated = await users.findOne({ _id: user._id });
  log.info("profile updated", { userId: user._id.toString(), fields: Object.keys(updates) });

  return NextResponse.json({ profile: { id: user._id.toString(), name: updated?.name, username: updated?.username, avatarUrl: updated?.avatarUrl } });
});
