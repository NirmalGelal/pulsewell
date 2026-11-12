import type { LlmRole } from '@pvc/shared';
import type { AppConfig } from '../../config/env';
import type { ThinkingMode } from './types';

export interface RoleSettings {
  temperature: number;
  thinking: ThinkingMode;
  maxTokens: number;
  timeoutMs: number;
  stream: boolean;
}

export const ROLE_SETTINGS: Record<LlmRole, RoleSettings> = {
  interviewer: {
    temperature: 0.6,
    thinking: 'off',
    maxTokens: 400,
    timeoutMs: 30_000,
    stream: true,
  },
  safety: { temperature: 0.0, thinking: 'off', maxTokens: 200, timeoutMs: 4_000, stream: false },
  tracker: {
    temperature: 0.1,
    thinking: 'low',
    maxTokens: 1_200,
    timeoutMs: 20_000,
    stream: false,
  },
  reportWriter: {
    temperature: 0.2,
    thinking: 'medium',
    maxTokens: 6_000,
    timeoutMs: 120_000,
    stream: false,
  },
  verifier: {
    temperature: 0.0,
    thinking: 'low',
    maxTokens: 2_000,
    timeoutMs: 60_000,
    stream: false,
  },
  assistant: {
    temperature: 0.3,
    thinking: 'low',
    maxTokens: 1_500,
    timeoutMs: 60_000,
    stream: false,
  },
  stt: { temperature: 0.0, thinking: 'off', maxTokens: 1_500, timeoutMs: 60_000, stream: false },
};

export type LlmConfig = Pick<
  AppConfig,
  'models' | 'fallbackModel' | 'NRP_BASE_URL' | 'NRP_API_KEY'
>;

export function modelFor(config: Pick<AppConfig, 'models'>, role: LlmRole): string {
  return config.models[role];
}

/** Body params that control model "thinking", per model family. */
export function thinkingParams(model: string, mode: ThinkingMode): Record<string, unknown> {
  if (model.startsWith('gpt-oss')) {
    return { reasoning_effort: mode === 'off' ? 'low' : mode };
  }
  return {
    chat_template_kwargs: { enable_thinking: mode !== 'off' },
    ...(mode !== 'off' ? { reasoning_effort: mode } : {}),
  };
}
