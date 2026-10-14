import { NextResponse } from "next/server";
import { apiHandler, jsonError, readJson, requireUser } from "@/lib/api";
import { getDatabase } from "@/lib/mongodb";
import { createLogger } from "@/lib/logger";
import { storagePublicUrl } from "@/lib/storage";
import { workspaceFilter, workspaceIdFrom } from "@/lib/workspace-scope";
import type { Meeting } from "@/types/meeting";
import type { RecordingDocument } from "@/types/db";

const log = createLogger("api/recordings");

export const GET = apiHandler("api/recordings", async (request) => {
  const user = await requireUser();
  const db = await getDatabase();
  if (!db) return NextResponse.json({ recordings: [], source: "demo" });

  const ownerId = user._id.toString();
  const scope = await workspaceFilter(db, ownerId, workspaceIdFrom(request));
  const recordings = await db.collection<RecordingDocument>("recordings").find({ $and: [{ ownerId }, scope] }).sort({ createdAt: -1 }).limit(50).toArray();
  return NextResponse.json({ recordings, source: "mongodb" });
});

const MAX_RECORDING_BYTES = 10 * 1024 ** 3;

/**
 * The stored publicUrl is later rendered as a <video> source, so only accept
 * https URLs, bound to the configured storage host (STORAGE_PUBLIC_URL) when set.
 */
function acceptablePublicUrl(url: string) {
  if (!/^https:\/\//.test(url)) return false;
  const publicBase = storagePublicUrl();
  if (!publicBase) return true;
  return url.startsWith(`${publicBase}/`);
}

export const POST = apiHandler("api/recordings", async (request) => {
  const user = await requireUser();
  const body = await readJson<Partial<RecordingDocument>>(request);
  if (!body.filename || !body.contentType || !body.key || !body.size) {
    return jsonError("filename, contentType, storage id, and size are required.", 400);
  }
  if (typeof body.filename !== "string" || body.filename.length > 200) return jsonError("That filename is too long.", 400);
  const size = Number(body.size);
  if (!Number.isFinite(size) || size <= 0 || size > MAX_RECORDING_BYTES) return jsonError("That recording size is not valid.", 400);
  if (body.publicUrl && !acceptablePublicUrl(body.publicUrl)) return jsonError("That playback URL is not allowed.", 400);

  const db = await getDatabase();
  // A recording belongs to whichever workspace its meeting belongs to.
  const meeting = body.meetingId && db ? await db.collection<Meeting>("meetings").findOne({ id: body.meetingId }) : null;

  const recording: RecordingDocument = {
    id: crypto.randomUUID(),
    ownerId: user._id.toString(),
    meetingId: body.meetingId,
    workspaceId: meeting?.workspaceId || body.workspaceId,
    provider: "storage",
    filename: body.filename,
    contentType: body.contentType,
    size,
    key: body.key,
    publicUrl: body.publicUrl,
    createdAt: new Date().toISOString(),
  };

  if (db) await db.collection<RecordingDocument>("recordings").insertOne(recording);
  log.info("recording saved", { recordingId: recording.id, ownerId: recording.ownerId, provider: recording.provider, size: recording.size, stored: Boolean(db) });
  return NextResponse.json({ recording, source: db ? "mongodb" : "demo" }, { status: 201 });
});
