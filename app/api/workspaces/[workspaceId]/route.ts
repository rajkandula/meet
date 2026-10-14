import { NextResponse } from "next/server";
import { apiHandler, jsonError, readJson, requireUser } from "@/lib/api";
import { getDatabase } from "@/lib/mongodb";
import { createLogger } from "@/lib/logger";
import { workspaceNameError } from "@/lib/workspace-scope";
import type { Workspace } from "@/types/workspace";

const log = createLogger("api/workspaces/[workspaceId]");

export const PATCH = apiHandler("api/workspaces/[workspaceId]", async (request, { params }) => {
  const user = await requireUser();

  const body = await readJson<{ name?: string }>(request);
  const name = body.name?.trim();
  const nameError = workspaceNameError(name);
  if (nameError || !name) return jsonError(nameError || "A workspace name is required.", 400);

  const db = await getDatabase();
  if (!db) return NextResponse.json({ workspace: { id: params.workspaceId, name }, source: "demo" });

  const ownerId = user._id.toString();
  const result = await db.collection<Workspace>("workspaces").findOneAndUpdate(
    { id: params.workspaceId, ownerId },
    { $set: { name } },
    { returnDocument: "after" },
  );
  if (!result) return jsonError("We could not find that workspace.", 404);
  log.info("workspace renamed", { workspaceId: params.workspaceId, ownerId });

  return NextResponse.json({ workspace: { id: result.id, name: result.name, ownerId: result.ownerId, isDefault: result.isDefault, createdAt: result.createdAt }, source: "mongodb" });
});

export const DELETE = apiHandler("api/workspaces/[workspaceId]", async (_request, { params }) => {
  const user = await requireUser();

  const db = await getDatabase();
  if (!db) return NextResponse.json({ deleted: params.workspaceId, source: "demo" });

  const collection = db.collection<Workspace>("workspaces");
  const ownerId = user._id.toString();

  const total = await collection.countDocuments({ ownerId });
  if (total <= 1) return jsonError("You need at least one workspace.", 400);

  const result = await collection.deleteOne({ id: params.workspaceId, ownerId });
  if (result.deletedCount === 0) return jsonError("We could not find that workspace.", 404);

  // The delete dialog promises "your meetings and recordings stay in your
  // account": dropping their workspaceId hands them to the default workspace
  // (whose filter also claims unscoped rows) instead of stranding them.
  const [meetings, recordings] = await Promise.all([
    db.collection("meetings").updateMany({ workspaceId: params.workspaceId, ownerId }, { $unset: { workspaceId: "" } }),
    db.collection("recordings").updateMany({ workspaceId: params.workspaceId, ownerId }, { $unset: { workspaceId: "" } }),
  ]);
  log.info("workspace deleted", { workspaceId: params.workspaceId, ownerId, reassignedMeetings: meetings.modifiedCount, reassignedRecordings: recordings.modifiedCount });

  return NextResponse.json({ deleted: params.workspaceId, source: "mongodb" });
});
