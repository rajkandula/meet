/**
 * Shapes of the MongoDB documents that more than one route reads.
 * Declared once here instead of re-typed ad hoc at every call site.
 */

/** One row per user per meeting, written when a room token is issued. */
export type ParticipantDocument = {
  meetingId: string;
  userId: string;
  name: string;
  username: string;
  joinedAt: string;
};

export type RecordingDocument = {
  id: string;
  ownerId: string;
  /** Where the file lives: "storage" is the app's S3-compatible bucket. */
  provider: "storage";
  filename: string;
  contentType: string;
  size: number;
  key?: string;
  publicUrl?: string;
  meetingId?: string;
  workspaceId?: string;
  createdAt: string;
};
