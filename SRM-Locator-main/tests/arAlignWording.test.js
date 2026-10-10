// ALIGN's answers and the compass refusal in plain words (redesign AR Scan batch, piece 9):
// no [SYS_AR] tags, no capitals, and a refusal is an ordinary problem, so amber (a warning
// notice), never red (an error notice).
import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { AR_ALIGN } from '../src/copy/arScan.js';

const source = fs.readFileSync(`${process.cwd()}/src/ARCompass.jsx`, 'utf8');

describe('ALIGN in plain words', () => {
  it('has a plain sentence for every reason computeAlignment can refuse with', () => {
    expect(Object.keys(AR_ALIGN.refused).sort()).toEqual(['gps', 'no-landmark', 'not-centred', 'too-close', 'walking']);
    for (const words of [...Object.values(AR_ALIGN.refused), AR_ALIGN.aligned('TECH PARK'), AR_ALIGN.compassRefused]) {
      expect(words).not.toMatch(/\[SYS|ALIGN:|GPS fix|[A-Z]{4,}(?<!TECH)(?<!PARK)/);
      expect(words[0]).toMatch(/[A-Z]/);
    }
  });

  it('AR Scan posts its refusals as warnings (amber), never as errors (red)', () => {
    expect(source).not.toMatch(/notify\.error\(/);
    expect(source).toMatch(/notify\.warning\(ALIGN_REFUSALS\[result\.reason\]\)/);
    expect(source).toMatch(/notify\.warning\(ALIGN_REFUSALS\.walking\)/);
    expect(source).toMatch(/notify\.warning\(AR_ALIGN\.compassRefused\)/);
    expect(source).not.toMatch(/\[SYS_AR\]|\[SYS_ERROR\]/);
  });
});
