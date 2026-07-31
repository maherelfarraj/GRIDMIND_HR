/**
 * AUTO-GENERATED baseline of pre-existing drift between
 * lib/api-spec/openapi.yaml and lib/db/src/schema, captured when the
 * openapi-drift guard test was introduced. This list can only SHRINK:
 * regeneration intersects with the committed baseline, so new drift can
 * never be added here — fix the spec, or use the curated allowlists in
 * openapi-drift.test.ts for genuinely computed/omitted fields.
 *
 * Prune fixed entries with:
 *   UPDATE_OPENAPI_DRIFT_BASELINE=1 npx vitest run src/__tests__/openapi-drift.test.ts
 */

/** OpenAPI properties with no corresponding drizzle column. */
export const KNOWN_EXTRA_PROPERTIES: Record<string, string[]> = {};

/** Drizzle columns absent from the OpenAPI schema. */
export const KNOWN_MISSING_PROPERTIES: Record<string, string[]> = {};
