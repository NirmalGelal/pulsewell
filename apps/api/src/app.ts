import express, { type ErrorRequestHandler, type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import type { AppDeps } from './deps';
import { AppError } from './lib/errors';
import { authRouter } from './modules/auth/auth.routes';
import { clinicianRouter } from './modules/clinician/clinician.routes';
import { reportsRouter } from './modules/reports/reports.routes';
import type { ConvertFn } from './modules/speech/convert';
import { speechRouter } from './modules/speech/speech.routes';
import { sessionsRouter } from './modules/sessions/sessions.routes';

export interface AppOptions {
  /** Test seam: replaces the ffmpeg audio converter used by the speech route. */
  convert?: ConvertFn;
}

export function createApp(deps: AppDeps, options: AppOptions = {}): Express {
  const app = express();
  app.use(helmet());
  app.use(cors({ origin: deps.config.WEB_ORIGIN }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, llmMode: deps.llm.mode });
  });

  // ---- Feature routers are mounted here by later modules (M02+). ----
  app.use('/api/auth', authRouter(deps));
  app.use('/api', sessionsRouter(deps));
  app.use('/api', reportsRouter(deps));
  app.use('/api', clinicianRouter(deps));
  app.use('/api', speechRouter(deps, { convert: options.convert }));
  // ---- end router mount block ----

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  const onError: ErrorRequestHandler = (err, _req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    if (err instanceof AppError) {
      res.status(err.status).json({
        error: {
          code: err.code,
          message: err.message,
          ...(err.details !== undefined ? { details: err.details } : {}),
        },
      });
      return;
    }
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Malformed JSON body' } });
      return;
    }
    const e = err as { type?: string };
    if (e?.type === 'entity.too.large') {
      res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Payload too large' } });
      return;
    }
    // Log only the error name, never message content (may contain user text).
    deps.logger.error('Unhandled error', { name: err instanceof Error ? err.name : typeof err });
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
  };
  app.use(onError);

  return app;
}
