import { buildSignedHeaders } from "./signing.js";
import type { GatewayPunch } from "./types.js";

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

  async heartbeat(adapterStatus?: string) {
    return this.post<{ ok: boolean; clockDriftMs: number | null; driftAlert: boolean }>("/gateway/heartbeat", {
      deviceTimeMs: Date.now(),
      adapterStatus,
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
