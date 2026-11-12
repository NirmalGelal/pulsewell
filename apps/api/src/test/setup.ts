import { afterAll } from 'vitest';
import { getTestPrisma } from './db';

afterAll(async () => {
  await getTestPrisma().$disconnect();
});
