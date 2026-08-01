import { Storage } from "@google-cloud/storage";
import * as path from "node:path";

// Offsite (object storage) copies of backup archives.
//
// Every completed pg_dump is uploaded to the app's private object storage
// bucket so a loss of the server disk cannot destroy the backups. Objects are
// addressed by a gs://<bucket>/<object> URI stored on the backup record
// (offsite_location), independent of the local file path (storage_location).

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

/** Parse "/<bucket>/<object...>" (PRIVATE_OBJECT_DIR format) into parts. */
function parseObjectPath(p: string): { bucketName: string; objectName: string } {
  if (!p.startsWith("/")) p = `/${p}`;
  const parts = p.split("/");
  if (parts.length < 3) {
    throw new Error(`Invalid object storage path: ${p}`);
  }
  return { bucketName: parts[1], objectName: parts.slice(2).join("/") };
}

export function isOffsiteConfigured(): boolean {
  return Boolean(process.env.PRIVATE_OBJECT_DIR);
}

/** gs:// URI under PRIVATE_OBJECT_DIR/backups/ for a given archive file name. */
function offsiteUriFor(fileName: string): string {
  const dir = process.env.PRIVATE_OBJECT_DIR;
  if (!dir) {
    throw new Error(
      "PRIVATE_OBJECT_DIR is not set — offsite backup storage is not configured"
    );
  }
  const { bucketName, objectName } = parseObjectPath(dir);
  const prefix = objectName.replace(/\/+$/, "");
  return `gs://${bucketName}/${prefix}/backups/${fileName}`;
}

function fileForUri(uri: string): {
  bucketName: string;
  objectName: string;
} {
  const m = /^gs:\/\/([^/]+)\/(.+)$/.exec(uri);
  if (!m) throw new Error(`Invalid offsite location URI: ${uri}`);
  return { bucketName: m[1], objectName: m[2] };
}

/**
 * Upload a local backup archive to offsite object storage.
 * Returns the gs:// URI of the uploaded object. Throws on failure.
 */
export async function uploadBackupOffsite(localPath: string): Promise<string> {
  const uri = offsiteUriFor(path.basename(localPath));
  const { bucketName, objectName } = fileForUri(uri);
  await objectStorageClient.bucket(bucketName).upload(localPath, {
    destination: objectName,
    contentType: "application/octet-stream",
    resumable: false,
    validation: "crc32c",
  });
  return uri;
}

/**
 * Download an offsite backup archive back to a local path (used when the
 * local copy is missing during a restore test). Throws on failure.
 */
export async function downloadBackupFromOffsite(
  offsiteUri: string,
  localPath: string
): Promise<void> {
  const { bucketName, objectName } = fileForUri(offsiteUri);
  const file = objectStorageClient.bucket(bucketName).file(objectName);
  const [exists] = await file.exists();
  if (!exists) {
    throw new Error(`Offsite backup object not found: ${offsiteUri}`);
  }
  await file.download({ destination: localPath });
}
