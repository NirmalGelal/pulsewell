import { loadConfig } from './config/env';
import { buildDeps } from './deps';
import { createApp } from './app';

const config = loadConfig();
const deps = buildDeps(config);
const app = createApp(deps);

const server = app.listen(config.PORT, () => {
  deps.logger.info('API listening', { port: config.PORT, llmMode: deps.llm.mode });
});

async function shutdown(signal: string) {
  deps.logger.info('Shutting down', { signal });
  server.close();
  await deps.prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
