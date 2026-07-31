import type { DeviceAdapter, GatewayPunch, AdapterTestResult, PunchEventType } from "../types.js";
import { sanitizeRaw } from "./genericRest.js";

/**
 * ZKTeco / Suprema adapters — middleware REST implementations.
 *
 * The devices' native binary protocols (ZKTeco "PUSH"/UDP 4370; Suprema
 * BioStar SDK/TCP) still require the licensed vendor SDK and a physical
 * device on the gateway host. However, both vendors ship official
 * middleware with documented REST APIs that most deployments already run:
 *
 *   - ZKTeco  → ZKBioTime / BioTime web server (token auth,
 *               `/iclock/api/transactions/` punch log endpoint)
 *   - Suprema → BioStar 2 server (`/api/login` session auth,
 *               `/api/events/search` T&A event endpoint)
 *
 * When the middleware base URL + credentials are configured, these adapters
 * are fully operational: they poll punch metadata, map vendor punch states
 * to gateway event types, and feed the unchanged encrypted-queue + signed
 * HrClient pipeline. When NOT configured, they keep reporting the explicit
 * "requires vendor SDK / middleware" status instead of pretending to work.
 *
 * SANITIZATION: only whitelisted metadata fields are forwarded. Raw
 * biometric templates never leave the device layer — vendor rows are first
 * reduced to a metadata whitelist, then passed through sanitizeRaw() as a
 * second line of defense.
 */

// ─── Shared helpers ──────────────────────────────────────────────────────────

/** Whitelist-copy vendor metadata; anything not listed (templates, images…) is dropped. */
function pickMeta(row: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const v = row[k];
    if (v === undefined || v === null) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = v;
  }
  return sanitizeRaw(out);
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Parse vendor timestamps ("YYYY-MM-DD HH:MM:SS" or ISO) to ISO 8601, or null. */
function toIso(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const d = new Date(value.includes("T") ? value : value.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Cursor token — lossless incremental polling.
 *
 * A bare timestamp watermark loses events: two punches can share a timestamp
 * (shift boundaries), and "skip everything <= watermark" drops the ones not
 * yet seen. The cursor therefore carries:
 *   t    — highest event time fully processed (ISO)
 *   ids  — ALL vendor event ids already seen AT exactly `t`
 *   next — vendor continuation URL when a poll had to stop mid-pagination
 *          (ZKBioTime `next` link), so no page is ever skipped
 * Polls re-query inclusively from `t` and drop only rows strictly older than
 * `t` or listed in `ids`. Any residual replay is harmless: the HR core
 * dedupes on deviceEventUid.
 */
interface CursorToken {
  t: string | null;
  ids: string[];
  next?: string;
}

function decodeCursor(cursor: string | null): CursorToken {
  if (!cursor) return { t: null, ids: [] };
  try {
    const parsed = JSON.parse(cursor) as Partial<CursorToken>;
    if (typeof parsed === "object" && parsed !== null && ("t" in parsed || "ids" in parsed)) {
      return { t: parsed.t ?? null, ids: Array.isArray(parsed.ids) ? parsed.ids.map(String) : [], next: typeof parsed.next === "string" ? parsed.next : undefined };
    }
  } catch {
    /* legacy plain-ISO cursor */
  }
  return { t: cursor, ids: [] };
}

function encodeCursor(token: CursorToken): string | null {
  if (!token.t && !token.next) return null;
  return JSON.stringify(token.next ? token : { t: token.t, ids: token.ids });
}

/**
 * Tracks the boundary (max event time + all ids at that time) across a poll.
 *
 * Replay filtering compares only against the FROZEN prior cursor, never the
 * evolving per-poll maximum — so vendor responses in any order (descending,
 * unsorted) cannot cause valid rows to be discarded mid-poll.
 */
class BoundaryTracker {
  private readonly prevT: string | null;
  private readonly prevIds: Set<string>;
  t: string | null;
  ids: Set<string>;
  constructor(prev: CursorToken) {
    this.prevT = prev.t;
    this.prevIds = new Set(prev.ids);
    this.t = prev.t;
    this.ids = new Set(prev.ids);
  }
  /** Returns false when the event was already processed by a PREVIOUS poll. */
  admit(eventTime: string, id: string): boolean {
    if (this.prevT && eventTime < this.prevT) return false;
    if (this.prevT && eventTime === this.prevT && this.prevIds.has(id)) return false;
    // order-independent boundary collection
    if (!this.t || eventTime > this.t) {
      this.t = eventTime;
      this.ids = new Set([id]);
    } else if (eventTime === this.t) {
      this.ids.add(id);
    }
    return true;
  }
  token(next?: string): CursorToken {
    return { t: this.t, ids: [...this.ids], next };
  }
}

const NOT_CONFIGURED_SUFFIX =
  "Native device protocols additionally require the vendor SDK/licensed driver and a physical device on the network. " +
  "Use GENERIC_REST, CSV import, or SIMULATOR until then.";

// ─── ZKTeco (ZKBioTime / BioTime middleware REST API) ────────────────────────

export interface ZktecoConfig {
  /** ZKBioTime/BioTime server base URL, e.g. http://biotime.local:8000 */
  baseUrl: string;
  username: string;
  password: string;
}

/** ZKBioTime punch_state → gateway event type. */
const ZK_PUNCH_STATE: Record<string, PunchEventType> = {
  "0": "CLOCK_IN",
  "1": "CLOCK_OUT",
  "2": "BREAK_START", // Break Out (leaving for break)
  "3": "BREAK_END",   // Break In (back from break)
  "4": "OVERTIME_START",
  "5": "OVERTIME_END",
};

const ZK_META_KEYS = ["id", "emp_code", "punch_time", "punch_state", "verify_type", "terminal_sn", "terminal_alias", "area_alias"];

export class ZktecoAdapter implements DeviceAdapter {
  readonly type = "ZKTECO" as const;
  private token: string | null = null;

  constructor(
    private readonly config?: ZktecoConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private notConfiguredMessage(): string {
    return (
      "ZKTeco integration is not configured. Set ZKTECO_API_URL/ZKTECO_USERNAME/ZKTECO_PASSWORD to poll a ZKBioTime/BioTime middleware server. " +
      NOT_CONFIGURED_SUFFIX
    );
  }

  private async login(): Promise<string> {
    const cfg = this.config!;
    const res = await this.fetchImpl(`${cfg.baseUrl}/api-token-auth/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: cfg.username, password: cfg.password }),
    });
    if (!res.ok) throw new Error(`ZKBioTime auth failed: ${res.status}`);
    const body = (await res.json()) as { token?: string };
    if (!body.token) throw new Error("ZKBioTime auth response missing token");
    this.token = body.token;
    return body.token;
  }

  private async authedGet(url: string): Promise<Response> {
    const token = this.token ?? (await this.login());
    let res = await this.fetchImpl(url, { headers: { authorization: `Token ${token}` } });
    if (res.status === 401 || res.status === 403) {
      // session expired — re-authenticate once
      const fresh = await this.login();
      res = await this.fetchImpl(url, { headers: { authorization: `Token ${fresh}` } });
    }
    return res;
  }

  async testConnection(): Promise<AdapterTestResult> {
    if (!this.config) {
      return { ok: false, status: "NOT_CONFIGURED", requiresVendorSdk: true, message: this.notConfiguredMessage() };
    }
    try {
      const res = await this.authedGet(`${this.config.baseUrl}/iclock/api/transactions/?page_size=1`);
      return res.ok
        ? { ok: true, status: "REACHABLE", message: `ZKBioTime middleware reachable (${res.status})`, deviceTimeMs: Date.now() }
        : {
            ok: false,
            status: res.status === 401 || res.status === 403 ? "AUTH_FAILED" : "UNREACHABLE",
            message: `ZKBioTime transactions endpoint returned ${res.status}`,
          };
    } catch (e) {
      const msg = errMsg(e);
      return {
        ok: false,
        status: /auth/i.test(msg) ? "AUTH_FAILED" : "UNREACHABLE",
        message: /auth/i.test(msg) ? `ZKBioTime authentication failed: ${msg}` : `ZKBioTime middleware unreachable: ${msg}`,
      };
    }
  }

  async poll(sinceCursor: string | null): Promise<{ punches: GatewayPunch[]; nextCursor: string | null }> {
    if (!this.config) {
      throw new Error(`ZKTeco adapter not operational: middleware not configured and vendor SDK not installed. ${this.notConfiguredMessage()}`);
    }
    const cur = decodeCursor(sinceCursor);
    const boundary = new BoundaryTracker(cur);
    const punches: GatewayPunch[] = [];

    const firstFromTime = (): string => {
      const u = new URL(`${this.config!.baseUrl}/iclock/api/transactions/`);
      u.searchParams.set("page_size", "200");
      // inclusive start_time: same-timestamp events replay and are filtered via
      // the id set. Formatted in host-local time to mirror toIso()'s parsing of
      // ZKBioTime's local-time punch_time strings.
      if (cur.t) {
        const d = new Date(cur.t);
        const p = (n: number): string => String(n).padStart(2, "0");
        u.searchParams.set(
          "start_time",
          `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`,
        );
      }
      return u.toString();
    };

    let url: string | null = cur.next ?? firstFromTime();
    let resumedFromNext = Boolean(cur.next);
    let pages = 0;
    const MAX_PAGES = 20;
    while (url && pages < MAX_PAGES) {
      pages += 1;
      const res = await this.authedGet(url);
      if (!res.ok) {
        // a persisted continuation URL can expire — fall back to the time watermark once
        if (resumedFromNext) {
          resumedFromNext = false;
          url = firstFromTime();
          pages -= 1;
          continue;
        }
        throw new Error(`ZKBioTime poll failed: ${res.status}`);
      }
      resumedFromNext = false;
      const body = (await res.json()) as { data?: Array<Record<string, unknown>>; next?: string | null };
      for (const row of body.data ?? []) {
        const eventType = ZK_PUNCH_STATE[String(row.punch_state ?? "")];
        const eventTime = toIso(row.punch_time);
        const userId = row.emp_code !== undefined && row.emp_code !== null ? String(row.emp_code) : null;
        const rowId = row.id !== undefined && row.id !== null ? String(row.id) : null;
        if (!eventType || !eventTime || !userId || rowId === null) continue;
        if (!boundary.admit(eventTime, rowId)) continue; // already processed in an earlier poll
        punches.push({
          deviceUserId: userId,
          eventTime,
          eventType,
          deviceEventUid: `zk-${rowId}`,
          raw: pickMeta(row, ZK_META_KEYS),
        });
      }
      url = body.next ?? null;
    }
    // If pagination didn't finish within the page budget, persist the vendor
    // continuation URL so the next poll resumes exactly where this one stopped.
    return { punches, nextCursor: encodeCursor(boundary.token(url ?? undefined)) };
  }
}

// ─── Suprema (BioStar 2 server REST API) ─────────────────────────────────────

export interface SupremaConfig {
  /** BioStar 2 server base URL, e.g. https://biostar.local */
  baseUrl: string;
  loginId: string;
  password: string;
}

/** BioStar 2 T&A key (device-configured 1..6) → gateway event type. */
const BIOSTAR_TNA_KEY: Record<string, PunchEventType> = {
  "1": "CLOCK_IN",
  "2": "CLOCK_OUT",
  "3": "BREAK_START",
  "4": "BREAK_END",
  "5": "OVERTIME_START",
  "6": "OVERTIME_END",
};

const BIOSTAR_META_KEYS = ["id", "datetime", "tna_key", "index"];

export class SupremaAdapter implements DeviceAdapter {
  readonly type = "SUPREMA" as const;
  private sessionId: string | null = null;

  constructor(
    private readonly config?: SupremaConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private notConfiguredMessage(): string {
    return (
      "Suprema integration is not configured. Set SUPREMA_API_URL/SUPREMA_LOGIN_ID/SUPREMA_PASSWORD to poll a BioStar 2 server. " +
      NOT_CONFIGURED_SUFFIX
    );
  }

  private async login(): Promise<string> {
    const cfg = this.config!;
    const res = await this.fetchImpl(`${cfg.baseUrl}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ User: { login_id: cfg.loginId, password: cfg.password } }),
    });
    if (!res.ok) throw new Error(`BioStar 2 login failed: ${res.status}`);
    const session = res.headers.get("bs-session-id");
    if (!session) throw new Error("BioStar 2 login response missing bs-session-id header");
    this.sessionId = session;
    return session;
  }

  private async searchEvents(sinceIso: string | null, limit: number, offset = 0): Promise<Array<Record<string, unknown>>> {
    const cfg = this.config!;
    const query = {
      Query: {
        limit,
        offset,
        // GREATER on a point 1s BEFORE the watermark keeps same-second events
        // (BioStar datetime is second-granular); replays are filtered by the
        // cursor id set + server-side UID dedupe.
        conditions: sinceIso
          ? [{ column: "datetime", operator: 3 /* GREATER */, values: [new Date(new Date(sinceIso).getTime() - 1000).toISOString()] }]
          : [],
        orders: [{ column: "datetime", descending: false }],
      },
    };
    const doSearch = async (session: string): Promise<Response> =>
      this.fetchImpl(`${cfg.baseUrl}/api/events/search`, {
        method: "POST",
        headers: { "content-type": "application/json", "bs-session-id": session },
        body: JSON.stringify(query),
      });
    let res = await doSearch(this.sessionId ?? (await this.login()));
    if (res.status === 401) res = await doSearch(await this.login());
    if (!res.ok) throw new Error(`BioStar 2 events/search failed: ${res.status}`);
    const body = (await res.json()) as { EventCollection?: { rows?: Array<Record<string, unknown>> } };
    return body.EventCollection?.rows ?? [];
  }

  async testConnection(): Promise<AdapterTestResult> {
    if (!this.config) {
      return { ok: false, status: "NOT_CONFIGURED", requiresVendorSdk: true, message: this.notConfiguredMessage() };
    }
    try {
      await this.searchEvents(null, 1);
      return { ok: true, status: "REACHABLE", message: "BioStar 2 server reachable", deviceTimeMs: Date.now() };
    } catch (e) {
      const msg = errMsg(e);
      return {
        ok: false,
        status: /auth|401|403/i.test(msg) ? "AUTH_FAILED" : "UNREACHABLE",
        message: /auth|401|403/i.test(msg) ? `BioStar 2 authentication failed: ${msg}` : `BioStar 2 server unreachable: ${msg}`,
      };
    }
  }

  async poll(sinceCursor: string | null): Promise<{ punches: GatewayPunch[]; nextCursor: string | null }> {
    if (!this.config) {
      throw new Error(`Suprema adapter not operational: middleware not configured and vendor SDK not installed. ${this.notConfiguredMessage()}`);
    }
    const cur = decodeCursor(sinceCursor);
    const boundary = new BoundaryTracker(cur);
    const punches: GatewayPunch[] = [];
    const LIMIT = 500;
    const MAX_PAGES = 20;
    // Continuation: when a previous poll hit the page budget mid-backlog, its
    // cursor carries the ORIGINAL query base time + row offset so this poll
    // resumes exactly where it stopped instead of restarting at offset 0.
    let queryBase = cur.t;
    let startOffset = 0;
    if (cur.next) {
      try {
        const c = JSON.parse(cur.next) as { qt?: string | null; off?: number };
        queryBase = c.qt === undefined ? cur.t : c.qt; // qt may legitimately be null (initial full drain)
        startOffset = typeof c.off === "number" && c.off >= 0 ? c.off : 0;
      } catch {
        /* unknown continuation format — fall back to boundary query */
      }
    }
    let offset = startOffset;
    let finished = false;
    // Results are ordered ascending by datetime, so even if we stop early the
    // boundary only covers rows actually processed — nothing is skipped.
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const rows = await this.searchEvents(queryBase, LIMIT, offset);
      for (const row of rows) {
        const eventType = BIOSTAR_TNA_KEY[String(row.tna_key ?? "")];
        const eventTime = toIso(row.datetime);
        const user = row.user_id as { user_id?: unknown } | undefined;
        const userId = user?.user_id !== undefined && user?.user_id !== null ? String(user.user_id) : null;
        const rowId = row.id !== undefined && row.id !== null ? String(row.id) : null;
        if (!eventTime || !userId || rowId === null) continue;
        if (!boundary.admit(eventTime, rowId)) continue; // replayed row from the 1s overlap / same-timestamp boundary
        if (!eventType) continue; // non-T&A event: advances the boundary but is not forwarded
        punches.push({
          deviceUserId: userId,
          eventTime,
          eventType,
          deviceEventUid: `bs-${rowId}`,
          raw: { ...pickMeta(row, BIOSTAR_META_KEYS), user_id: userId },
        });
      }
      if (rows.length < LIMIT) { finished = true; break; } // final page
      offset += LIMIT;
    }
    const token = boundary.token(
      finished ? undefined : JSON.stringify({ qt: queryBase, off: offset }),
    );
    return { punches, nextCursor: encodeCursor(token) };
  }
}

// ─── Env-driven factories (used by the gateway entrypoint) ───────────────────

export function zktecoConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ZktecoConfig | undefined {
  const { ZKTECO_API_URL, ZKTECO_USERNAME, ZKTECO_PASSWORD } = env;
  if (!ZKTECO_API_URL || !ZKTECO_USERNAME || !ZKTECO_PASSWORD) return undefined;
  return { baseUrl: ZKTECO_API_URL.replace(/\/$/, ""), username: ZKTECO_USERNAME, password: ZKTECO_PASSWORD };
}

export function supremaConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SupremaConfig | undefined {
  const { SUPREMA_API_URL, SUPREMA_LOGIN_ID, SUPREMA_PASSWORD } = env;
  if (!SUPREMA_API_URL || !SUPREMA_LOGIN_ID || !SUPREMA_PASSWORD) return undefined;
  return { baseUrl: SUPREMA_API_URL.replace(/\/$/, ""), loginId: SUPREMA_LOGIN_ID, password: SUPREMA_PASSWORD };
}
