import { z } from 'zod';
import { type LlmRole } from '@pvc/shared';

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    WEB_ORIGIN: z.string().min(1).default('http://localhost:5173'),
    DATABASE_URL: z.string().min(1).default('file:./dev.db'),
    JWT_SECRET: z.string().min(32, 'must be at least 32 characters'),
    JWT_EXPIRES_IN: z.string().min(1).default('12h'),
    LLM_MODE: z.enum(['live', 'demo', 'mock']).default('demo'),
    NRP_BASE_URL: z.string().min(1).default('https://ellm.nrp-nautilus.io/v1'),
    NRP_API_KEY: z.string().default(''),
    MODEL_INTERVIEWER: z.string().min(1).default('qwen3-small'),
    MODEL_SAFETY: z.string().min(1).default('gemma'),
    MODEL_TRACKER: z.string().min(1).default('gpt-oss'),
    MODEL_REPORT_WRITER: z.string().min(1).default('qwen3'),
    MODEL_VERIFIER: z.string().min(1).default('gpt-oss'),
    MODEL_ASSISTANT: z.string().min(1).default('qwen3'),
    MODEL_STT: z.string().min(1).default('gemma-small'),
    MODEL_FALLBACK: z.string().min(1).default('service'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
    VITE_API_URL: z.string().default('http://localhost:4000'),
  })
  .superRefine((v, ctx) => {
    if (v.LLM_MODE === 'live' && v.NRP_API_KEY.trim() === '') {
      ctx.addIssue({
        code: 'custom',
        path: ['NRP_API_KEY'],
        message: 'is required when LLM_MODE=live',
      });
    }
  });

export type AppConfig = z.infer<typeof EnvSchema> & {
  models: Record<LlmRole, string>;
  fallbackModel: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  // Treat empty strings as unset so `FOO=` in .env falls back to defaults (except NRP_API_KEY).
  const cleaned: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env))
    cleaned[k] = v === '' && k !== 'NRP_API_KEY' ? undefined : v;
  const parsed = EnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (i) => `  - ${i.path.join('.') || '(env)'}: ${i.message}`,
    );
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  const e = parsed.data;
  const models = {
    interviewer: e.MODEL_INTERVIEWER,
    safety: e.MODEL_SAFETY,
    tracker: e.MODEL_TRACKER,
    reportWriter: e.MODEL_REPORT_WRITER,
    verifier: e.MODEL_VERIFIER,
    assistant: e.MODEL_ASSISTANT,
    stt: e.MODEL_STT,
  } satisfies Record<LlmRole, string>;
  return { ...e, models, fallbackModel: e.MODEL_FALLBACK };
}
