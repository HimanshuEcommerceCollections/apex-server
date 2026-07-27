import type { NextFunction, Request, Response } from "express";
import { ZodError, type ZodTypeAny } from "zod";
import { ApiError } from "../utils/api-error";
import { Messages } from "../constants/messages";

interface ValidateSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/**
 * Parse request parts with zod and REPLACE `req.body/query/params` with the
 * parsed (coerced/defaulted) output so controllers receive typed data.
 *
 * A ZodError becomes 422 `ApiError.unprocessable(..., { code: "VALIDATION_FAILED",
 * issues })` (docs/architecture/05, Deviation D-6): `errors.code` is present on
 * every 4xx. Because `req.params` is replaced, a param schema must list EVERY
 * param on its route (including merged parent params).
 */
export function validate(schemas: ValidateSchemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body);
      if (schemas.query) {
        const parsed = schemas.query.parse(req.query);
        // req.query has no setter in some Express versions; mutate in place.
        Object.keys(req.query).forEach((k) => delete (req.query as Record<string, unknown>)[k]);
        Object.assign(req.query as Record<string, unknown>, parsed);
      }
      if (schemas.params) {
        const parsed = schemas.params.parse(req.params);
        Object.assign(req.params, parsed);
      }
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const issues = err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
        next(ApiError.unprocessable(Messages.VALIDATION_FAILED, { code: "VALIDATION_FAILED", issues }));
        return;
      }
      next(err);
    }
  };
}
