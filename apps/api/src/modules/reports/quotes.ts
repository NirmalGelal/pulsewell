import type { Quote } from '@pvc/shared';
import type { TurnMessage } from './writer';

const norm = (s: string): string =>
  s.replace(/[‘’‛]/g, "'").replace(/[“”‟]/g, '"').replace(/\s+/g, ' ').trim();

/** Pure. Keeps only quotes that appear verbatim (modulo whitespace/curly quotes) in a PATIENT turn. */
export function checkQuotes(
  quotes: { text: string; turnId: number }[],
  messages: TurnMessage[],
): { quotes: Quote[]; quotesRemoved: number } {
  const patient = messages
    .filter((m) => m.sender === 'PATIENT')
    .map((m) => ({ turnId: m.turnId, text: norm(m.text) }));
  const out: Quote[] = [];
  const seen = new Set<string>();
  let removed = 0;
  for (const q of quotes) {
    const text = norm(q.text);
    if (!text || seen.has(text)) {
      removed++;
      continue;
    }
    let turnId: number | null = null;
    const cited = patient.find((m) => m.turnId === q.turnId);
    if (cited && cited.text.includes(text)) turnId = cited.turnId;
    else {
      const hits = patient.filter((m) => m.text.includes(text));
      if (hits.length === 1) turnId = hits[0]!.turnId;
    }
    if (turnId === null) {
      removed++;
      continue;
    }
    seen.add(text);
    out.push({ id: `quote-${out.length + 1}`, text: q.text.trim(), turnId });
  }
  return { quotes: out, quotesRemoved: removed };
}
