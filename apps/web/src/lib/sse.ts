import { MessageStreamEventSchema, type MessageStreamEvent } from '@pvc/shared';
import { ApiError, authHeaders, toApiError } from './api';
import { API_URL } from './env';

export interface PostSseOptions {
  onEvent: (event: MessageStreamEvent) => void;
  signal?: AbortSignal;
}

function handleBlock(block: string, onEvent: (e: MessageStreamEvent) => void): void {
  let event = 'message';
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line === '' || line.startsWith(':')) continue;
    const idx = line.indexOf(':');
    const field = idx === -1 ? line : line.slice(0, idx);
    let value = idx === -1 ? '' : line.slice(idx + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  if (data.length === 0) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data.join('\n'));
  } catch {
    console.error('Ignoring SSE event with invalid JSON', event);
    return;
  }
  const result = MessageStreamEventSchema.safeParse({ event, data: parsed });
  if (!result.success) {
    console.error('Ignoring invalid SSE event', event, result.error.issues);
    return;
  }
  onEvent(result.data);
}

/** POSTs JSON and reads a text/event-stream response. Resolves when the stream ends. */
export async function postSse(path: string, body: unknown, opts: PostSseOptions): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...authHeaders(),
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK', 'Could not reach the server');
  }
  if (!res.ok) throw await toApiError(res, path);
  if (!res.body) return;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const drain = (final: boolean) => {
    let work = buffer;
    // A lone trailing \r may be the first half of \r\n; hold it for the next chunk.
    let held = '';
    if (!final && work.endsWith('\r')) {
      held = '\r';
      work = work.slice(0, -1);
    }
    work = work.replace(/\r\n?/g, '\n');
    let idx: number;
    while ((idx = work.indexOf('\n\n')) !== -1) {
      handleBlock(work.slice(0, idx), opts.onEvent);
      work = work.slice(idx + 2);
    }
    if (final && work.trim() !== '') {
      handleBlock(work, opts.onEvent);
      work = '';
    }
    buffer = work + held;
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    drain(false);
  }
  buffer += decoder.decode();
  drain(true);
}
