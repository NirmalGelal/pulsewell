import { PrismaClient } from '@prisma/client';
import type { AppConfig } from './config/env';
import { systemClock, type Clock } from './lib/clock';
import { createLogger, type Logger } from './lib/logger';
import type { LlmClient } from './modules/llm/types';
import { createLlmClient } from './modules/llm';

export interface AppDeps {
  config: AppConfig; // parsed env
  prisma: PrismaClient;
  llm: LlmClient; // M03: createLlmClient (live | demo | mock)
  clock: Clock; // use instead of new Date() in services
  logger: Logger;
}

export function buildDeps(config: AppConfig): AppDeps {
  const logger = createLogger(config.LOG_LEVEL);
  return {
    config,
    prisma: new PrismaClient({ datasources: { db: { url: config.DATABASE_URL } } }),
    llm: createLlmClient(config, logger),
    clock: systemClock,
    logger,
  };
}
