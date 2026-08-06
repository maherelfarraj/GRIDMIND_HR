import type { RequestHandler } from "express";
import { type ZodObject, type ZodRawShape, type UnknownKeysParam, type ZodTypeAny, ZodIssueCode } from "zod";

/**
 * Express middleware factory that validates req.body against a Zod object
 * schema in strict mode (no extra keys allowed).
 *
 * - Returns 400 with `{ error, unknownFields }` when the caller sends keys
 *   that are not declared in the schema.
 * - Returns 400 with `{ error }` for any other validation failure.
 * - On success replaces req.body with the parsed, type-safe value so
 *   downstream handlers can insert/update it wholesale without worrying
 *   about extra keys slipping through.
 *
 * Generic over the route params type so subsequent handlers in the same
 * route retain properly-typed req.params (e.g. req.params.id stays string).
 *
 * Usage:
 *   router.post("/", validateBody(CreateFooBody), async (req, res) => { … });
 *   router.patch("/:id", validateBody(UpdateFooBody), async (req, res) => { … });
 */
export function validateBody<
  P extends Record<string, string> = Record<string, string>,
  ResBody = any,
  ReqBody = any,
  ReqQuery extends Record<string, any> = Record<string, any>,
  LocalsObj extends Record<string, any> = Record<string, any>,
>(
  schema: ZodObject<ZodRawShape, UnknownKeysParam, ZodTypeAny>,
): RequestHandler<P, ResBody, ReqBody, ReqQuery, LocalsObj> {
  // Build the strict variant once at registration time, not per request.
  const strict = schema.strict();

  return (req, res, next): void => {
    const result = strict.safeParse(req.body);
    if (!result.success) {
      // Surface unrecognized-key errors with the field names so callers can
      // fix typos immediately rather than debugging silent data loss.
      const unknownFields: string[] = [];
      for (const issue of result.error.issues) {
        if (issue.code === ZodIssueCode.unrecognized_keys) {
          // The zod issue type for unrecognized_keys always carries `keys`.
          unknownFields.push(...(issue as { code: string; keys: string[] }).keys);
        }
      }
      if (unknownFields.length > 0) {
        res.status(400).json({
          error: "Request body contains unrecognized fields",
          unknownFields,
        } as any);
        return;
      }
      res.status(400).json({ error: result.error.message } as any);
      return;
    }
    req.body = result.data as ReqBody;
    next();
  };
}
