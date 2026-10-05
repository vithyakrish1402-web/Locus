// Sign-in problems as the person reads them (src/utils/authProblems.js), and the small word
// helpers of the way in (src/copy/access.js).
import { describe, it, expect } from 'vitest';
import { authProblem } from '../src/utils/authProblems.js';
import { AUTH_PROBLEMS, firstNameOf, spacedCode } from '../src/copy/access.js';

describe('authProblem', () => {
  it.each([
    ['auth/invalid-credential', 'sign-in', AUTH_PROBLEMS.wrongCredentials],
    ['auth/wrong-password', 'sign-in', AUTH_PROBLEMS.wrongCredentials],
    ['auth/invalid-email', 'sign-in', AUTH_PROBLEMS.badEmail],
    ['auth/email-already-in-use', 'create', AUTH_PROBLEMS.emailInUse],
    ['auth/weak-password', 'create', AUTH_PROBLEMS.weakPassword],
    ['auth/too-many-requests', 'sign-in', AUTH_PROBLEMS.tooManyTries],
    ['auth/network-request-failed', 'create', AUTH_PROBLEMS.offline],
    ['auth/user-not-found', 'reset', AUTH_PROBLEMS.noAccount],
  ])('%s while %s', (code, action, sentence) => {
    expect(authProblem({ code }, action)).toBe(sentence);
  });

  it('signing in never says which half was wrong (no "no account" for an unknown email)', () => {
    expect(authProblem({ code: 'auth/user-not-found' }, 'sign-in')).toBe(AUTH_PROBLEMS.wrongCredentials);
  });

  it("anything else gets the plain sentence, never Firebase's own words", () => {
    const shown = authProblem({ code: 'auth/internal-error', message: 'Firebase: Error (auth/internal-error).' });
    expect(shown).toBe(AUTH_PROBLEMS.unknown);
    expect(authProblem(undefined)).toBe(AUTH_PROBLEMS.unknown);
  });

  it('no problem sentence shouts or reads like a terminal', () => {
    Object.values(AUTH_PROBLEMS).forEach((sentence) => {
      expect(sentence).not.toMatch(/\[|_|\/\/|[A-Z]{4,}/);
    });
  });
});

describe('spacedCode', () => {
  it('reads a six-character code in two halves', () => {
    expect(spacedCode('k7m2qx')).toBe('K7M 2QX');
  });

  it('leaves any other length as it is', () => {
    expect(spacedCode('KTR7X9AB')).toBe('KTR7X9AB');
    expect(spacedCode(undefined)).toBe('');
  });
});

describe('firstNameOf', () => {
  it.each([
    ['MEERA IYER', 'Meera'],
    ['Meera Iyer', 'Meera'],
    ['  AARAV  ', 'Aarav'],
    ['deSouza Ana', 'deSouza'],
    ['', ''],
    [null, ''],
  ])('%j -> %j', (name, first) => {
    expect(firstNameOf(name)).toBe(first);
  });
});
