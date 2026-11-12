# M02 — Auth, Access Control & Audit

| | |
|---|---|
| **Depends on** | M01 |
| **Workspaces** | `apps/api` |
| **Size** | Small–medium |

## Goal
Email/password login with JWT, role-based route guards, ownership/link helpers that every later module
uses to enforce "who sees what", an append-only audit log, the user seed script, and authenticated
test-context fixtures.

## Read first
`CONTRACTS.md` §4 (`User`, `CareLink`, `AuditLog`), §5, §6 (`UserDto`), §8 (auth routes). `CONVENTIONS.md` §3.

## Scope

### In
- `POST /api/auth/login`, `GET /api/auth/me`
- `requireAuth`, `requireRole` middleware; `req.user` typing
- Access helpers (patient ownership, clinician–patient link)
- Audit service
- `prisma/seed.ts` (demo users + links), idempotent
- Extend `createTestContext()` with users and auth headers

### Out
Signup, password reset, admin UI, invitations (not needed for the demo).

## Files
```
apps/api/src/modules/auth/
  auth.routes.ts      auth.service.ts      auth.middleware.ts
  access.ts           auth.test.ts         access.test.ts
apps/api/src/modules/audit/
  audit.service.ts    audit.test.ts
apps/api/src/types/express.d.ts
apps/api/prisma/seed.ts
apps/api/src/test/context.ts            (extend)
apps/api/src/app.ts                     (mount authRouter)
```
Dependencies: `bcryptjs`, `jsonwebtoken` (+ types).

## Behavior

### auth.service.ts
```ts
export async function hashPassword(plain: string, cost?: number): Promise<string>; // cost 10; 4 when NODE_ENV==='test'
export async function verifyPassword(plain: string, hash: string): Promise<boolean>;
export function signToken(config: AppConfig, user: { id: string; role: Role }): string; // HS256, sub=id, role, exp=JWT_EXPIRES_IN
export function verifyToken(config: AppConfig, token: string): { sub: string; role: Role }; // throws AppError UNAUTHENTICATED
export function toUserDto(u: User): UserDto;
export async function login(deps: AppDeps, email: string, password: string): Promise<{ token: string; user: UserDto }>;
```
- Emails are stored and compared **lower-cased and trimmed**.
- Unknown email and wrong password both → `401 UNAUTHENTICATED`, message `Invalid email or password`.
  When the user doesn't exist, still run `verifyPassword` against a fixed dummy hash (timing parity).
- Successful login → audit `auth.login`; failure → audit `auth.login_failed` with `meta: { reason: 'unknown_email'|'bad_password' }`
  and `actorId` = user id if known (never store the attempted password or email in meta).

### auth.middleware.ts
- `requireAuth`: reads `Authorization: Bearer <token>`; verifies; loads the user by `sub` (deleted user → 401);
  sets `req.user: UserDto`. Missing/malformed header, bad signature, expired → `401 UNAUTHENTICATED`.
- `requireRole(...roles: Role[])`: must run after `requireAuth`; otherwise `403 FORBIDDEN`.
- `express.d.ts`: augment `Express.Request` with `user?: UserDto`. Provide `getUser(req): UserDto` that throws 401 if missing.

### access.ts (used by M05–M08)
```ts
export async function getOwnedSession(prisma, patientId: string, sessionId: string): Promise<Session>; // 404 if missing or not owned
export async function isLinked(prisma, clinicianId: string, patientId: string): Promise<boolean>;   // active link only
export async function assertLinked(prisma, clinicianId: string, patientId: string): Promise<void>;  // 404 NOT_FOUND if not
export async function linkedPatientIds(prisma, clinicianId: string): Promise<string[]>;
export async function linkedClinicians(prisma, patientId: string): Promise<{ id: string; displayName: string }[]>;
```

### audit.service.ts
```ts
export type AuditAction =
  | 'auth.login' | 'auth.login_failed'
  | 'session.create' | 'session.resume' | 'message.create'
  | 'safety.event' | 'alert.create' | 'alert.ack'
  | 'report.generate' | 'report.edit' | 'report.approve' | 'report.view' | 'report.review'
  | 'note.create' | 'assistant.ask' | 'followup.create' | 'speech.transcribe';

export async function audit(deps: Pick<AppDeps,'prisma'|'logger'|'clock'>, entry: {
  actorId: string | null; action: AuditAction; resourceType: string; resourceId?: string;
  meta?: Record<string, string | number | boolean>;
}): Promise<void>;
```
- Never throws: on DB error, log `warn('audit_failed', { action })` and return.
- Rejects (drops with warn) meta values longer than 200 chars — prevents PHI leaking into the log by accident.

### Routes
| Route | Notes |
|---|---|
| `POST /api/auth/login` | body `LoginRequestSchema`; 200 `{ token, user }` |
| `GET /api/auth/me` | `requireAuth`; 200 `{ user }` |

### seed.ts (idempotent: upsert by email)
| email | role | displayName | password |
|---|---|---|---|
| `patient@demo.test` | PATIENT | Sam R. | demo1234 |
| `patient2@demo.test` | PATIENT | Alex M. | demo1234 |
| `clinician@demo.test` | CLINICIAN | Dr. Jordan Lee | demo1234 |
Care links: both patients → `clinician@demo.test`. Prints a summary table. Running twice creates no duplicates.

### Test context (extend `src/test/context.ts`)
`createTestContext()` now also creates:
- `users.patient` (linked to `clinician`), `users.patient2` (linked to `clinician`), `users.clinician`,
  `users.otherClinician` (no links)
- `auth.patient | auth.patient2 | auth.clinician | auth.otherClinician`: `{ Authorization: 'Bearer …' }`
Use low bcrypt cost so tests stay fast.

## Tests

`auth.test.ts`
- should log in with correct credentials and return token + UserDto (no `passwordHash` in response)
- should treat email case-insensitively and trim spaces
- should return 401 with identical message for unknown email and wrong password
- should 400 on missing password (VALIDATION_ERROR)
- should return current user from `/api/auth/me`
- should 401 `/api/auth/me` with no header / malformed header / bad signature / expired token (use `FixedClock`-independent: sign with `expiresIn: -1` or jwt `exp` in the past)
- should 401 when the token's user was deleted
- should 403 when `requireRole('CLINICIAN')` route is called by a patient (mount a test-only route)
- should write `auth.login` and `auth.login_failed` audit rows; failed row meta must not contain the email

`access.test.ts`
- `getOwnedSession` should return own session; should 404 for another patient's session; should 404 for unknown id
- `isLinked` true for linked pair, false for `otherClinician`, false when link `active=false`
- `linkedPatientIds` returns both demo patients for `clinician`, `[]` for `otherClinician`

`audit.test.ts`
- should insert an audit row with JSON meta
- should not throw when prisma fails (inject a prisma stub whose create rejects); should log a warning
- should drop meta values over 200 chars

`seed.test.ts`
- running the seed function twice should yield exactly 3 users and 2 links (export the seed logic as `runSeed(prisma)`)

## Verification
```bash
npm test -w @pvc/api -- auth access audit seed
npm run typecheck && npm run lint && npm test
npm run db:push && npm run seed && npm run dev
curl -s -X POST localhost:4000/api/auth/login -H 'content-type: application/json' \
  -d '{"email":"patient@demo.test","password":"demo1234"}'          # → token + user
curl -s localhost:4000/api/auth/me -H "authorization: Bearer <token>" # → user
```

## Definition of Done
- [ ] Login, me, guards, access helpers, audit, seed implemented as specified
- [ ] `createTestContext()` exposes `users` and `auth` for all four users
- [ ] No password hashes or emails ever appear in responses (besides own `user.email`) or logs
- [ ] All tests above pass; CONVENTIONS §7 checklist complete; PROGRESS.md updated
