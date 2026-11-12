import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { fromJson, toJson } from './json';

const S = z.object({ a: z.number(), b: z.array(z.string()) });

describe('json', () => {
  it('should roundtrip', () => {
    const v = { a: 1, b: ['x'] };
    expect(fromJson(S, toJson(v))).toEqual(v);
  });
  it('should throw INTERNAL on corrupt JSON', () => {
    expect(() => fromJson(S, '{nope')).toThrow(/Corrupt stored JSON/);
    try {
      fromJson(S, '{nope');
    } catch (e) {
      expect((e as { code: string }).code).toBe('INTERNAL');
    }
  });
  it('should throw on schema mismatch', () => {
    expect(() => fromJson(S, '{"a":"x","b":[]}')).toThrow(/Corrupt stored JSON/);
  });
});
