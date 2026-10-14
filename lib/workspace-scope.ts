import type { Db, Filter, Document } from "mongodb";
import type { Workspace } from "@/types/workspace";

/**
 * Builds a Mongo filter that limits documents to one workspace.
 *
 * Rows created before workspaces existed have no workspaceId, so the user's
 * default workspace also claims them — otherwise that history would vanish
 * from every workspace instead of staying where it has always appeared.
 */
export async function workspaceFilter(db: Db, ownerId: string | undefined, workspaceId?: string | null): Promise<Filter<Document>> {
  if (!workspaceId) return {};

  const workspace = await db.collection<Workspace>("workspaces").findOne({ id: workspaceId, ownerId });
  if (workspace?.isDefault) {
    return { $or: [{ workspaceId }, { workspaceId: { $exists: false } }, { workspaceId: null }] };
  }
  return { workspaceId };
}

export function workspaceIdFrom(request: Request) {
  return new URL(request.url).searchParams.get("workspaceId") || undefined;
}

/** Shared by workspace create and rename; returns the error message or null. */
export function workspaceNameError(name: string | undefined): string | null {
  if (!name) return "A workspace name is required.";
  if (name.length > 60) return "Workspace names must be 60 characters or fewer.";
  return null;
}
