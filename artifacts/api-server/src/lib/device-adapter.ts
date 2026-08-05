import type { AdapterResult } from "./ldap-adapter.js";

export interface DeviceConnectionOptions {
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
}

/**
 * Real attendance device API connection test. Connection details come from
 * the profile's options when provided (connectionParamsJson baseUrl, vault-
 * ref-resolved API key), falling back to global environment variables:
 *   DEVICE_API_URL, DEVICE_API_KEY
 * Calls the device gateway's health endpoint (GET {baseUrl}/health)
 * with the API key as a Bearer token.
 */
export async function testDeviceConnection(options: DeviceConnectionOptions = {}): Promise<AdapterResult> {
  const start = Date.now();
  const timeoutMs = options.timeoutMs ?? 5000;
  const baseUrl = options.baseUrl || process.env.DEVICE_API_URL;
  const apiKey = options.apiKey || process.env.DEVICE_API_KEY;

  const missing = [
    !baseUrl && "base URL (profile connection params or DEVICE_API_URL)",
    !apiKey && "API key (profile vault ref or DEVICE_API_KEY)",
  ].filter(Boolean);
  if (missing.length) {
    return {
      success: false,
      message: `Missing connection settings: ${missing.join(", ")}`,
      latencyMs: Date.now() - start,
      simulated: false,
    };
  }

  const healthUrl = `${baseUrl!.replace(/\/+$/, "")}/health`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(healthUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: controller.signal,
    });
    if (res.ok) {
      return {
        success: true,
        message: `Device API health check passed (${res.status}) at ${healthUrl}`,
        latencyMs: Date.now() - start,
        simulated: false,
      };
    }
    return {
      success: false,
      message: `Device API health check returned HTTP ${res.status} at ${healthUrl}`,
      latencyMs: Date.now() - start,
      simulated: false,
    };
  } catch (err: any) {
    const reason = err?.name === "AbortError" ? `timed out after ${timeoutMs}ms` : (err?.message ?? String(err));
    return {
      success: false,
      message: `Device API health check failed at ${healthUrl}: ${reason}`,
      latencyMs: Date.now() - start,
      simulated: false,
    };
  } finally {
    clearTimeout(timer);
  }
}
