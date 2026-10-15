import { describe, it, expect, vi } from 'vitest';
import { createIdTokenVerifier, identityConfig, memoizeLoader, DEFAULT_PROJECT_ID, MAX_TOKEN_LENGTH } from '../backend/identity.js';

/**
 * The ID-token check (backend/identity.js) with a fake Firebase library, so nothing here
 * touches the network. The real library is exercised in identity.sdk.test.js.
 */

const SECRET_MARK = 'SECRETMARK';
// Shaped like a token and carrying a marker that must never appear in a log line.
const TOKEN = `aaa${SECRET_MARK}.bbb.ccc`;

const fakeAuth = (impl) => ({ verifyIdToken: vi.fn(impl) });
const withFake = (impl, options = {}) => {
  const auth = fakeAuth(impl);
  const log = { error: vi.fn() };
  const verifier = createIdTokenVerifier({ loadAuth: async () => auth, log, env: {}, ...options });
  return { auth, log, ...verifier };
};
const libraryError = (code, message = '') => Object.assign(new Error(message), { code });

describe('a valid token', () => {
  it('gives back the uid the library found', async () => {
    const { verifyIdToken, auth } = withFake(async () => ({ uid: 'user-1' }));
    expect(await verifyIdToken(TOKEN)).toEqual({ ok: true, uid: 'user-1' });
    expect(auth.verifyIdToken).toHaveBeenCalledWith(TOKEN, false);
  });

  it('asks the library to check revocation only when told to', async () => {
    const { verifyIdToken, auth } = withFake(async () => ({ uid: 'u' }), { checkRevoked: true });
    await verifyIdToken(TOKEN);
    expect(auth.verifyIdToken).toHaveBeenCalledWith(TOKEN, true);
  });
});

describe('input it never lets reach the library', () => {
  const never = async (input) => {
    const { verifyIdToken, auth } = withFake(async () => ({ uid: 'u' }));
    expect(await verifyIdToken(input)).toEqual({ ok: false, reason: 'malformed' });
    expect(auth.verifyIdToken).not.toHaveBeenCalled();
  };

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a number', 123],
    ['an object', { token: TOKEN }],
    ['an object that prints like a token', { toString: () => TOKEN }],
    ['an array', [TOKEN]],
    ['a function', () => TOKEN],
    ['the empty string', ''],
    ['spaces', '   '],
    ['two parts', 'aaa.bbb'],
    ['four parts', 'a.b.c.d'],
    ['an empty header', '.bbb.ccc'],
    ['an empty payload', 'aaa..ccc'],
    ['whitespace inside', 'aaa .bbb.ccc'],
    ['a newline inside', 'aaa\n.bbb.ccc'],
    ['characters a token never has', 'aaa.b+b.ccc'],
    ['a Bearer prefix', `Bearer ${TOKEN}`],
  ])('%s', (_name, input) => never(input));

  it('a token over the length limit, however well formed', async () => {
    await never(`${'a'.repeat(MAX_TOKEN_LENGTH)}.b.c`);
    await never('a'.repeat(10 * 1024 * 1024));
  });

  it('but accepts one right at the limit', async () => {
    const { verifyIdToken, auth } = withFake(async () => ({ uid: 'u' }));
    const longest = `${'a'.repeat(MAX_TOKEN_LENGTH - 4)}.b.c`;
    expect(longest.length).toBe(MAX_TOKEN_LENGTH);
    expect((await verifyIdToken(longest)).ok).toBe(true);
    expect(auth.verifyIdToken).toHaveBeenCalledTimes(1);
  });
});

describe('what the library says about a token', () => {
  const reasonOf = async (error) => {
    const { verifyIdToken } = withFake(async () => { throw error; });
    return verifyIdToken(TOKEN);
  };

  it.each([
    ['auth/id-token-expired', '', 'expired'],
    ['auth/id-token-revoked', '', 'revoked'],
    ['auth/user-disabled', '', 'revoked'],
    ['auth/user-not-found', '', 'revoked'],
    ['auth/argument-error', 'Firebase ID token has incorrect "aud" (audience) claim.', 'wrong-project'],
    ['auth/argument-error', 'Firebase ID token has incorrect "iss" (issuer) claim.', 'wrong-project'],
    ['auth/argument-error', 'Firebase ID token has invalid signature.', 'invalid'],
    ['auth/argument-error', 'Decoding Firebase ID token failed.', 'invalid'],
    ['auth/argument-error', 'Firebase ID token has an empty "sub" (subject) claim.', 'invalid'],
    ['auth/argument-error', '', 'invalid'],
    ['auth/invalid-id-token', '', 'invalid'],
  ])('%s %s means %s', async (code, message, reason) => {
    expect(await reasonOf(libraryError(code, message))).toEqual({ ok: false, reason });
  });

  it.each([
    ['network trouble', libraryError('app/network-error')],
    ['an internal error', libraryError('auth/internal-error')],
    ['missing credentials for a revocation check', libraryError('auth/invalid-credential')],
    ['an error with no code', new Error('boom')],
    ['a TypeError', new TypeError('x is not a function')],
    ['a thrown string', 'boom'],
    ['a thrown null', null],
    ['a thrown undefined', undefined],
    ['a non-string code', Object.assign(new Error('x'), { code: 42 })],
  ])('%s means "could not decide", never "valid"', async (_name, error) => {
    expect(await reasonOf(error)).toEqual({ ok: false, reason: 'unavailable' });
  });
});

describe('a library answer that is not a person', () => {
  it.each([
    ['nothing', undefined],
    ['null', null],
    ['an object with no uid', {}],
    ['an empty uid', { uid: '' }],
    ['a numeric uid', { uid: 7 }],
    ['an object uid', { uid: { a: 1 } }],
    ['a uid over Firebase\'s limit', { uid: 'u'.repeat(129) }],
  ])('%s is invalid', async (_name, decoded) => {
    const { verifyIdToken } = withFake(async () => decoded);
    expect(await verifyIdToken(TOKEN)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('a uid of exactly 128 characters is fine', async () => {
    const { verifyIdToken } = withFake(async () => ({ uid: 'u'.repeat(128) }));
    expect((await verifyIdToken(TOKEN)).ok).toBe(true);
  });
});

describe('the library not being there', () => {
  it('is "unavailable", not a crash, when it cannot be loaded', async () => {
    const log = { error: vi.fn() };
    const verifier = createIdTokenVerifier({ loadAuth: async () => { throw new Error('Cannot find module'); }, log, env: {} });
    await expect(verifier.verifyIdToken(TOKEN)).resolves.toEqual({ ok: false, reason: 'unavailable' });
  });

  it('is asked for afresh on every request, and a failed load does not break later ones', async () => {
    let attempts = 0;
    const auth = fakeAuth(async () => ({ uid: 'u' }));
    const loadAuth = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('first load fails');
      return auth;
    });
    const verifier = createIdTokenVerifier({ loadAuth, log: { error: vi.fn() }, env: {} });
    expect((await verifier.verifyIdToken(TOKEN)).reason).toBe('unavailable');
    expect((await verifier.verifyIdToken(TOKEN)).ok).toBe(true);
  });

  it('handles a hundred requests at once', async () => {
    const { verifyIdToken } = withFake(async () => ({ uid: 'u' }));
    const results = await Promise.all(Array.from({ length: 100 }, () => verifyIdToken(TOKEN)));
    expect(results.every((r) => r.ok)).toBe(true);
  });
});

describe('loading the real library', () => {
  it('happens once, however many requests arrive together or later', async () => {
    const load = vi.fn(async () => ({ the: 'library' }));
    const loadOnce = memoizeLoader(load);
    const results = await Promise.all([loadOnce(), loadOnce(), loadOnce()]);
    expect(await loadOnce()).toBe(results[0]);
    expect(results.every((r) => r === results[0])).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('is retried after a failure, and once it works, left alone', async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('cannot load yet'))
      .mockResolvedValue({ the: 'library' });
    const loadOnce = memoizeLoader(load);
    await expect(loadOnce()).rejects.toThrow('cannot load yet');
    await expect(loadOnce()).resolves.toEqual({ the: 'library' });
    await loadOnce();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('turns a loader that throws at once into a rejection', async () => {
    const loadOnce = memoizeLoader(() => { throw new Error('sync boom'); });
    await expect(loadOnce()).rejects.toThrow('sync boom');
  });
});

describe('the emulator guard', () => {
  it('refuses everything when the emulator variable is set by mistake', async () => {
    const { verifyIdToken, auth, log } = withFake(async () => ({ uid: 'u' }), { env: { FIREBASE_AUTH_EMULATOR_HOST: 'localhost:9099' } });
    expect(await verifyIdToken(TOKEN)).toEqual({ ok: false, reason: 'unavailable' });
    expect(auth.verifyIdToken).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it('allows it only when allowed on purpose', async () => {
    const env = { FIREBASE_AUTH_EMULATOR_HOST: 'localhost:9099', LOCUS_ALLOW_AUTH_EMULATOR: 'true' };
    const { verifyIdToken } = withFake(async () => ({ uid: 'u' }), { env });
    expect((await verifyIdToken(TOKEN)).ok).toBe(true);
    for (const value of ['1', 'TRUE', 'yes', '']) {
      const refused = withFake(async () => ({ uid: 'u' }), { env: { ...env, LOCUS_ALLOW_AUTH_EMULATOR: value } });
      expect((await refused.verifyIdToken(TOKEN)).reason).toBe('unavailable');
    }
  });
});

describe('logging', () => {
  it('never writes the token, in any failure', async () => {
    const lines = [];
    const log = { error: (...args) => lines.push(args.join(' ')) };
    const spies = ['log', 'info', 'warn', 'error'].map((m) => vi.spyOn(console, m).mockImplementation((...args) => lines.push(args.join(' '))));
    try {
      const failures = [
        libraryError('app/network-error', `request failed for ${TOKEN}`),
        libraryError('auth/argument-error', `bad ${TOKEN}`),
        new Error(`weird ${TOKEN}`),
        `thrown ${TOKEN}`,
      ];
      for (const error of failures) {
        const verifier = createIdTokenVerifier({ loadAuth: async () => fakeAuth(async () => { throw error; }), log, env: {}, now: (() => { let t = 0; return () => (t += 1e6); })() });
        await verifier.verifyIdToken(TOKEN);
      }
      const unsafe = createIdTokenVerifier({ loadAuth: async () => fakeAuth(async () => ({ uid: 'u' })), log, env: { FIREBASE_AUTH_EMULATOR_HOST: 'x' } });
      await unsafe.verifyIdToken(TOKEN);
      expect(lines.length).toBeGreaterThan(0); // it does say that something is wrong...
      expect(lines.join('\n')).not.toContain(SECRET_MARK); // ...but never with the token
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });

  it('writes at most one line a minute for a repeated problem, and again after that', async () => {
    let clock = 0;
    const log = { error: vi.fn() };
    const verifier = createIdTokenVerifier({
      loadAuth: async () => { throw new Error('down'); }, log, env: {}, now: () => clock,
    });
    for (let i = 0; i < 50; i++) await verifier.verifyIdToken(TOKEN);
    expect(log.error).toHaveBeenCalledTimes(1);
    clock += 59999;
    await verifier.verifyIdToken(TOKEN);
    expect(log.error).toHaveBeenCalledTimes(1);
    clock += 1;
    await verifier.verifyIdToken(TOKEN);
    expect(log.error).toHaveBeenCalledTimes(2);
  });

  it('says nothing about a token that is merely bad', async () => {
    const { verifyIdToken, log } = withFake(async () => { throw libraryError('auth/id-token-expired'); });
    await verifyIdToken(TOKEN);
    await verifyIdToken('garbage');
    expect(log.error).not.toHaveBeenCalled();
  });
});

describe('configuration', () => {
  it('defaults to the LOCUS Firebase project, with revocation checks off', () => {
    expect(identityConfig({})).toEqual({ projectId: DEFAULT_PROJECT_ID, checkRevoked: false });
    expect(DEFAULT_PROJECT_ID).toBe('locus-5c6a8');
  });

  it('takes the project from the environment, and turns revocation checks on only for exactly "true"', () => {
    expect(identityConfig({ LOCUS_FIREBASE_PROJECT_ID: 'other' }).projectId).toBe('other');
    expect(identityConfig({ LOCUS_CHECK_REVOKED_TOKENS: 'true' }).checkRevoked).toBe(true);
    for (const value of ['TRUE', '1', 'yes', 'false', '']) {
      expect(identityConfig({ LOCUS_CHECK_REVOKED_TOKENS: value }).checkRevoked).toBe(false);
    }
  });
});
