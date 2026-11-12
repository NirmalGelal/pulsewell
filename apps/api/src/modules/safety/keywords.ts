import { RISK_CATEGORIES, riskRank, type RiskCategory, type RiskLevel } from '@pvc/shared';

export interface KeywordResult {
  level: RiskLevel;
  categories: RiskCategory[];
  evidence: string;
}

interface Entry {
  level: Exclude<RiskLevel, 'none'>;
  category: RiskCategory;
  phrases: string[];
}

const TARGETS = ['him', 'her', 'them'];

// Imminent phrases are first-person intent / plan / means / timeline only.
// Known limitation (intentional): negation is not handled ("I would never kill myself" -> elevated).
// Over-triggering at elevated is acceptable; missing risk is not.
const TABLE: Entry[] = [
  {
    level: 'imminent',
    category: 'suicidal_ideation',
    phrases: [
      'i am going to kill myself',
      "i'm going to kill myself",
      'i will kill myself',
      "i'm going to end my life",
      'i am going to end my life',
      'i have a plan to kill myself',
      'i plan to kill myself',
      "i'm going to end it tonight",
      'i am going to end it tonight',
      'tonight i will end it',
      'this is my goodbye',
      'i have the pills ready',
    ],
  },
  {
    level: 'imminent',
    category: 'harm_to_others',
    phrases: [
      ...TARGETS.flatMap((t) => [`i am going to kill ${t}`, `i'm going to kill ${t}`]),
      "i'm going to hurt someone",
      'i am going to hurt someone',
    ],
  },
  {
    level: 'elevated',
    category: 'suicidal_ideation',
    phrases: [
      'kill myself',
      'suicide',
      'suicidal',
      'end my life',
      'want to die',
      'wish i was dead',
      'wish i were dead',
      'better off dead',
      "don't want to be alive",
      "don't want to be here anymore",
      'no reason to live',
    ],
  },
  {
    level: 'elevated',
    category: 'self_harm',
    phrases: [
      'hurt myself',
      'hurting myself',
      'cut myself',
      'cutting myself',
      'self harm',
      'self-harm',
      'burn myself',
    ],
  },
  {
    level: 'elevated',
    category: 'substance_emergency',
    phrases: ['overdose', 'overdosed', 'took too many pills'],
  },
  {
    level: 'elevated',
    category: 'harm_to_others',
    phrases: ['kill him', 'kill her', 'kill them', 'hurt someone'],
  },
  {
    level: 'elevated',
    category: 'abuse',
    phrases: ['hits me', 'beats me', 'being abused', 'abusing me', 'afraid to go home'],
  },
  {
    level: 'elevated',
    category: 'psychosis',
    phrases: ['voices telling me', 'voices tell me to'],
  },
  {
    level: 'concern',
    category: 'suicidal_ideation',
    phrases: [
      'hopeless',
      "can't go on",
      'no way out',
      'give up on everything',
      'burden to everyone',
      'worthless',
    ],
  },
];

const straighten = (s: string) => s.replace(/[‘’‛ʼ`´]/g, "'");

/** Lowercase, curly->straight quotes, punctuation (except apostrophes) -> space, whitespace collapsed. */
export function normalize(text: string): string {
  return straighten(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Tokens compare with apostrophes removed, so "im"/"i'm" and "dont"/"don't" are equivalent.
const key = (tok: string) => tok.replace(/'/g, '');
const phraseTokens = (p: string) =>
  normalize(p)
    .split(' ')
    .map((t) => key(t.replace(/^'+|'+$/g, '')));

const COMPILED = TABLE.flatMap((e) =>
  e.phrases.map((p) => ({ level: e.level, category: e.category, tokens: phraseTokens(p) })),
);

interface Tok {
  k: string;
  start: number;
  end: number;
}

function tokenize(text: string): Tok[] {
  const s = straighten(text); // same length as the original (1:1 char replacement)
  const out: Tok[] = [];
  const re = /[\p{L}\p{N}']+/gu;
  for (const m of s.matchAll(re)) {
    let start = m.index;
    let word = m[0];
    const lead = word.match(/^'+/)?.[0].length ?? 0;
    start += lead;
    word = word.slice(lead).replace(/'+$/, '');
    if (!word) continue;
    out.push({ k: key(word.toLowerCase()), start, end: start + word.length });
  }
  return out;
}

export function scanKeywords(text: string): KeywordResult {
  const toks = tokenize(text);
  let best: { level: RiskLevel; start: number; end: number } | null = null;
  const categories = new Set<RiskCategory>();
  for (const c of COMPILED) {
    const n = c.tokens.length;
    for (let i = 0; i + n <= toks.length; i++) {
      if (!c.tokens.every((t, j) => toks[i + j]!.k === t)) continue;
      categories.add(c.category);
      const start = toks[i]!.start;
      const end = toks[i + n - 1]!.end;
      if (
        !best ||
        riskRank(c.level) > riskRank(best.level) ||
        (c.level === best.level && start < best.start)
      ) {
        best = { level: c.level, start, end };
      }
    }
  }
  if (!best) return { level: 'none', categories: [], evidence: '' };
  return {
    level: best.level,
    categories: RISK_CATEGORIES.filter((c) => categories.has(c)),
    evidence: text.slice(best.start, best.end),
  };
}
