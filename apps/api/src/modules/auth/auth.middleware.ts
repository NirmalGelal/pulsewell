import type { Request, RequestHandler } from 'express';
import type { Role, UserDto } from '@pvc/shared';
import type { AppDeps } from '../../deps';
import { AppError, forbidden, unauthenticated } from '../../lib/errors';
import { toUserDto, verifyToken } from './auth.service';

export interface RequireAuthOptions {
  /** Let users with a pending forced password change through (only /me and change-password). */
  allowPasswordChangePending?: boolean;
}

export function requireAuth(deps: AppDeps, options: RequireAuthOptions = {}): RequestHandler {
  return async (req, _res, next) => {
    try {
      const header = req.headers.authorization;
      const m = header ? /^Bearer (\S+)$/.exec(header) : null;
      if (!m || !m[1]) throw unauthenticated();
      const { sub } = verifyToken(deps.config, m[1]);
      const user = await deps.prisma.user.findUnique({ where: { id: sub } });
      if (!user) throw unauthenticated();
      if (user.mustChangePassword && !options.allowPasswordChangePending)
        throw new AppError('FORBIDDEN', 'Password change required', {
          reason: 'PASSWORD_CHANGE_REQUIRED',
        });
      req.user = toUserDto(user);
      next();
    } catch (e) {
      next(e);
    }
  };
}

export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

export function getUser(req: Request): UserDto {
  if (!req.user) throw unauthenticated();
  return req.user;
}
