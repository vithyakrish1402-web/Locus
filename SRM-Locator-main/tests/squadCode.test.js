import { describe, it, expect } from 'vitest';
import { generateRandomSquadCode } from '../src/utils/squadCode';

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
    // High collision resistance across 100 random 6-character base36 strings (~2.1 billion combinations)
    expect(set.size).toBeGreaterThan(95);
  });
});
