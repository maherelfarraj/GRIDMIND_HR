import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import type { QueuedBatch } from "./types.js";

/**
 * Encrypted, file-backed punch queue.
 *
 * Every batch is persisted as one AES-256-GCM-encrypted file under the queue
 * directory, so punches survive gateway restarts and network outages while
 * remaining unreadable at rest. The key is derived from GATEWAY_QUEUE_KEY
 * (required in production; a device without the key cannot read the spool).
 *
 * File layout: [12-byte IV][16-byte auth tag][ciphertext]
 */
export class EncryptedQueue {
  private readonly key: Buffer;

  constructor(private readonly dir: string, queueKey: string) {
    if (!queueKey) throw new Error("EncryptedQueue requires a non-empty key (GATEWAY_QUEUE_KEY)");
    this.key = createHash("sha256").update(queueKey).digest();
  }

  private fileFor(batchUuid: string): string {
    if (!/^[a-zA-Z0-9-]+$/.test(batchUuid)) throw new Error("invalid batchUuid");
    return path.join(this.dir, `${batchUuid}.batch.enc`);
  }

  async init(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
  }

  async enqueue(batch: QueuedBatch): Promise<void> {
    const plaintext = Buffer.from(JSON.stringify(batch), "utf8");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const payload = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
    // Write atomically: temp file then rename.
    const target = this.fileFor(batch.batchUuid);
    const tmp = `${target}.tmp`;
    await fs.writeFile(tmp, payload);
    await fs.rename(tmp, target);
  }

  async read(batchUuid: string): Promise<QueuedBatch | null> {
    let payload: Buffer;
    try {
      payload = await fs.readFile(this.fileFor(batchUuid));
    } catch {
      return null;
    }
    const iv = payload.subarray(0, 12);
    const tag = payload.subarray(12, 28);
    const ciphertext = payload.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plaintext.toString("utf8")) as QueuedBatch;
  }

  /** List pending batch UUIDs, oldest first. */
  async pending(): Promise<string[]> {
    const files = await fs.readdir(this.dir);
    const entries = await Promise.all(
      files
        .filter((f) => f.endsWith(".batch.enc"))
        .map(async (f) => ({ uuid: f.replace(/\.batch\.enc$/, ""), mtime: (await fs.stat(path.join(this.dir, f))).mtimeMs })),
    );
    return entries.sort((a, b) => a.mtime - b.mtime).map((e) => e.uuid);
  }

  /**
   * Record a failed delivery attempt: bump the counter, schedule the next
   * eligible attempt with exponential backoff, and mark the batch terminal
   * once maxAttempts is exhausted (kept on disk, never auto-retried).
   */
  async markAttempt(batchUuid: string, opts: { baseBackoffMs: number; maxBackoffMs: number; maxAttempts: number }): Promise<QueuedBatch | null> {
    const batch = await this.read(batchUuid);
    if (!batch) return null;
    batch.attempts += 1;
    if (batch.attempts >= opts.maxAttempts) {
      batch.terminal = true;
    } else {
      const delay = Math.min(opts.baseBackoffMs * 2 ** (batch.attempts - 1), opts.maxBackoffMs);
      batch.nextAttemptAtMs = Date.now() + delay;
    }
    await this.enqueue(batch);
    return batch;
  }

  async remove(batchUuid: string): Promise<void> {
    await fs.rm(this.fileFor(batchUuid), { force: true });
  }
}
