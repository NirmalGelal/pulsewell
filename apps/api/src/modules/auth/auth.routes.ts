import { Router } from 'express';
import { LoginRequestSchema, type LoginRequest } from '@pvc/shared';
import type { AppDeps } from '../../deps';
import { validate } from '../../lib/validate';
import { getUser, requireAuth } from './auth.middleware';
import { login } from './auth.service';

export function authRouter(deps: AppDeps): Router {
  const r = Router();
  r.post('/login', validate({ body: LoginRequestSchema }), async (req, res) => {
    const { email, password } = req.body as LoginRequest;
    res.json(await login(deps, email, password));
  });
  r.get('/me', requireAuth(deps), (req, res) => {
    res.json({ user: getUser(req) });
  });
  return r;
}
