import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { Db, ObjectId } from "mongodb";
import { getDatabase } from "@/lib/mongodb";

export { SESSION_COOKIE_NAME } from "@/lib/session";
import { SESSION_COOKIE_NAME } from "@/lib/session";
const SESSION_LIFETIME_SECONDS = 60 * 60 * 24 * 30;

/** One place for the account rules that both signup and profile edits enforce. */
export const USERNAME_PATTERN = /^[a-z0-9._-]{3,24}$/;
export const USERNAME_RULES_MESSAGE = "Username must be 3–24 characters using letters, numbers, dots, underscores, or dashes.";
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 200;
export const NAME_MIN_LENGTH = 2;
export const NAME_MAX_LENGTH = 80;
export const PASSWORD_ROUNDS = 12;

export type UserDocument = {
  _id?: ObjectId;
  name: string;
  username: string;
  passwordHash: string;
  avatarUrl?: string;
  createdAt: Date;
};

export function normalizeUsername(username: string) {
  return username.trim().toLowerCase().replace(/^@/, "");
}

/** ObjectId coercion that treats malformed input as "not found", never a crash. */
export function tryObjectId(value: unknown): ObjectId | null {
  try {
    return value instanceof ObjectId ? value : new ObjectId(String(value));
  } catch {
    return null;
  }
}

export async function createSession(db: Db, userId: ObjectId) {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_SECONDS * 1000);

  await db.collection("sessions").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await db.collection("sessions").insertOne({ token, userId, expiresAt, createdAt: new Date() });
  return { token, expiresAt };
}

/**
 * Sets the session cookie the same way on every response that signs a user in.
 * With `remember: false` the cookie carries no expiry, so it lasts only until
 * the browser closes — the server-side session still expires on its own.
 */
export function attachSessionCookie(response: NextResponse, session: { token: string; expiresAt: Date }, options: { remember?: boolean } = {}) {
  const remember = options.remember !== false;
  response.cookies.set(SESSION_COOKIE_NAME, session.token, {
    ...(remember ? { expires: session.expiresAt, maxAge: SESSION_LIFETIME_SECONDS } : {}),
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}

export async function getCurrentUser() {
  const token = cookies().get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const db = await getDatabase();
  if (!db) return null;

  const session = await db.collection<{ token: string; userId: ObjectId; expiresAt: Date }>("sessions").findOne({ token });
  if (!session || session.expiresAt <= new Date()) return null;

  // A malformed session record reads as "signed out", never as a 500.
  const userId = tryObjectId(session.userId);
  if (!userId) return null;
  return db.collection<UserDocument>("users").findOne({ _id: userId });
}

export async function deleteCurrentSession() {
  const token = cookies().get(SESSION_COOKIE_NAME)?.value;
  const db = await getDatabase();
  if (token && db) await db.collection("sessions").deleteOne({ token });
}
