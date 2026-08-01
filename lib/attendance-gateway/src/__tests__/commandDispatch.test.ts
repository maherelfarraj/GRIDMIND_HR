import { describe, it, expect, vi } from "vitest";
import { GatewayService } from "../service.js";
import type { DeviceAdapter, RestartTarget } from "../types.js";
import type { HrClient } from "../hrClient.js";
import type { EncryptedQueue } from "../queue.js";

/**
 * Proves the heartbeat-delivered RESTART command's device identifier is
 * passed down to the adapter, so multi-terminal middleware adapters can
 * reboot the exact terminal the operator picked.
 */

function makeAdapter(restartTargets: Array<RestartTarget | undefined>): DeviceAdapter {
  return {
    type: "ZKTECO" as const,
    testConnection: async () => ({ ok: true, status: "REACHABLE" as const, message: "ok" }),
    poll: async () => ({ punches: [], nextCursor: null }),
    restartDevice: async (target?: RestartTarget) => {
      restartTargets.push(target);
      return { ok: true, message: "rebooted" };
    },
  };
}

const fakeQueue = {
  enqueue: async () => {},
  pending: async () => [] as string[],
  read: async () => null,
  remove: async () => {},
  markAttempt: async () => null,
} as unknown as EncryptedQueue;

function makeHr(commands: unknown[], acks: unknown[]): HrClient {
  return {
    heartbeat: vi.fn(async () => ({ status: 200, body: { ok: true, clockDriftMs: 0, driftAlert: false, commands } })),
    ackCommands: vi.fn(async (a: unknown) => { acks.push(a); return { status: 200, body: { ok: true, results: [] } }; }),
    uploadBatch: vi.fn(async () => ({ status: 200, body: {} })),
    reconcile: vi.fn(async () => ({ status: 200, body: { ok: true, results: [] } })),
  } as unknown as HrClient;
}

describe("GatewayService command dispatch carries the device identifier", () => {
  it("passes the delivered deviceSerial to adapter.restartDevice", async () => {
    const targets: Array<RestartTarget | undefined> = [];
    const acks: unknown[] = [];
    const svc = new GatewayService(
      fakeQueue,
      makeHr([{ id: 5, deviceId: 3, command: "RESTART", deviceSerial: "SN-9" }], acks),
      makeAdapter(targets),
    );
    await svc.tick();
    expect(targets).toEqual([{ serial: "SN-9" }]);
    expect(acks).toEqual([[{ commandId: 5, ok: true, message: "rebooted" }]]);
  });

  it("passes a null serial when an older HR core omits it", async () => {
    const targets: Array<RestartTarget | undefined> = [];
    const svc = new GatewayService(
      fakeQueue,
      makeHr([{ id: 6, deviceId: 3, command: "RESTART" }], []),
      makeAdapter(targets),
    );
    await svc.tick();
    expect(targets).toEqual([{ serial: null }]);
  });
});
