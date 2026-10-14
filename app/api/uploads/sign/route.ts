import { NextResponse } from "next/server";
import { apiHandler, jsonError, readJson, requireUser } from "@/lib/api";
import { createRecordingUploadUrl } from "@/lib/storage";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/uploads/sign");

export const POST = apiHandler("api/uploads/sign", async (request) => {
  const user = await requireUser();

  const body = await readJson<{ filename?: string; contentType?: string; kind?: string }>(request);
  if (!body.filename || !body.contentType) return jsonError("filename and contentType are required", 400);
  if (body.kind === "avatar" && !body.contentType.startsWith("image/")) {
    return jsonError("Profile pictures must be an image.", 400);
  }

  const signedUpload = await createRecordingUploadUrl(body.filename, body.contentType, user._id.toString(), body.kind === "avatar" ? "avatars" : "recordings");
  if (!signedUpload) {
    log.warn("upload requested but object storage is not configured", { kind: body.kind || "recording" });
    return NextResponse.json({
      configured: false,
      message: "Set the STORAGE_* variables (any S3-compatible bucket) to enable uploads.",
    });
  }

  log.info("upload url signed", { kind: body.kind || "recording", ownerId: user._id.toString() });
  return NextResponse.json({ configured: true, ...signedUpload });
});
