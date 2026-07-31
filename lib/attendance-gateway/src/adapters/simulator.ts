import { randomUUID } from "crypto";
import type { DeviceAdapter, GatewayPunch, AdapterTestResult } from "../types.js";

/**
 * Simulator adapter — generates deterministic punch traffic for testing the
 * full gateway pipeline (queue → sign → upload → dedupe → payroll handoff)
 * without any physical device.
 */
export class SimulatorAdapter implements DeviceAdapter {
  readonly type = "SIMULATOR" as const;

  constructor(
    private readonly deviceUserIds: string[] = ["SIM-001", "SIM-002"],
    private readonly now: () => Date = () => new Date(),
  ) {}

  async testConnection(): Promise<AdapterTestResult> {
    return { ok: true, message: "Simulator ready", deviceTimeMs: this.now().getTime() };
  }

  async poll(_sinceCursor: string | null): Promise<{ punches: GatewayPunch[]; nextCursor: string | null }> {
    const t = this.now();
    const punches: GatewayPunch[] = this.deviceUserIds.flatMap((uid) => [
      {
        deviceUserId: uid,
        eventTime: new Date(t.getTime() - 8 * 3600_000).toISOString(),
        eventType: "CLOCK_IN" as const,
        deviceEventUid: `sim-${uid}-in-${t.toISOString().slice(0, 10)}`,
        raw: { simulator: true, run: randomUUID() },
      },
      {
        deviceUserId: uid,
        eventTime: t.toISOString(),
        eventType: "CLOCK_OUT" as const,
        deviceEventUid: `sim-${uid}-out-${t.toISOString().slice(0, 10)}`,
        raw: { simulator: true },
      },
    ]);
    return { punches, nextCursor: t.toISOString() };
  }
}
