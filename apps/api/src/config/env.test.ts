import { describe, expect, it } from 'vitest';
import { loadConfig } from './env';

const base = { JWT_SECRET: 'a'.repeat(40) };

describe('loadConfig', () => {
  it('should apply defaults', () => {
    const c = loadConfig(base);
    expect(c.PORT).toBe(4000);
    expect(c.LLM_MODE).toBe('demo');
    expect(c.DATABASE_URL).toBe('file:./dev.db');
    expect(c.models.interviewer).toBe('qwen3-small');
    expect(c.models.stt).toBe('gemma-small');
    expect(c.fallbackModel).toBe('service');
  });
  it('should reject short JWT_SECRET', () => {
    expect(() => loadConfig({ JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });
  it('should reject LLM_MODE=live without NRP_API_KEY', () => {
    expect(() => loadConfig({ ...base, LLM_MODE: 'live' })).toThrow(/NRP_API_KEY/);
    expect(loadConfig({ ...base, LLM_MODE: 'live', NRP_API_KEY: 'k' }).LLM_MODE).toBe('live');
  });
  it('should allow overriding models via MODEL_SAFETY', () => {
    expect(loadConfig({ ...base, MODEL_SAFETY: 'other' }).models.safety).toBe('other');
  });
  it('should allow empty NRP_API_KEY in demo mode', () => {
    expect(loadConfig({ ...base, LLM_MODE: 'demo', NRP_API_KEY: '' }).NRP_API_KEY).toBe('');
  });
});
