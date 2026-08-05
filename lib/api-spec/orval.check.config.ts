/**
 * Orval config used exclusively by scripts/check-codegen-committed.sh.
 *
 * Mirrors orval.config.ts exactly, but redirects both output workspaces to a
 * caller-supplied temp directory (via CODEGEN_CHECK_TMPDIR) so orval can
 * regenerate into a scratch tree without touching committed files.
 *
 * Target-name guard: if orval.config.ts gains a new target and this file is
 * not updated to match, this config throws at parse time so the oversight is
 * caught immediately.
 *
 * Do NOT run this config directly; use scripts/check-codegen-committed.sh.
 */
import { defineConfig } from "orval";
import path from "path";
import baseConfig from "./orval.config";

// ── Target-name guard ────────────────────────────────────────────────────────
// Keeps this file in sync with orval.config.ts: if a new target is added
// there but not here, we throw rather than silently miss it.
const BASE_TARGETS = Object.keys(baseConfig).sort();
const CHECK_TARGETS = ["api-client-react", "zod"].sort();
if (JSON.stringify(BASE_TARGETS) !== JSON.stringify(CHECK_TARGETS)) {
  throw new Error(
    `orval.check.config.ts target-name mismatch!\n` +
      `  base config targets : ${BASE_TARGETS.join(", ")}\n` +
      `  check config targets: ${CHECK_TARGETS.join(", ")}\n` +
      `Update CHECK_TARGETS in orval.check.config.ts to match orval.config.ts.`,
  );
}

// ── Temp directory (injected by check-codegen-committed.sh) ─────────────────
const tmpDir = process.env.CODEGEN_CHECK_TMPDIR;
if (!tmpDir) {
  throw new Error(
    "CODEGEN_CHECK_TMPDIR env var must be set.\n" +
      "Run this config via  scripts/check-codegen-committed.sh, not directly.",
  );
}

const tmpApiClientSrc = path.resolve(tmpDir, "api-client-react");
const tmpApiZodSrc = path.resolve(tmpDir, "api-zod");

// Cast so TS doesn't complain about deep-spread of the typed config object.
const base = baseConfig as Record<string, any>;

export default defineConfig({
  // ── api-client-react ────────────────────────────────────────────────────
  // Mutator path must also be redirected: orval resolves a relative import
  // from the output file to the mutator file.  If workspace moves to a temp
  // dir but the mutator path still points at the real src tree, the relative
  // import would change (breaking byte-exact diff).  The check script copies
  // custom-fetch.ts into the temp workspace so the relative path stays
  // identical to what the committed files contain.
  "api-client-react": {
    ...base["api-client-react"],
    output: {
      ...base["api-client-react"].output,
      workspace: tmpApiClientSrc,
      override: {
        ...base["api-client-react"].output.override,
        mutator: {
          path: path.resolve(tmpApiClientSrc, "custom-fetch.ts"),
          name: "customFetch",
        },
      },
    },
  },

  // ── zod ─────────────────────────────────────────────────────────────────
  // No mutator; only workspace needs redirecting.  The schemas sub-path
  // ("generated/types") is relative to workspace, so it follows automatically.
  zod: {
    ...base["zod"],
    output: {
      ...base["zod"].output,
      workspace: tmpApiZodSrc,
    },
  },
});
