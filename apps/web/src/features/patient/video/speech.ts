/** Pure helpers for the companion's spoken output. */

const NOVELTY = new Set([
  'albert',
  'bad news',
  'bahh',
  'bells',
  'boing',
  'bubbles',
  'cellos',
  'deranged',
  'fred',
  'good news',
  'hysterical',
  'jester',
  'junior',
  'kathy',
  'organ',
  'ralph',
  'superstar',
  'trinoids',
  'whisper',
  'wobble',
  'zarvox',
]);
const NATURAL = /natural|neural|premium|enhanced|online/i;
const PREFERRED = /samantha|ava|allison|google (us|uk) english|serena|karen|moira|daniel/i;

/** Picks the most natural-sounding English voice, preferring local ones. */
export function pickBestVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const english = voices.filter((v) => /^en([-_]|$)/i.test(v.lang));
  if (english.length === 0) return null;
  const score = (v: SpeechSynthesisVoice) => {
    let s = 0;
    if (NOVELTY.has(v.name.toLowerCase())) s -= 20;
    if (NATURAL.test(v.name)) s += 6;
    if (PREFERRED.test(v.name)) s += 3;
    if (v.localService) s += 2;
    if (/^en[-_]us$/i.test(v.lang)) s += 1;
    if (v.default) s += 0.5;
    return s;
  };
  return [...english].sort((a, b) => score(b) - score(a))[0] ?? null;
}

/** Splits off complete sentences from a growing buffer. `rest` is the unfinished tail. */
export function takeSentences(buffer: string): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  let rest = buffer;
  for (;;) {
    const m = /^([\s\S]*?[.!?]["')\]]*)\s+(?=\S)/.exec(rest);
    if (!m) break;
    const s = m[1]!.trim();
    if (s) sentences.push(s);
    rest = rest.slice(m[0].length);
  }
  return { sentences, rest };
}
