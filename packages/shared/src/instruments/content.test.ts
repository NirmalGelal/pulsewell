import { describe, expect, it } from 'vitest';
import { DOMAIN_KEYS, GAD7_KEYS, PHQ9_KEYS, SUMMARY_SECTIONS } from '../keys';
import { DOMAINS, SUMMARY_SECTION_LABELS } from './domains';
import { GAD7_ITEMS } from './gad7';
import { INSTRUMENT_ATTRIBUTION, PHQ9_ITEMS } from './phq9';

describe('content', () => {
  it('instrument items', () => {
    expect(PHQ9_ITEMS.map((i) => i.key)).toEqual([...PHQ9_KEYS]);
    expect(GAD7_ITEMS.map((i) => i.key)).toEqual([...GAD7_KEYS]);
    for (const i of [...PHQ9_ITEMS, ...GAD7_ITEMS]) {
      for (const f of [i.officialText, i.shortLabel, i.conversational, i.confirmPrompt]) {
        expect(f.trim().length).toBeGreaterThan(0);
      }
    }
    expect(INSTRUMENT_ATTRIBUTION).toContain('Spitzer');
  });
  it('domains', () => {
    expect(DOMAINS.map((d) => d.key)).toEqual([...DOMAIN_KEYS]);
    expect(DOMAINS.filter((d) => d.required).map((d) => d.key)).toEqual([
      'chief_concern',
      'priorities',
    ]);
  });
  it('summary labels', () => {
    for (const s of SUMMARY_SECTIONS) {
      expect(SUMMARY_SECTION_LABELS[s].label).toBeTruthy();
      expect(SUMMARY_SECTION_LABELS[s].plainLabel).toBeTruthy();
    }
  });
});
