import { Router } from 'express';
import {
  ChangePasswordRequestSchema,
  LoginRequestSchema,
  type ChangePasswordRequest,
  type LoginRequest,
} from '@pvc/shared';
import type { AppDeps } from '../../deps';
import { validate } from '../../lib/validate';
import { getUser, requireAuth } from './auth.middleware';
import { changePassword, login } from './auth.service';

export function authRouter(deps: AppDeps): Router {
  const r = Router();
  r.post('/login', validate({ body: LoginRequestSchema }), async (req, res) => {
    const { email, password } = req.body as LoginRequest;
    res.json(await login(deps, email, password));
  });
  r.get('/me', requireAuth(deps, { allowPasswordChangePending: true }), (req, res) => {
    res.json({ user: getUser(req) });
  });
  r.post(
    '/change-password',
    requireAuth(deps, { allowPasswordChangePending: true }),
    validate({ body: ChangePasswordRequestSchema }),
    async (req, res) => {
      const { currentPassword, newPassword } = req.body as ChangePasswordRequest;
      res.json({ user: await changePassword(deps, getUser(req).id, currentPassword, newPassword) });
    },
  );
  return r;
}
