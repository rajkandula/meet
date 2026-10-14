/**
 * Shared plumbing for API route handlers.
 *
 * Every route used to hand-roll the same three steps — check the session,
 * check the database, parse the body — and a thrown error anywhere meant an
 * untraced 500. Routes now express those steps as one-liners that throw
 * `ApiError`, and `apiHandler` turns anything thrown into the right JSON
 * response while logging what actually happened.
 */

import { NextResponse } from "next/server";
import type { Db, WithId } from "mongodb";
import { getCurrentUser, type UserDocument } from "@/lib/auth";
import { getDatabase } from "@/lib/mongodb";
import { createLogger } from "@/lib/logger";

/** An expected failure: carries the status and user-facing message to return. */
export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/** The signed-in user, or a 401 out of `apiHandler`. */
export async function requireUser(): Promise<WithId<UserDocument>> {
  const user = await getCurrentUser();
  if (!user) throw new ApiError("You must be signed in.", 401);
  return user as WithId<UserDocument>;
}

/** The database, or a 503 for routes that cannot fall back to demo data. */
export async function requireDatabase(): Promise<Db> {
  const db = await getDatabase();
  if (!db) throw new ApiError("MongoDB is not configured yet.", 503);
  return db;
}

/** Parses a JSON body; malformed input becomes a 400 instead of a crash. */
export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new ApiError("The request body must be valid JSON.", 400);
  }
}

type RouteContext = { params: Record<string, string> };
type RouteHandler = (request: Request, context: RouteContext) => Promise<NextResponse> | NextResponse;

/**
 * Wraps a route handler with error translation and logging.
 *
 * `ApiError`s become their JSON response (client mistakes log at debug, server
 * trouble at warn); anything else logs at error with a stack and returns a
 * generic 500, so no failure path is ever silent again.
 */
export function apiHandler(scope: string, handler: RouteHandler): RouteHandler {
  const log = createLogger(scope);
  return async (request, context) => {
    try {
      return await handler(request, context);
    } catch (error) {
      if (error instanceof ApiError) {
        const level = error.status >= 500 ? "warn" : "debug";
        log[level]("request rejected", { status: error.status, reason: error.message, method: request.method });
        return jsonError(error.message, error.status);
      }
      log.error("request failed", { error, method: request.method, url: request.url });
      return jsonError("Something went wrong on our side. Please try again.", 500);
    }
  };
}
