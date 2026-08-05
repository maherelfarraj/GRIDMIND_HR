import { Client } from "ldapts";

export interface AdapterResult {
  success: boolean;
  message: string;
  latencyMs: number;
  simulated: false;
}

export interface LdapConnectionOptions {
  host?: string;
  port?: string | number;
  bindDn?: string;
  bindPassword?: string;
  timeoutMs?: number;
}

/**
 * Real LDAP connection test. Connection details come from the profile's
 * options when provided (connectionParamsJson host/port, vault-ref-resolved
 * bind credentials), falling back to global environment variables:
 *   LDAP_HOST, LDAP_PORT (default 389), LDAP_BIND_DN, LDAP_BIND_PASSWORD
 * Performs an actual bind against the directory server.
 */
export async function testLdapConnection(options: LdapConnectionOptions = {}): Promise<AdapterResult> {
  const start = Date.now();
  const timeoutMs = options.timeoutMs ?? 5000;
  const host = options.host || process.env.LDAP_HOST;
  const port = String(options.port || process.env.LDAP_PORT || "389");
  const bindDn = options.bindDn || process.env.LDAP_BIND_DN;
  const bindPassword = options.bindPassword || process.env.LDAP_BIND_PASSWORD;

  const missing = [
    !host && "host (profile connection params or LDAP_HOST)",
    !bindDn && "bind DN (profile connection params or LDAP_BIND_DN)",
    !bindPassword && "bind password (profile vault ref or LDAP_BIND_PASSWORD)",
  ].filter(Boolean);
  if (missing.length) {
    return {
      success: false,
      message: `Missing connection settings: ${missing.join(", ")}`,
      latencyMs: Date.now() - start,
      simulated: false,
    };
  }

  const url = `ldap://${host}:${port}`;
  const client = new Client({ url, timeout: timeoutMs, connectTimeout: timeoutMs });
  try {
    await client.bind(bindDn!, bindPassword!);
    return {
      success: true,
      message: `LDAP bind succeeded against ${url} as ${bindDn}`,
      latencyMs: Date.now() - start,
      simulated: false,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `LDAP bind failed against ${url}: ${err?.message ?? String(err)}`,
      latencyMs: Date.now() - start,
      simulated: false,
    };
  } finally {
    try { await client.unbind(); } catch { /* ignore */ }
  }
}
