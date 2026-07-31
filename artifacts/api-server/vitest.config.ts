import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Auth is enforced by default; the integration suite exercises demo mode
    // via the explicit dev-only opt-out. Auth-specific suites re-enable it
    // with vi.stubEnv("PILOT_AUTH", "true").
    env: { PILOT_AUTH: "false" },
    include: ["src/**/*.test.ts"],
    // Tests share one seeded database — run files sequentially to avoid interference.
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
