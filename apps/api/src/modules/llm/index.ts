import type { Logger } from '../../lib/logger';
import type { AppConfig } from '../../config/env';
import { DemoLlmClient } from './demo-client';
import { LiveLlmClient } from './live-client';
import { MockLlmClient } from './mock-client';
import type { LlmClient } from './types';

export function createLlmClient(config: AppConfig, logger: Logger): LlmClient {
  switch (config.LLM_MODE) {
    case 'live':
      return new LiveLlmClient(config, logger);
    case 'demo':
      return new DemoLlmClient();
    case 'mock':
      return new MockLlmClient();
  }
}

export * from './types';
export { MockLlmClient } from './mock-client';
export { DemoLlmClient } from './demo-client';
export { LiveLlmClient } from './live-client';
export { ROLE_SETTINGS, modelFor, thinkingParams } from './config';
export { extractJson } from './json';
