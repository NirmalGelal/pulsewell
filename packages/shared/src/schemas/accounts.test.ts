import { describe, expect, it } from 'vitest';
import { ChangePasswordRequestSchema, CreatePatientRequestSchema, UserDtoSchema } from '../index';

describe('CreatePatientRequestSchema', () => {
  it('should trim and lowercase the email and trim the name', () => {
    const r = CreatePatientRequestSchema.parse({
      email: '  A.B@Example.COM ',
      displayName: ' Pat ',
    });
    expect(r).toEqual({ email: 'a.b@example.com', displayName: 'Pat' });
  });

  it('should reject bad emails and names outside 1..80', () => {
    expect(CreatePatientRequestSchema.safeParse({ email: 'nope', displayName: 'A' }).success).toBe(
      false,
    );
    expect(CreatePatientRequestSchema.safeParse({ email: 'a@b.co', displayName: '' }).success).toBe(
      false,
    );
    expect(
      CreatePatientRequestSchema.safeParse({ email: 'a@b.co', displayName: 'x'.repeat(81) })
        .success,
    ).toBe(false);
    expect(
      CreatePatientRequestSchema.safeParse({ email: 'a@b.co', displayName: 'x'.repeat(80) })
        .success,
    ).toBe(true);
  });
});

describe('ChangePasswordRequestSchema', () => {
  it('should accept a 10+ char password that differs from the current one', () => {
    expect(
      ChangePasswordRequestSchema.safeParse({ currentPassword: 'old', newPassword: 'abcdefghij' })
        .success,
    ).toBe(true);
  });

  it('should reject short passwords and an unchanged password', () => {
    expect(
      ChangePasswordRequestSchema.safeParse({ currentPassword: 'old', newPassword: 'short' })
        .success,
    ).toBe(false);
    const same = ChangePasswordRequestSchema.safeParse({
      currentPassword: 'abcdefghij',
      newPassword: 'abcdefghij',
    });
    expect(same.success).toBe(false);
  });
});

describe('UserDtoSchema', () => {
  it('should default mustChangePassword to false when absent', () => {
    const u = UserDtoSchema.parse({ id: '1', email: 'a@b.co', role: 'PATIENT', displayName: 'A' });
    expect(u.mustChangePassword).toBe(false);
  });
});
