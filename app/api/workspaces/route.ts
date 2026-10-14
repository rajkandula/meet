import { NextResponse } from "next/server";
import { apiHandler, jsonError, readJson, requireUser } from "@/lib/api";
import { getDatabase } from "@/lib/mongodb";
import { createLogger } from "@/lib/logger";
import { fallbackWorkspaces } from "@/lib/demo-data";
import { workspaceNameError } from "@/lib/workspace-scope";
import type { Workspace } from "@/types/workspace";

const log = createLogger("api/workspaces");

/** Strips Mongo's _id so responses always share one workspace shape. */
function sanitize(workspace: Workspace): Workspace {
  return { id: workspace.id, name: workspace.name, ownerId: workspace.ownerId, isDefault: workspace.isDefault, createdAt: workspace.createdAt };
}

export const GET = apiHandler("api/workspaces", async () => {
  const user = await requireUser();

  const db = await getDatabase();
  if (!db) return NextResponse.json({ workspaces: fallbackWorkspaces, source: "demo" });

  const collection = db.collection<Workspace>("workspaces");
  const ownerId = user._id.toString();
  let workspaces: Workspace[] = await collection.find({ ownerId }).sort({ createdAt: 1 }).toArray();

  // First visit: every account starts with a default personal workspace.
  if (workspaces.length === 0) {
    const personal: Workspace = { id: crypto.randomUUID(), name: "Personal", ownerId, isDefault: true, createdAt: new Date().toISOString() };
    await collection.insertOne(personal);
    workspaces = [personal];
    log.info("default workspace created", { workspaceId: personal.id, ownerId });
  }

  return NextResponse.json({ workspaces: workspaces.map(sanitize), source: "mongodb" });
});

export const POST = apiHandler("api/workspaces", async (request) => {
  const user = await requireUser();

  const body = await readJson<{ name?: string }>(request);
  const name = body.name?.trim();
  const nameError = workspaceNameError(name);
  if (nameError || !name) return jsonError(nameError || "A workspace name is required.", 400);

  const workspace: Workspace = { id: crypto.randomUUID(), name, ownerId: user._id.toString(), isDefault: false, createdAt: new Date().toISOString() };

  const db = await getDatabase();
  if (db) await db.collection<Workspace>("workspaces").insertOne(workspace);
  log.info("workspace created", { workspaceId: workspace.id, ownerId: workspace.ownerId, stored: Boolean(db) });

  return NextResponse.json({ workspace: sanitize(workspace), source: db ? "mongodb" : "demo" }, { status: 201 });
});
