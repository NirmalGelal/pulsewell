import { describe, expect, it } from 'vitest';
import { normalize, scanKeywords } from './keywords';

describe('normalize', () => {
  it('should lowercase, straighten quotes, strip punctuation and collapse whitespace', () => {
    expect(normalize('  I’m   HERE!!  Self-harm... ')).toBe("i'm here self harm");
  });
});

describe('scanKeywords', () => {
  it.each([
    [
      "I'm going to kill myself tonight",
      'imminent',
      'suicidal_ideation',
      "I'm going to kill myself",
    ],
    ['I’m going to end my life', 'imminent', 'suicidal_ideation', 'I’m going to end my life'],
    ['im going to kill myself', 'imminent', 'suicidal_ideation', 'im going to kill myself'],
    ['I Have The Pills Ready.', 'imminent', 'suicidal_ideation', 'I Have The Pills Ready'],
    ["I'm going to kill her", 'imminent', 'harm_to_others', "I'm going to kill her"],
    ['sometimes I wish I was dead', 'elevated', 'suicidal_ideation', 'wish I was dead'],
    ["I've been cutting myself", 'elevated', 'self_harm', 'cutting myself'],
    ['he hits me when he drinks', 'elevated', 'abuse', 'hits me'],
    ['I took too many pills', 'elevated', 'substance_emergency', 'took too many pills'],
    ['there are voices telling me things', 'elevated', 'psychosis', 'voices telling me'],
    [
      'I dont want to be here anymore',
      'elevated',
      'suicidal_ideation',
      'dont want to be here anymore',
    ],
    ['I think about self-harm', 'elevated', 'self_harm', 'self-harm'],
    ['everything feels hopeless', 'concern', 'suicidal_ideation', 'hopeless'],
  ] as const)('should classify %j as %s/%s', (text, level, category, evidence) => {
    const r = scanKeywords(text);
    expect(r.level).toBe(level);
    expect(r.categories).toContain(category);
    expect(r.evidence).toBe(evidence);
  });

  it.each([
    'I killed it at my presentation',
    'this traffic is killing me',
    'I want to skill myself up',
    'I feel a bit sad and tired',
    '',
  ])('should not flag %j', (text) => {
    expect(scanKeywords(text)).toEqual({ level: 'none', categories: [], evidence: '' });
  });

  it('should flag the word "suicide" even in a movie context (intentional over-triggering at elevated)', () => {
    // Over-triggering is acceptable; missing risk is not. The classifier handles nuance.
    expect(scanKeywords('suicide squad movie').level).toBe('elevated');
  });

  it('should treat negation as elevated (documented limitation)', () => {
    expect(scanKeywords('I would never kill myself').level).toBe('elevated');
  });

  it('should let the highest level win and union categories', () => {
    const r = scanKeywords('I feel hopeless, I cut myself, and I am going to kill myself');
    expect(r.level).toBe('imminent');
    expect(r.categories).toEqual(['suicidal_ideation', 'self_harm']);
    expect(r.evidence).toBe('I am going to kill myself');
  });
});
