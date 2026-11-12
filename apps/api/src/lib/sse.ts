import type { Response } from 'express';

export interface SseChannel {
  send(event: string, data: unknown): void;
  close(): void;
}

export function openSse(res: Response): SseChannel {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  let closed = false;
  res.on('close', () => {
    closed = true;
  });
  return {
    send(event, data) {
      if (closed || res.writableEnded) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      (res as unknown as { flush?: () => void }).flush?.();
    },
    close() {
      if (closed || res.writableEnded) return;
      closed = true;
      res.end();
    },
  };
}
