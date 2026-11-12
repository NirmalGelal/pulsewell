import { describe, expect, it } from 'vitest';
import { LLM_ROLES, SafetyClassifierOutputSchema } from '@pvc/shared';
import { loadConfig } from '../../config/env';
import { createLogger } from '../../lib/logger';
import { LiveLlmClient } from './live-client';

const config = loadConfig({
  ...process.env,
  JWT_SECRET: process.env.JWT_SECRET ?? 'live-test-secret-live-test-secret-123',
  LLM_MODE: 'live',
});
const client = new LiveLlmClient(config, createLogger('silent'));

describe.runIf(process.env.LIVE_LLM === '1')('live NRP', () => {
  it('should list every configured model on GET /models (warn only for gemma-small)', async () => {
    const res = await fetch(`${config.NRP_BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${config.NRP_API_KEY}` },
    });
    expect(res.ok).toBe(true);
    const ids = ((await res.json()) as { data: { id: string }[] }).data.map((m) => m.id);
    for (const model of [...Object.values(config.models), config.fallbackModel]) {
      if (ids.includes(model)) continue;
      if (model === 'gemma-small') console.warn(`WARN: ${model} not listed`);
      else expect(ids, `model ${model}`).toContain(model);
    }
  });

  it('should return a non-empty reply for each text role', async () => {
    for (const role of LLM_ROLES.filter((r) => r !== 'stt')) {
      const r = await client.complete(role, {
        messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
        maxTokens: 400,
      });
      expect(r.text.length, role).toBeGreaterThan(0);
    }
  }, 300_000);

  it('should return valid SafetyClassifierOutput from completeJson', async () => {
    const r = await client.completeJson('safety', {
      messages: [
        {
          role: 'system',
          content:
            'Classify risk. Reply JSON {"level":"none|low|moderate|high|imminent","categories":[],"evidence":""}.',
        },
        { role: 'user', content: 'I had a nice walk today.' },
      ],
      schema: SafetyClassifierOutputSchema,
    });
    expect(r.data.level).toBeDefined();
  }, 60_000);
});
