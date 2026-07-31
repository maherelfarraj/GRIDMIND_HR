/**
 * Auth-mode fail-closed tests.
 *
 * Auth must be enforced by default: only the explicit dev-only opt-out
 * PILOT_AUTH="false" disables it, and production refuses to start with
 * auth disabled.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { isAuthEnforced, assertAuthModeSafe } from "../lib/authMode";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isAuthEnforced — fail-closed default", () => {
  it("is enforced when PILOT_AUTH is unset", () => {
    vi.stubEnv("PILOT_AUTH", undefined as unknown as string);
    delete process.env.PILOT_AUTH;
    expect(isAuthEnforced()).toBe(true);
  });

  it("is enforced when PILOT_AUTH is misspelled or any non-'false' value", () => {
    for (const v of ["ture", "0", "off", "no", "FALSE", "", "true"]) {
      vi.stubEnv("PILOT_AUTH", v);
      expect(isAuthEnforced()).toBe(true);
    }
  });

  it("is disabled only by the explicit opt-out PILOT_AUTH=false", () => {
    vi.stubEnv("PILOT_AUTH", "false");
    expect(isAuthEnforced()).toBe(false);
  });
});

describe("requireAuth under default startup configuration (PILOT_AUTH unset)", () => {
  it("rejects a sessionless request with 401", async () => {
    vi.stubEnv("PILOT_AUTH", undefined as unknown as string);
    delete process.env.PILOT_AUTH;
    const { requireAuth } = await import("../middleware/requireAuth");
    let status = 0;
    let body: unknown;
    let nextCalled = false;
    const req = { session: undefined } as never;
    const res = {
      status(code: number) { status = code; return this; },
      json(payload: unknown) { body = payload; },
    } as never;
    requireAuth(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(status).toBe(401);
    expect(body).toMatchObject({ code: "UNAUTHENTICATED" });
  });
});

describe("assertAuthModeSafe", () => {
  it("throws when auth is disabled and NODE_ENV=production", () => {
    vi.stubEnv("PILOT_AUTH", "false");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => assertAuthModeSafe()).toThrow(/not allowed when NODE_ENV=production/);
  });

  it("does not throw (warns) when auth is disabled outside production", () => {
    vi.stubEnv("PILOT_AUTH", "false");
    vi.stubEnv("NODE_ENV", "development");
    expect(() => assertAuthModeSafe()).not.toThrow();
  });

  it("does not throw in production when auth is enforced", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PILOT_AUTH", "true");
    expect(() => assertAuthModeSafe()).not.toThrow();
  });
});
