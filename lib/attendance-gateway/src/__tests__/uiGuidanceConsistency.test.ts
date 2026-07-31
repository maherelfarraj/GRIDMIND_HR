import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { zktecoConfigFromEnv, supremaConfigFromEnv } from "../adapters/vendorStubs.js";

/**
 * The HRMS Attendance Gateway screen tells administrators which environment
 * variables configure the ZKTeco/Suprema middleware adapters. This test pins
 * that guidance to the variables the gateway actually reads, so the UI can
 * never silently drift from the implementation.
 */
const here = dirname(fileURLToPath(import.meta.url));
const uiPage = readFileSync(
  join(here, "../../../../artifacts/hrms/src/pages/attendance-gateway.tsx"),
  "utf8",
);

const ZK_VARS = ["ZKTECO_API_URL", "ZKTECO_USERNAME", "ZKTECO_PASSWORD"] as const;
const BS_VARS = ["SUPREMA_API_URL", "SUPREMA_LOGIN_ID", "SUPREMA_PASSWORD"] as const;

describe("HRMS gateway page guidance matches gateway configuration", () => {
  it("documents every env var the adapters read, and the factories honor them", () => {
    for (const v of [...ZK_VARS, ...BS_VARS]) expect(uiPage).toContain(v);

    expect(zktecoConfigFromEnv({ ZKTECO_API_URL: "http://x", ZKTECO_USERNAME: "u", ZKTECO_PASSWORD: "p" } as NodeJS.ProcessEnv))
      .toEqual({ baseUrl: "http://x", username: "u", password: "p" });
    expect(supremaConfigFromEnv({ SUPREMA_API_URL: "https://y/", SUPREMA_LOGIN_ID: "l", SUPREMA_PASSWORD: "p" } as NodeJS.ProcessEnv))
      .toEqual({ baseUrl: "https://y", loginId: "l", password: "p" });
    // partial config must not silently produce a half-configured adapter
    expect(zktecoConfigFromEnv({ ZKTECO_API_URL: "http://x" } as NodeJS.ProcessEnv)).toBeUndefined();
    expect(supremaConfigFromEnv({ SUPREMA_API_URL: "https://y" } as NodeJS.ProcessEnv)).toBeUndefined();
  });

  it("no longer presents the middleware adapters as non-operational", () => {
    expect(uiPage).not.toMatch(/SDK Required/);
    expect(uiPage).not.toMatch(/not yet operational/);
  });
});
