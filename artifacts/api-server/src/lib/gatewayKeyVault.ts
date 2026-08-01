import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

/**
 * Gateway signing-key vault.
 *
 * Historically gateway_registrations.secret_hash stored sha256(secret) in the
 * clear, and that value doubled as the HMAC verification key — so a database
 * leak was enough to forge signed punch batches.
 *
 * This module is a KMS-style abstraction that keeps the verification key
 * unusable without server-side key material stored OUTSIDE the database:
 *
 *  - The signing key (still sha256(secret), so gateways are unchanged) is
 *    wrapped with AES-256-GCM before persistence:
 *        v2:<iv hex>:<auth tag hex>:<ciphertext hex>
 *  - The wrapping key is derived from a server-side pepper taken from the
 *    GATEWAY_KEY_PEPPER environment secret (falling back to SESSION_SECRET,
 *    matching the config-package signing convention). Neither value ever
 *    touches the database.
 *  - Legacy rows (bare 64-char sha256 hex) are still readable so existing
 *    registrations keep working; rotateLegacyValue() re-wraps them and the
 *    server upgrades rows eagerly at startup and lazily on verification.
 *
 * Swapping in a real KMS/HSM later only requires reimplementing
 * protectSigningKey/recoverSigningKey.
 */

const ENVELOPE_PREFIX = "v2";
const LEGACY_RE = /^[0-9a-f]{64}$/;

function pepper(): string {
  const p = process.env.GATEWAY_KEY_PEPPER || process.env.SESSION_SECRET;
  if (!p) {
    throw new Error(
      "Gateway key vault requires GATEWAY_KEY_PEPPER or SESSION_SECRET to be set; refusing to handle gateway credentials without a server-side pepper.",
    );
  }
  return p;
}

/**
 * Optional previous pepper accepted during a rotation window. When set
 * (GATEWAY_KEY_PEPPER_PREVIOUS), envelopes wrapped under it are still
 * decryptable and are re-wrapped under the current pepper eagerly at startup
 * and lazily on verification. Never used for NEW envelopes.
 */
function previousPepper(): string | undefined {
  return process.env.GATEWAY_KEY_PEPPER_PREVIOUS || undefined;
}

/** 32-byte AES key derived from a server-side pepper (never persisted). */
function deriveWrappingKey(p: string): Buffer {
  return createHash("sha256").update(`gateway-key-vault:${p}`).digest();
}

function wrappingKey(): Buffer {
  return deriveWrappingKey(pepper());
}

/** True when the stored value is a protected (v2) envelope. */
export function isProtectedEnvelope(stored: string): boolean {
  return stored.startsWith(`${ENVELOPE_PREFIX}:`);
}

/** True when the stored value is a legacy bare sha256(secret) signing key. */
export function isLegacyStoredKey(stored: string): boolean {
  return LEGACY_RE.test(stored);
}

/** Wrap a signing key for persistence. */
export function protectSigningKey(signingKeyHex: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", wrappingKey(), iv);
  const ct = Buffer.concat([cipher.update(signingKeyHex, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENVELOPE_PREFIX}:${iv.toString("hex")}:${tag.toString("hex")}:${ct.toString("hex")}`;
}

function decryptEnvelope(stored: string, key: Buffer): string {
  const [, ivHex, tagHex, ctHex] = stored.split(":");
  if (!ivHex || !tagHex || !ctHex) throw new Error("Malformed gateway key envelope");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const pt = Buffer.concat([decipher.update(Buffer.from(ctHex, "hex")), decipher.final()]);
  return pt.toString("utf8");
}

/**
 * Recover the HMAC signing key from its stored form.
 * Returns the key plus:
 *  - `legacy`: the row still uses the legacy plaintext format
 *  - `needsRewrap`: the envelope was decrypted with the PREVIOUS pepper
 *    (GATEWAY_KEY_PEPPER_PREVIOUS) and should be re-wrapped under the
 *    current one.
 * Callers should rotate/re-wrap such rows. Throws on tampered or
 * undecryptable values (fail closed).
 */
export function recoverSigningKey(stored: string): {
  signingKey: string;
  legacy: boolean;
  needsRewrap: boolean;
} {
  if (isProtectedEnvelope(stored)) {
    try {
      return { signingKey: decryptEnvelope(stored, wrappingKey()), legacy: false, needsRewrap: false };
    } catch (currentErr) {
      // Rotation window: fall back to the previous pepper, if configured.
      const prev = previousPepper();
      if (prev) {
        try {
          return { signingKey: decryptEnvelope(stored, deriveWrappingKey(prev)), legacy: false, needsRewrap: true };
        } catch {
          // fall through to the fail-closed error below
        }
      }
      throw new Error(
        `Gateway key envelope undecryptable under the current${prev ? " or previous" : ""} pepper (tampered value or unannounced pepper rotation)`,
        { cause: currentErr },
      );
    }
  }
  if (isLegacyStoredKey(stored)) {
    // Legacy format: the stored value IS the signing key. Accepted for
    // backward compatibility; rotate on sight.
    return { signingKey: stored, legacy: true, needsRewrap: false };
  }
  throw new Error("Unrecognized gateway key format");
}

/** Rotation path for legacy rows: wrap the stored plaintext signing key. */
export function rotateLegacyValue(legacyStored: string): string {
  if (!isLegacyStoredKey(legacyStored)) throw new Error("Not a legacy gateway key");
  return protectSigningKey(legacyStored);
}

/**
 * Pepper-rotation path for envelope rows: decrypt with whichever pepper
 * works (current or previous) and re-encrypt under the CURRENT pepper.
 * Throws when the envelope is unrecoverable (fail closed).
 */
export function rewrapEnvelope(stored: string): string {
  if (!isProtectedEnvelope(stored)) throw new Error("Not a protected gateway key envelope");
  const { signingKey } = recoverSigningKey(stored);
  return protectSigningKey(signingKey);
}
