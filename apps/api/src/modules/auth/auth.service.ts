import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { User } from '@prisma/client';
import { ROLES, type Role, type UserDto } from '@pvc/shared';
import type { AppConfig } from '../../config/env';
import type { AppDeps } from '../../deps';
import { badRequest, unauthenticated } from '../../lib/errors';
import { audit } from '../audit/audit.service';

export async function hashPassword(plain: string, cost?: number): Promise<string> {
  return bcrypt.hash(plain, cost ?? (process.env.NODE_ENV === 'test' ? 4 : 10));
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function signToken(config: AppConfig, user: { id: string; role: Role }): string {
  return jwt.sign({ role: user.role }, config.JWT_SECRET, {
    algorithm: 'HS256',
    subject: user.id,
    // JWT_EXPIRES_IN is a free-form duration string such as "12h".
    expiresIn: config.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

export function verifyToken(config: AppConfig, token: string): { sub: string; role: Role } {
  try {
    const p = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] });
    if (typeof p === 'string' || typeof p.sub !== 'string') throw new Error('bad payload');
    const role = (p as { role?: unknown }).role;
    if (!ROLES.includes(role as Role)) throw new Error('bad role');
    return { sub: p.sub, role: role as Role };
  } catch {
    throw unauthenticated('Invalid or expired token');
  }
}

export function toUserDto(u: User): UserDto {
  return {
    id: u.id,
    email: u.email,
    role: u.role as Role,
    displayName: u.displayName,
    mustChangePassword: u.mustChangePassword,
  };
}

// Fixed bcrypt hash (cost 10) of a random string, used for timing parity on unknown emails.
const DUMMY_HASH = '$2b$10$BsvLjhwNBlwAn1Cgp8Xgp.gPG7fVOBfOwLSchZTDnbhp5.LUgT.Pm';

export async function login(
  deps: AppDeps,
  email: string,
  password: string,
): Promise<{ token: string; user: UserDto }> {
  const normalized = email.trim().toLowerCase();
  const user = await deps.prisma.user.findUnique({ where: { email: normalized } });
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) {
    await audit(deps, {
      actorId: user?.id ?? null,
      action: 'auth.login_failed',
      resourceType: 'auth',
      meta: { reason: user ? 'bad_password' : 'unknown_email' },
    });
    throw unauthenticated('Invalid email or password');
  }
  await audit(deps, {
    actorId: user.id,
    action: 'auth.login',
    resourceType: 'auth',
    resourceId: user.id,
  });
  return {
    token: signToken(deps.config, user as { id: string; role: Role }),
    user: toUserDto(user),
  };
}

export async function changePassword(
  deps: AppDeps,
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<UserDto> {
  const user = await deps.prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw unauthenticated();
  if (!(await verifyPassword(currentPassword, user.passwordHash)))
    throw badRequest('Current password is not correct', [
      { path: 'currentPassword', message: 'Current password is not correct' },
    ]);
  const updated = await deps.prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false },
  });
  await audit(deps, {
    actorId: userId,
    action: 'auth.change_password',
    resourceType: 'user',
    resourceId: userId,
  });
  return toUserDto(updated);
}
