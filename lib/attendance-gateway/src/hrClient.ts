import { buildSignedHeaders } from "./signing.js";
import type { AdapterTestResult, GatewayPunch } from "./types.js";

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

  async heartbeat(connectionTest?: AdapterTestResult | string) {
    const structured = typeof connectionTest === "object" && connectionTest !== null ? connectionTest : undefined;
    return this.post<{ ok: boolean; clockDriftMs: number | null; driftAlert: boolean }>("/gateway/heartbeat", {
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
    });
  }

  async uploadBatch(batchUuid: string, punches: GatewayPunch[]) {
    return this.post<{ ok: boolean; inserted: number; duplicates: number; unmapped: number; errors: number; replayed?: boolean }>(
      "/gateway/punches",
      { batchUuid, deviceTimeMs: Date.now(), events: punches },
    );
  }

  async reconcile(batches: Array<{ batchUuid: string; eventCount: number }>) {
    return this.post<{ ok: boolean; results: Array<{ batchUuid: string; status: string }> }>("/gateway/reconcile", { batches });
  }
}
