import { MessageStreamEventSchema, type MessageStreamEvent } from '@pvc/shared';

/** Parses an SSE response body into validated `{event, data}` objects. */
export function parseSse(text: string): MessageStreamEvent[] {
  return text
    .split('\n\n')
    .map((b) => b.trim())
    .filter(Boolean)
    .map((block) => {
      const event = /^event: (.*)$/m.exec(block)?.[1] ?? '';
      const data = /^data: (.*)$/m.exec(block)?.[1] ?? 'null';
      return MessageStreamEventSchema.parse({ event, data: JSON.parse(data) });
    });
}
