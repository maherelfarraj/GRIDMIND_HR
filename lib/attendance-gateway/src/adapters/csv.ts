import { createHash } from "crypto";
import type { DeviceAdapter, GatewayPunch, AdapterTestResult, PunchEventType } from "../types.js";

/**
 * CSV adapter — parses punch exports (e.g. from legacy devices or manual
 * collection on air-gapped sites). Fully offline; no SDK required.
 *
 * Expected columns (header row required, comma-separated):
 *   device_user_id,event_time,event_type[,event_uid]
 * or employee_id,event_time,event_type[,event_uid]
 *
 * event_type accepts CLOCK_IN/CLOCK_OUT/... or IN/OUT shorthands.
 * A deterministic event uid is derived from the row content when absent so
 * re-importing the same file never duplicates punches.
 */
const TYPE_ALIASES: Record<string, PunchEventType> = {
  CLOCK_IN: "CLOCK_IN", IN: "CLOCK_IN",
  CLOCK_OUT: "CLOCK_OUT", OUT: "CLOCK_OUT",
  BREAK_START: "BREAK_START", BREAK_END: "BREAK_END",
  OVERTIME_START: "OVERTIME_START", OVERTIME_END: "OVERTIME_END",
};

export function parseCsvPunches(csv: string): { punches: GatewayPunch[]; errors: string[] } {
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return { punches: [], errors: ["empty file"] };
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  const iDevUser = idx("device_user_id");
  const iEmp = idx("employee_id");
  const iTime = idx("event_time");
  const iType = idx("event_type");
  const iUid = idx("event_uid");
  const errors: string[] = [];
  if (iTime < 0 || iType < 0 || (iDevUser < 0 && iEmp < 0)) {
    return { punches: [], errors: ["header must contain event_time, event_type and device_user_id or employee_id"] };
  }
  const punches: GatewayPunch[] = [];
  for (let n = 1; n < lines.length; n++) {
    const cols = lines[n].split(",").map((c) => c.trim());
    const type = TYPE_ALIASES[(cols[iType] ?? "").toUpperCase()];
    const time = new Date(cols[iTime] ?? "");
    if (!type || isNaN(time.getTime())) {
      errors.push(`row ${n + 1}: invalid event_type or event_time`);
      continue;
    }
    const employeeId = iEmp >= 0 && cols[iEmp] ? parseInt(cols[iEmp], 10) : undefined;
    const deviceUserId = iDevUser >= 0 && cols[iDevUser] ? cols[iDevUser] : undefined;
    if (!employeeId && !deviceUserId) {
      errors.push(`row ${n + 1}: missing device_user_id / employee_id`);
      continue;
    }
    const uid =
      (iUid >= 0 && cols[iUid]) ||
      createHash("sha256").update(`${deviceUserId ?? employeeId}|${time.toISOString()}|${type}`).digest("hex").slice(0, 32);
    punches.push({
      deviceUserId,
      employeeId: employeeId && Number.isFinite(employeeId) ? employeeId : undefined,
      eventTime: time.toISOString(),
      eventType: type,
      deviceEventUid: uid,
      raw: { csvRow: n + 1 },
    });
  }
  return { punches, errors };
}

export class CsvAdapter implements DeviceAdapter {
  readonly type = "CSV" as const;
  private content: string | null = null;

  loadContent(csv: string): void {
    this.content = csv;
  }

  async testConnection(): Promise<AdapterTestResult> {
    return { ok: true, message: "CSV adapter ready (offline import)" };
  }

  async poll(_sinceCursor: string | null): Promise<{ punches: GatewayPunch[]; nextCursor: string | null }> {
    if (this.content === null) return { punches: [], nextCursor: null };
    const { punches } = parseCsvPunches(this.content);
    this.content = null; // one-shot consumption per loaded file
    return { punches, nextCursor: null };
  }
}
