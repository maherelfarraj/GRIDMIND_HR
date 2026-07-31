import { createHash, createHmac } from "crypto";

/**
 * HMAC request signing shared with the HR core.
 *
 * The registration secret is only known to the gateway; the HR core stores
 * sha256(secret). Both sides therefore use signingKey = sha256(secret) so the
 * server can verify without keeping the plaintext secret.
 *
 *   signature = HMAC-SHA256(signingKey, `${timestampMs}.${sha256(body)}`)
 */
export function deriveSigningKey(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function signRequest(signingKey: string, timestampMs: number, body: string | Buffer): string {
  const bodyHash = createHash("sha256").update(body).digest("hex");
  return createHmac("sha256", signingKey).update(`${timestampMs}.${bodyHash}`).digest("hex");
}

export function buildSignedHeaders(opts: {
  gatewayId: number;
  signingKey: string;
  body: string;
  nowMs?: number;
}): Record<string, string> {
  const ts = opts.nowMs ?? Date.now();
  return {
    "content-type": "application/json",
    "x-gateway-id": String(opts.gatewayId),
    "x-gateway-timestamp": String(ts),
    "x-gateway-signature": signRequest(opts.signingKey, ts, opts.body),
  };
}
