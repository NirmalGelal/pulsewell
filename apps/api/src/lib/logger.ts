export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

const RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

/** JSON-lines logger. Never pass message text, report content, transcripts or tokens as meta. */
export function createLogger(level: LogLevel = 'info'): Logger {
  const emit = (l: Exclude<LogLevel, 'silent'>, msg: string, meta?: Record<string, unknown>) => {
    if (RANK[l] < RANK[level]) return;
    process.stdout.write(
      JSON.stringify({ level: l, time: new Date().toISOString(), msg, ...meta }) + '\n',
    );
  };
  return {
    debug: (m, meta) => emit('debug', m, meta),
    info: (m, meta) => emit('info', m, meta),
    warn: (m, meta) => emit('warn', m, meta),
    error: (m, meta) => emit('error', m, meta),
  };
}
