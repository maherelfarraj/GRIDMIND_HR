import { buildSignedHeaders } from "./signing.js";
import type { AdapterSdkInfo, AdapterTestResult, DeliveredCommand, GatewayPunch } from "./types.js";

/**
 * Signed HTTP client for the HR core. All requests carry HMAC headers; the
 * server rejects unknown/revoked registrations, bad signatures, and stale
 * timestamps.
 */
export class HrClient {
  constructor(
    private readonly opts: {
      hrApiUrl: string; // e.g. http://hr-core.local:8080/api
      gatewayId: number;
      signingKey: string; // sha256(secret) hex — never the plaintext secret
      fetchImpl?: typeof fetch;
    },
  ) {}

  private get fetchImpl(): typeof fetch {
    return this.opts.fetchImpl ?? fetch;
  }

  private async post<T>(path: string, payload: unknown): Promise<{ status: number; body: T }> {
    const body = JSON.stringify(payload);
    const res = await this.fetchImpl(`${this.opts.hrApiUrl}${path}`, {
      method: "POST",
      headers: buildSignedHeaders({ gatewayId: this.opts.gatewayId, signingKey: this.opts.signingKey, body }),
      body,
    });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as T };
  }

  async heartbeat(
    connectionTest?: AdapterTestResult | string,
    health?: { sdk?: AdapterSdkInfo; deviceClockSkewMs?: number | null; connectionTestRunAt?: number },
  ) {
    const structured = typeof connectionTest === "object" && connectionTest !== null ? connectionTest : undefined;
    return this.post<{
      ok: boolean;
      clockDriftMs: number | null;
      driftAlert: boolean;
      commands?: DeliveredCommand[];
      /**
       * True when an admin-requested connection test is still outstanding and
       * was NOT answered by this heartbeat (the result pre-dates the request).
       * The gateway should schedule an early tick so the next heartbeat
       * carries a fresh result and resolves the test.
       *
       * False when no test is pending, or when this heartbeat just answered
       * the pending test (result obtained after the request timestamp).
       */
      testRequested?: boolean;
    }>("/gateway/heartbeat", {
      deviceTimeMs: Date.now(),
      // Legacy free-text field kept for older HR cores.
      adapterStatus: structured ? structured.message : connectionTest,
      connectionTest: structured
        ? {
            ok: structured.ok,
            status: structured.status,
            message: structured.message,
            // Device clock skew measured at testConnection() time, so the
            // HR core admin screen can surface a drifting device clock.
            clockSkewMs: structured.clockSkewMs,
          }
        : undefined,
      // SDK presence/version and device↔gateway clock skew, so HR admins can
      // spot a missing vendor SDK or a drifting device clock remotely.
      ...(health?.sdk ? { sdkPresent: health.sdk.present, sdkVersion: health.sdk.version } : {}),
      ...(health && health.deviceClockSkewMs !== undefined ? { deviceClockSkewMs: health.deviceClockSkewMs } : {}),
      // When did this tick run testConnection()? The server uses this to
      // decide whether the result is fresh enough to answer a pending
      // admin-requested test (connectionTestRunAt >= connTestRequestedAt).
      // Absent on older gateways; server falls back to treating the result
      // as fresh (backward compatibility).
      ...(health?.connectionTestRunAt !== undefined ? { connectionTestRunAt: health.connectionTestRunAt } : {}),
    });
  }

  async uploadBatch(batchUuid: string, punches: GatewayPunch[]) {
    return this.post<{ ok: boolean; inserted: number; duplicates: number; unmapped: number; errors: number; replayed?: boolean }>(
      "/gateway/punches",
      { batchUuid, deviceTimeMs: Date.now(), events: punches },
    );
  }

  /** Report the outcome of remote commands delivered via heartbeat. */
  async ackCommands(acks: Array<{ commandId: number; ok: boolean; message?: string }>) {
    return this.post<{ ok: boolean; results: Array<{ commandId: number; status: string }> }>("/gateway/commands/ack", { acks });
  }

  async reconcile(batches: Array<{ batchUuid: string; eventCount: number }>) {
    return this.post<{ ok: boolean; results: Array<{ batchUuid: string; status: string }> }>("/gateway/reconcile", { batches });
  }
}
