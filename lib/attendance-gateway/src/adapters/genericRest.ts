import type { DeviceAdapter, GatewayPunch, AdapterTestResult, PunchEventType } from "../types.js";

/**
 * Generic REST adapter — for devices/middleware exposing an HTTP API that
 * returns punch logs as JSON. Fully implementable without vendor SDKs.
 *
 * Expected endpoint contract (configurable base URL + optional API key):
 *   GET {baseUrl}/health                          → 200
 *   GET {baseUrl}/punches?since={cursor}          → { events: [{ userId, timestamp, type, uid }], nextCursor }
 *
 * Biometric-template fields in responses are stripped before anything is
 * queued or forwarded.
 */
const TYPE_MAP: Record<string, PunchEventType> = {
  in: "CLOCK_IN", checkin: "CLOCK_IN", clock_in: "CLOCK_IN", "0": "CLOCK_IN",
  out: "CLOCK_OUT", checkout: "CLOCK_OUT", clock_out: "CLOCK_OUT", "1": "CLOCK_OUT",
  break_start: "BREAK_START", break_end: "BREAK_END",
  overtime_start: "OVERTIME_START", overtime_end: "OVERTIME_END",
};

const BIOMETRIC_FIELDS = ["template", "biometric_template", "fingerprint_data", "face_data", "fingerprint", "faceTemplate"];

export function sanitizeRaw(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (BIOMETRIC_FIELDS.includes(k)) continue;
    out[k] = v;
  }
  return out;
}

export class GenericRestAdapter implements DeviceAdapter {
  readonly type = "GENERIC_REST" as const;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey?: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private headers(): Record<string, string> {
    return this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {};
  }

  async testConnection(): Promise<AdapterTestResult> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/health`, { headers: this.headers() });
      return res.ok
        ? { ok: true, status: "REACHABLE", message: `Device reachable (${res.status})`, deviceTimeMs: Date.now() }
        : {
            ok: false,
            status: res.status === 401 || res.status === 403 ? "AUTH_FAILED" : "UNREACHABLE",
            message: `Device health returned ${res.status}`,
          };
    } catch (e) {
      return { ok: false, status: "UNREACHABLE", message: `Device unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  /** POST {baseUrl}/restart — device/middleware reboots the terminal. */
  async restartDevice(): Promise<{ ok: boolean; message: string }> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/restart`, { method: "POST", headers: this.headers() });
      return res.ok
        ? { ok: true, message: `Device restart accepted (${res.status})` }
        : { ok: false, message: `Device restart endpoint returned ${res.status}` };
    } catch (e) {
      return { ok: false, message: `Device restart request failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  async poll(sinceCursor: string | null): Promise<{ punches: GatewayPunch[]; nextCursor: string | null }> {
    const url = new URL(`${this.baseUrl}/punches`);
    if (sinceCursor) url.searchParams.set("since", sinceCursor);
    const res = await this.fetchImpl(url.toString(), { headers: this.headers() });
    if (!res.ok) throw new Error(`Device poll failed: ${res.status}`);
    const body = (await res.json()) as {
      events?: Array<Record<string, unknown>>;
      nextCursor?: string | null;
    };
    const punches: GatewayPunch[] = (body.events ?? []).flatMap((ev) => {
      const type = TYPE_MAP[String(ev.type ?? "").toLowerCase()];
      const timestamp = typeof ev.timestamp === "string" ? ev.timestamp : null;
      const userId = ev.userId !== undefined ? String(ev.userId) : null;
      if (!type || !timestamp || !userId) return [];
      return [{
        deviceUserId: userId,
        eventTime: new Date(timestamp).toISOString(),
        eventType: type,
        deviceEventUid: ev.uid !== undefined ? String(ev.uid) : undefined,
        raw: sanitizeRaw(ev),
      }];
    });
    return { punches, nextCursor: body.nextCursor ?? null };
  }
}
