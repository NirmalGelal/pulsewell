import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Creates a fresh SQLite test DB (apps/api/prisma/test.db) with the current schema.
 * We delete the disposable test file and `db push` onto a new one instead of using
 * `--force-reset` (Prisma refuses that flag when run by an AI agent).
 */
export default function setup() {
  const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  for (const f of ['test.db', 'test.db-journal']) {
    const p = path.join(apiDir, 'prisma', f);
    if (existsSync(p)) rmSync(p);
  }
  execFileSync(
    'npx',
    ['prisma', 'db', 'push', '--skip-generate', '--schema', 'prisma/schema.prisma'],
    {
      cwd: apiDir,
      env: { ...process.env, DATABASE_URL: 'file:./test.db' },
      stdio: 'pipe',
    },
  );
}
