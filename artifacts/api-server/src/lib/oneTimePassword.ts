/**
 * Shared one-time password generator.
 *
 * Used both by startup provisioning (fallback for accounts with no
 * credentials) and by the on-demand admin "issue one-time password" flow.
 * 192 bits of entropy, URL-safe alphabet — safe to hand to an operator
 * verbally or over any out-of-band channel.
 */
import crypto from "node:crypto";

export function generateOneTimePassword(): string {
  return crypto.randomBytes(24).toString("base64url");
}
