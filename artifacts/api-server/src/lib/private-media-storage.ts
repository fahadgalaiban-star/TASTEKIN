import { randomUUID } from "crypto";

const SIDE_CAR_ENDPOINT = "http://127.0.0.1:1106";

function privateObjectDirectory() {
  const directory = process.env.PRIVATE_OBJECT_DIR;
  if (!directory) {
    throw new Error("PRIVATE_OBJECT_DIR is not configured");
  }
  return directory.replace(/\/$/, "");
}

function splitObjectPath(path: string) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length < 2) {
    throw new Error("Invalid object storage path");
  }
  return { bucketName: segments[0], objectName: segments.slice(1).join("/") };
}

async function signedObjectURL(
  fullPath: string,
  method: "GET" | "PUT" | "DELETE",
) {
  const { bucketName, objectName } = splitObjectPath(fullPath);
  const response = await fetch(
    `${SIDE_CAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bucket_name: bucketName,
        object_name: objectName,
        method,
        expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      }),
      signal: AbortSignal.timeout(30_000),
    },
  );

  if (!response.ok) {
    throw new Error(`Unable to sign object URL (${response.status})`);
  }

  const result = (await response.json()) as { signed_url?: string };
  if (!result.signed_url) {
    throw new Error("Object storage did not return a signed URL");
  }
  return result.signed_url;
}

export async function createPrivateMediaUpload() {
  const directory = privateObjectDirectory();
  const objectName = `uploads/${randomUUID()}`;
  const uploadURL = await signedObjectURL(`${directory}/${objectName}`, "PUT");
  return { uploadURL, objectPath: `/objects/${objectName}` };
}

export async function getPrivateMediaDownloadURL(objectPath: string) {
  if (
    !objectPath.startsWith("/objects/uploads/") ||
    objectPath.includes("..")
  ) {
    throw new Error("Invalid private object path");
  }
  const objectName = objectPath.slice("/objects/".length);
  return signedObjectURL(`${privateObjectDirectory()}/${objectName}`, "GET");
}

export async function deletePrivateMedia(objectPath: string) {
  if (!/^\/objects\/uploads\/[0-9a-fA-F-]{36}$/.test(objectPath)) {
    throw new Error("Invalid private object path");
  }
  const objectName = objectPath.slice("/objects/".length);
  const signedURL = await signedObjectURL(`${privateObjectDirectory()}/${objectName}`, "DELETE");
  const response = await fetch(signedURL, { method: "DELETE", signal: AbortSignal.timeout(30_000) });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Unable to delete private media (${response.status})`);
  }
}