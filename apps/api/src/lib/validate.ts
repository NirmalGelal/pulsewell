import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';
import { badRequest } from './errors';

interface Schemas {
  body?: ZodType;
  params?: ZodType;
  query?: ZodType;
}

/**
 * Validates request parts with zod. Parsed body/params replace the originals;
 * the parsed query is stored on `res.locals.query` (Express 5 `req.query` is a getter).
 */
export function validate(schemas: Schemas): RequestHandler {
  return (req, res, next) => {
    const issues: { path: string; message: string }[] = [];
    const collect = (
      prefix: string,
      err: { issues: { path: PropertyKey[]; message: string }[] },
    ) => {
      for (const i of err.issues) {
        issues.push({
          path: [prefix, ...i.path.map(String)].filter(Boolean).join('.'),
          message: i.message,
        });
      }
    };
    if (schemas.body) {
      const r = schemas.body.safeParse(req.body);
      if (r.success) req.body = r.data;
      else collect('', r.error);
    }
    if (schemas.params) {
      const r = schemas.params.safeParse(req.params);
      if (r.success) req.params = r.data as typeof req.params;
      else collect('', r.error);
    }
    if (schemas.query) {
      const r = schemas.query.safeParse(req.query);
      if (r.success) res.locals.query = r.data;
      else collect('', r.error);
    }
    if (issues.length > 0) return next(badRequest('Invalid request', issues));
    next();
  };
}
