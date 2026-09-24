import { describe, it, expect } from 'vitest';
import { SQUAD_CODE_ALPHABET, generateRandomSquadCode } from '../src/utils/squadCode';

describe('squadCode Utility', () => {
  it('generates a 6-character code by default', () => {
    const code = generateRandomSquadCode();
    expect(code).toHaveLength(6);
  });

  it('generates a code of custom length', () => {
    expect(generateRandomSquadCode(4)).toHaveLength(4);
    expect(generateRandomSquadCode(8)).toHaveLength(8);
  });

  it('contains only uppercase alphanumeric characters', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateRandomSquadCode();
      expect(code).toMatch(/^[A-Z0-9]{6}$/);
    }
  });

  it('generates diverse codes across invocations', () => {
    const set = new Set();
    for (let i = 0; i < 100; i++) {
      set.add(generateRandomSquadCode());
    }
    // High collision resistance across 100 random 6-character base32 strings (~1.07 billion combinations)
    expect(set.size).toBeGreaterThan(95);
  });

  // O/0 and I/1 look alike in the app's dot font; AV4MV0 was misread as AV4MVO on a device.
  it('never uses a character that is easily misread as another', () => {
    for (const c of 'O0I1') expect(SQUAD_CODE_ALPHABET).not.toContain(c);
    for (let i = 0; i < 500; i++) {
      expect(generateRandomSquadCode()).not.toMatch(/[O0I1]/);
    }
  });

  it('still uses every other letter and digit, so codes stay hard to guess', () => {
    expect(SQUAD_CODE_ALPHABET).toHaveLength(32);
    expect(new Set(SQUAD_CODE_ALPHABET).size).toBe(32);
    expect(SQUAD_CODE_ALPHABET).toMatch(/^[A-Z2-9]+$/);
  });
});
