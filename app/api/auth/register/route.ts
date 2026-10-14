import { hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { apiHandler, jsonError, readJson, requireDatabase } from "@/lib/api";
import {
  attachSessionCookie,
  createSession,
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

const log = createLogger("api/auth/register");

export const POST = apiHandler("api/auth/register", async (request) => {
  const body = await readJson<{ name?: unknown; username?: unknown; password?: unknown; confirmPassword?: unknown }>(request);

  // Fields come from the network — anything non-string is a bad request, not a crash.
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const username = typeof body.username === "string" ? normalizeUsername(body.username) : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!name || !username || !password || password !== body.confirmPassword) {
    return jsonError("Please complete every field and make sure the passwords match.", 400);
  }
  if (name.length < NAME_MIN_LENGTH) return jsonError("Please enter your full name.", 400);
  if (name.length > NAME_MAX_LENGTH) return jsonError("Please use a shorter name.", 400);
  if (password.length > PASSWORD_MAX_LENGTH) return jsonError("Please use a shorter password.", 400);
  if (!USERNAME_PATTERN.test(username)) return jsonError(USERNAME_RULES_MESSAGE, 400);
  if (password.length < PASSWORD_MIN_LENGTH) return jsonError(`Your password needs at least ${PASSWORD_MIN_LENGTH} characters.`, 400);

  const db = await requireDatabase();
  const users = db.collection<UserDocument>("users");
  await users.createIndex({ username: 1 }, { unique: true });
  const existing = await users.findOne({ username });
  if (existing) return jsonError("That username is already taken.", 409);

  const result = await users.insertOne({ name, username, passwordHash: await hash(password, PASSWORD_ROUNDS), createdAt: new Date() });
  const session = await createSession(db, result.insertedId);
  log.info("account created", { userId: result.insertedId.toString(), username });

  const response = NextResponse.json({ user: { name, username } }, { status: 201 });
  return attachSessionCookie(response, session);
});
