/**
 * Shared helper: resolve per-profile adapter options from a connection profile's
 * connectionParamsJson and linked credential vault ref (process.env[vaultKeyRef]).
 *
 * Used by both the manual /test route and the scheduled health monitor so that
 * per-profile hosts/secrets are honoured in health checks, not just manual tests.
 */
import { eq } from "drizzle-orm";
import { db, integrationCredentialVaultRefsTable } from "@workspace/db";
import type { IntegrationConnectionProfile } from "@workspace/db";
import type { LdapConnectionOptions } from "./ldap-adapter.js";
import type { SmtpConnectionOptions } from "./smtp-adapter.js";
import type { DeviceConnectionOptions } from "./device-adapter.js";

export interface ProfileConnectionOptions {
  ldap?: LdapConnectionOptions;
  smtp?: SmtpConnectionOptions;
  device?: DeviceConnectionOptions;
}

/**
 * The effective connection target for a profile — host/port for LDAP/SMTP,
 * baseUrl for attendance devices. usingGlobalDefault is true when the profile's
 * connectionParamsJson had no host/baseUrl and the value came from a process.env
 * fallback. This is computed without a DB call (vault refs only carry credentials,
 * not addresses) so it is safe to call for every row in a list response.
 */
export interface ProfileResolvedTarget {
  /** Hostname (LDAP, SMTP) or null (attendance_device uses baseUrl, other types). */
  host: string | null;
  /** Port string (LDAP, SMTP) or null. */
  port: string | null;
  /** Base URL (attendance_device) or null. */
  baseUrl: string | null;
  /** True when the host/baseUrl came from a global env-var fallback rather than the profile's own params. */
  usingGlobalDefault: boolean;
}

/**
 * Derive the effective connection target from a profile's connectionParamsJson
 * and global env-var fallbacks — without hitting the DB or loading credentials.
 * Safe to call for every profile in a list response.
 */
export function resolveProfileTarget(
  profile: Pick<IntegrationConnectionProfile, "integrationType" | "connectionParamsJson">,
): ProfileResolvedTarget {
  let params: Record<string, any> = {};
  try {
    params = JSON.parse(profile.connectionParamsJson || "{}");
  } catch {
    /* malformed JSON — treat as empty */
  }

  switch (profile.integrationType) {
    case "ldap":
    case "active_directory": {
      const profileHost: string | undefined = params.host;
      const profilePort: string | undefined = params.port != null ? String(params.port) : undefined;
      const envHost = process.env.LDAP_HOST;
      const envPort = process.env.LDAP_PORT ?? "389";
      const host = profileHost || envHost || null;
      const port = profilePort || envPort;
      return {
        host,
        port: host ? port : null,
        baseUrl: null,
        usingGlobalDefault: !profileHost && !!envHost,
      };
    }
    case "smtp": {
      const profileHost: string | undefined = params.host;
      const profilePort: string | undefined = params.port != null ? String(params.port) : undefined;
      const envHost = process.env.SMTP_HOST;
      const envPort = process.env.SMTP_PORT ?? "587";
      const host = profileHost || envHost || null;
      const port = profilePort || envPort;
      return {
        host,
        port: host ? port : null,
        baseUrl: null,
        usingGlobalDefault: !profileHost && !!envHost,
      };
    }
    case "attendance_device": {
      const profileBaseUrl: string | undefined = params.baseUrl;
      const profileHost: string | undefined = params.host;
      const profilePort: string | undefined = params.port != null ? String(params.port) : undefined;
      const envBaseUrl = process.env.DEVICE_API_URL;
      if (profileBaseUrl) {
        return { host: null, port: null, baseUrl: profileBaseUrl, usingGlobalDefault: false };
      }
      if (profileHost) {
        const synthesized = `http://${profileHost}${profilePort ? `:${profilePort}` : ""}`;
        return { host: null, port: null, baseUrl: synthesized, usingGlobalDefault: false };
      }
      if (envBaseUrl) {
        return { host: null, port: null, baseUrl: envBaseUrl, usingGlobalDefault: true };
      }
      return { host: null, port: null, baseUrl: null, usingGlobalDefault: false };
    }
    default:
      return { host: null, port: null, baseUrl: null, usingGlobalDefault: false };
  }
}

/**
 * Parses the profile's connectionParamsJson and resolves any linked credential
 * vault ref (reading the key/secret from process.env). Returns an object with
 * the appropriate per-type adapter options. Fields are only set when the profile
 * or vault ref provides a value; callers / adapters fall back to global env vars
 * for any absent field.
 */
export async function resolveProfileConnection(
  profile: Pick<IntegrationConnectionProfile, "integrationType" | "connectionParamsJson" | "credentialVaultRefId">,
): Promise<ProfileConnectionOptions> {
  let params: Record<string, any> = {};
  try {
    params = JSON.parse(profile.connectionParamsJson || "{}");
  } catch {
    /* malformed JSON — fall back to globals only */
  }

  let vaultKeyValue: string | undefined;
  let vaultSecretValue: string | undefined;
  if (profile.credentialVaultRefId) {
    const [vaultRef] = await db
      .select()
      .from(integrationCredentialVaultRefsTable)
      .where(eq(integrationCredentialVaultRefsTable.id, profile.credentialVaultRefId));
    if (vaultRef) {
      if (vaultRef.vaultKeyRef) vaultKeyValue = process.env[vaultRef.vaultKeyRef];
      if (vaultRef.vaultSecretRef) vaultSecretValue = process.env[vaultRef.vaultSecretRef];
    }
  }

  // Resolved secret: prefer the "secret" slot over the "key" slot so that
  // vaultKeyRef can hold the username/key-id while vaultSecretRef holds the
  // password/API-secret.
  const secret = vaultSecretValue ?? vaultKeyValue;

  switch (profile.integrationType) {
    case "ldap":
    case "active_directory":
      return {
        ldap: {
          host: params.host,
          port: params.port,
          bindDn: params.bindDn,
          bindPassword: secret,
        },
      };
    case "smtp":
      return {
        smtp: {
          host: params.host,
          port: params.port,
          user: params.user,
          pass: secret,
        },
      };
    case "attendance_device":
      return {
        device: {
          baseUrl:
            params.baseUrl ??
            (params.host
              ? `http://${params.host}${params.port ? `:${params.port}` : ""}`
              : undefined),
          apiKey: secret,
        },
      };
    default:
      return {};
  }
}
