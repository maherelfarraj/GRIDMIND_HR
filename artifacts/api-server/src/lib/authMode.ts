import { logger } from "./logger";

/**
 * Central auth-mode switch. Authentication is ENFORCED BY DEFAULT.
 *
 * The only way to disable session auth is the explicit dev-only opt-out
 * PILOT_AUTH="false". Any other value — unset, misspelled, "true" — leaves
 * auth on, so a missing or typo'd env var in production fails closed.
 *
 * Read at request time (not module load) so tests can toggle it per-suite.
 */
export function isAuthEnforced(): boolean {
  return process.env.PILOT_AUTH !== "false";
}

/**
 * Startup guard: refuse to boot a production server with auth disabled,
 * and log a loud warning when running in demo mode anywhere else.
 */
export function assertAuthModeSafe(): void {
  if (isAuthEnforced()) return;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "FATAL: PILOT_AUTH=false disables authentication and is not allowed when NODE_ENV=production. " +
      "Unset PILOT_AUTH (auth is on by default) or set PILOT_AUTH=true.",
    );
  }
  logger.warn(
    "***********************************************************************\n" +
    "* SECURITY WARNING: authentication is DISABLED (PILOT_AUTH=false).   *\n" +
    "* Every endpoint is readable and writable without a session.         *\n" +
    "* This mode is for local development only — never deploy like this.  *\n" +
    "***********************************************************************",
  );
}
