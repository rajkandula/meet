import { compare } from "bcryptjs";
import { NextResponse } from "next/server";
import { apiHandler, jsonError, readJson, requireDatabase } from "@/lib/api";
import { attachSessionCookie, createSession, normalizeUsername, type UserDocument } from "@/lib/auth";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/auth/login");

export const POST = apiHandler("api/auth/login", async (request) => {
  const body = await readJson<{ username?: string; password?: string; remember?: boolean }>(request);
  const username = body.username ? normalizeUsername(body.username) : "";
  const password = body.password || "";

  if (!username || !password) return jsonError("Enter your username and password.", 400);

  const db = await requireDatabase();
  const user = await db.collection<UserDocument>("users").findOne({ username });
  // An account without a password hash can never sign in with a password.
  if (!user || !user.passwordHash || !(await compare(password, user.passwordHash))) {
    // Worth a warn: a stream of these for one username is a brute-force signature.
    log.warn("sign-in rejected", { username });
    return jsonError("That username or password is not quite right.", 401);
  }

  const session = await createSession(db, user._id!);
  log.info("user signed in", { userId: user._id?.toString(), username });
  const response = NextResponse.json({ user: { name: user.name, username: user.username } });
  // "Keep me signed in" unchecked -> browser-session cookie instead of 30 days.
  return attachSessionCookie(response, session, { remember: body.remember !== false });
});
