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
