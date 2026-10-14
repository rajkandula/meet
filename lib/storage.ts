import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Recordings and avatars go to any S3-compatible bucket. The browser uploads
 * straight to the bucket with a short-lived presigned PUT, so large media
 * never passes through the app server.
 *
 * Environment is read at call time, so a missing value shows up as
 * "uploads not configured" rather than a crash at import.
 */
function storageClient() {
  const bucketName = process.env.STORAGE_BUCKET;
  const accessKeyId = process.env.STORAGE_ACCESS_KEY_ID;
  const secretAccessKey = process.env.STORAGE_SECRET_ACCESS_KEY;
  const endpoint = process.env.STORAGE_ENDPOINT;
  if (!bucketName || !accessKeyId || !secretAccessKey || !endpoint) return null;

  return {
    bucketName,
    client: new S3Client({
      region: "auto",
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
    }),
  };
}

/** Public base URL that stored objects are served from, without a trailing slash. */
export function storagePublicUrl() {
  return process.env.STORAGE_PUBLIC_URL?.replace(/\/$/, "") || undefined;
}

export async function createRecordingUploadUrl(filename: string, contentType: string, ownerId?: string, prefix = "recordings") {
  const storage = storageClient();
  if (!storage) return null;

  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "-");
  const key = `${prefix}/${ownerId || "shared"}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${safeFilename}`;
  const command = new PutObjectCommand({ Bucket: storage.bucketName, Key: key, ContentType: contentType });
  const uploadUrl = await getSignedUrl(storage.client, command, { expiresIn: 900 });
  const publicBase = storagePublicUrl();

  return {
    uploadUrl,
    key,
    publicUrl: publicBase ? `${publicBase}/${key}` : undefined,
  };
}
