/**
 * Codegen freshness guard — fails when lib/api-client-react or lib/api-zod
 * generated sources are out of date with lib/api-spec/openapi.yaml.
 *
 * How it works:
 *   `pnpm --filter @workspace/api-spec run codegen` writes a SHA-256 hash of
 *   openapi.yaml into each generated directory:
 *     lib/api-client-react/src/generated/.spec-hash
 *     lib/api-zod/src/generated/.spec-hash
 *   These files are committed alongside the generated source.  This test
 *   re-hashes the live openapi.yaml and compares it to those committed values.
 *   A mismatch means the spec was edited but codegen was not rerun.
 *
 * Static only: reads files; touches neither the DB nor the server.
 *
 * Fix: rerun `pnpm --filter @workspace/api-spec run codegen` and commit the
 * updated generated files and .spec-hash files together.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..", "..", "..", "..");

const SPEC_PATH = resolve(root, "lib", "api-spec", "openapi.yaml");

const PACKAGES = [
  {
    name: "@workspace/api-client-react",
    hashFile: resolve(
      root,
      "lib",
      "api-client-react",
      "src",
      "generated",
      ".spec-hash",
    ),
  },
  {
    name: "@workspace/api-zod",
    hashFile: resolve(
      root,
      "lib",
      "api-zod",
      "src",
      "generated",
      ".spec-hash",
    ),
  },
] as const;

describe("codegen freshness", () => {
  let currentHash: string;

  it("openapi.yaml is readable", () => {
    const specContent = readFileSync(SPEC_PATH);
    currentHash = createHash("sha256").update(specContent).digest("hex");
    expect(currentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  for (const pkg of PACKAGES) {
    it(`${pkg.name} generated sources match current openapi.yaml`, () => {
      // currentHash is set by the previous test; if that test ran first (vitest
      // runs describe-level its in order), this will be defined.  Recompute
      // defensively so this test is independently runnable.
      const specContent = readFileSync(SPEC_PATH);
      const liveHash = createHash("sha256").update(specContent).digest("hex");

      let committedHash: string;
      try {
        committedHash = readFileSync(pkg.hashFile, "utf8").trim();
      } catch {
        throw new Error(
          `${pkg.name}: .spec-hash file not found at ${pkg.hashFile}.\n` +
            `Fix: run  pnpm --filter @workspace/api-spec run codegen  and commit the result.`,
        );
      }

      expect(
        committedHash,
        `${pkg.name} generated sources are STALE — openapi.yaml has changed since codegen last ran.\n` +
          `  committed hash : ${committedHash}\n` +
          `  current hash   : ${liveHash}\n` +
          `Fix: run  pnpm --filter @workspace/api-spec run codegen  and commit the updated generated files.`,
      ).toBe(liveHash);
    });
  }
});
