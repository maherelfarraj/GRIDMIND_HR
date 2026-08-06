import type { Request, Response, NextFunction, RequestHandler } from "express";
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
 * Usage:
 *   router.post("/", validateBody(CreateFooBody), async (req, res) => { … });
 *   router.patch("/:id", validateBody(UpdateFooBody), async (req, res) => { … });
 */
export function validateBody(
  schema: ZodObject<ZodRawShape, UnknownKeysParam, ZodTypeAny>,
): RequestHandler {
  // Build the strict variant once at registration time, not per request.
  const strict = schema.strict();

  return (req: Request, res: Response, next: NextFunction): void => {
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
        });
        return;
      }
      res.status(400).json({ error: result.error.message });
      return;
    }
    req.body = result.data;
    next();
  };
}
