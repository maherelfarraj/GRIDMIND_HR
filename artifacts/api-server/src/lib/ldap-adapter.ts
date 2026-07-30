import { Client } from "ldapts";

export interface AdapterResult {
  success: boolean;
  message: string;
  latencyMs: number;
  simulated: false;
}

/**
 * Real LDAP connection test. Reads connection details from environment
 * variables (vault-ref pattern — the DB stores only references, never values):
 *   LDAP_HOST, LDAP_PORT (default 389), LDAP_BIND_DN, LDAP_BIND_PASSWORD
 * Performs an actual bind against the directory server.
 */
export async function testLdapConnection(timeoutMs = 5000): Promise<AdapterResult> {
  const start = Date.now();
  const host = process.env.LDAP_HOST;
  const port = process.env.LDAP_PORT ?? "389";
  const bindDn = process.env.LDAP_BIND_DN;
  const bindPassword = process.env.LDAP_BIND_PASSWORD;

  const missing = [
    !host && "LDAP_HOST",
    !bindDn && "LDAP_BIND_DN",
    !bindPassword && "LDAP_BIND_PASSWORD",
  ].filter(Boolean);
  if (missing.length) {
    return {
      success: false,
      message: `Missing environment variables: ${missing.join(", ")}`,
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
