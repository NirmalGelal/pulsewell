import type { UserDto } from '@pvc/shared';

declare global {
  namespace Express {
    interface Request {
      user?: UserDto;
    }
  }
}

export {};
