import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import type { AppDeps } from '../../deps';
import { badRequest, llmUnavailable, payloadTooLarge } from '../../lib/errors';
import { audit } from '../audit/audit.service';
import { getUser, requireAuth, requireRole } from '../auth/auth.middleware';
import { convertToWav, type ConvertFn } from './convert';

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Set([
  'audio/webm',
  'audio/ogg',
  'audio/wav',
  'audio/x-wav',
  'audio/mp4',
  'audio/mpeg',
]);
const PASS_THROUGH = new Set(['audio/wav', 'audio/x-wav', 'audio/mpeg']);

export function speechRouter(deps: AppDeps, opts: { convert?: ConvertFn } = {}): Router {
  const convert = opts.convert ?? convertToWav;
  const r = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_BYTES, files: 1 },
  });

  const parse: RequestHandler = (req, res, next) => {
    upload.single('audio')(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE')
          return next(payloadTooLarge('Audio is too large (max 10 MB)'));
        return next(badRequest('Invalid audio upload'));
      }
      next(err);
    });
  };

  r.post(
    '/speech/transcribe',
    requireAuth(deps),
    requireRole('PATIENT'),
    parse,
    async (req, res) => {
      const file = req.file;
      if (!file) throw badRequest('An "audio" file is required');
      const mime = file.mimetype.split(';')[0]!.trim().toLowerCase();
      if (!ALLOWED.has(mime)) throw badRequest('Unsupported audio type');
      const started = Date.now();
      let buffer = file.buffer;
      let sendMime = mime;
      if (!PASS_THROUGH.has(mime)) {
        try {
          buffer = await convert(file.buffer);
          sendMime = 'audio/wav';
        } catch {
          throw badRequest('Could not read that audio');
        }
      }
      let text: string;
      try {
        text = (await deps.llm.transcribe(buffer, sendMime)).text.trim();
      } catch {
        throw llmUnavailable('Speech transcription is unavailable');
      }
      const user = getUser(req);
      await audit(deps, {
        actorId: user.id,
        action: 'speech.transcribe',
        resourceType: 'speech',
        meta: { bytes: file.size, ms: Date.now() - started },
      });
      res.json({ text });
    },
  );
  return r;
}
