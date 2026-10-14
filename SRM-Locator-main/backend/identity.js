// Who is asking? Verifies a Firebase ID token and answers with the person's uid.
//
// This is the one place the server turns "a string a phone sent" into "this really is uid X".
// It wraps firebase-admin, used for verification only: Firebase's public keys need nothing but
// the project id, so there is no service-account key behind it. Everything else in the server
// talks to the small interface below and never to the library, so tests inject a fake.
//
//   const verifier = createIdTokenVerifier();
//   const result = await verifier.verifyIdToken(token);
//   result: { ok: true, uid } | { ok: false, reason }
//
// reason (never an exception, never the token itself):
//   'malformed'     not a string, empty, too long, or not shaped like a JWT: the library is not called
//   'expired'       a genuine token that has run out; the phone should refresh it and retry
//   'wrong-project' signed for some other Firebase project (audience or issuer)
//   'revoked'       the person's tokens were revoked, or the account is disabled or deleted
//                   (only checked with LOCUS_CHECK_REVOKED_TOKENS=true, see below)
//   'invalid'       anything else wrong with the token itself (bad signature, empty subject, ...)
//   'unavailable'   the server could not decide: the library would not load, Google's keys could
//                   not be fetched, or the setup is unsafe. Not the caller's fault (answer 503,
//                   not 401), and never read as "valid"
// Every failure to decide is a refusal.
//
// Revocation. Checking it makes the library ask Firebase Auth's backend about the account, which
// needs admin credentials we do not have yet (they arrive with push, Stage 4). So it is OFF by
// default and opt-in with LOCUS_CHECK_REVOKED_TOKENS=true; without credentials that then fails as
// 'unavailable'. Until then a revoked token keeps working until it expires (one hour).
//
// The library needs Node 22 or newer. It is imported on first use, so a server on an older Node
// still boots, and answers 'unavailable' to anything that needs it.

export const DEFAULT_PROJECT_ID = 'locus-5c6a8';

// A Firebase ID token is about 1 KB; this leaves generous room and refuses anything silly
// before it reaches the library.
export const MAX_TOKEN_LENGTH = 4096;
const MAX_UID_LENGTH = 128; // Firebase's own limit

// header.payload.signature, each base64url. The signature part may be empty only in the
// emulator's unsigned tokens, which the library itself rejects outside emulator mode.
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;

// How often a repeated 'unavailable' is allowed to write a log line.
const LOG_EVERY_MS = 60 * 1000;

export const identityConfig = (env = process.env) => ({
  projectId: env.LOCUS_FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID,
  checkRevoked: env.LOCUS_CHECK_REVOKED_TOKENS === 'true',
});

let appSeq = 0;

// Makes `load` run at most once at a time, and once it has worked, never again. A load that
// fails is forgotten, so the next request tries again.
export function memoizeLoader(load) {
  let pending = null;
  return () => {
    pending ??= Promise.resolve()
      .then(load)
      .catch((err) => {
        pending = null;
        throw err;
      });
    return pending;
  };
}

// The real Auth object, created on first use.
const defaultLoadAuth = (projectId) => memoizeLoader(async () => {
  const [{ initializeApp }, { getAuth }] = await Promise.all([
    import('firebase-admin/app'),
    import('firebase-admin/auth'),
  ]);
  return getAuth(initializeApp({ projectId }, `locus-identity-${++appSeq}`));
});

// What the library's error means for the caller.
function reasonFor(err) {
  const code = typeof err?.code === 'string' ? err.code : '';
  switch (code) {
    case 'auth/id-token-expired':
      return 'expired';
    case 'auth/id-token-revoked':
    case 'auth/user-disabled':
    case 'auth/user-not-found':
      return 'revoked';
    case 'auth/argument-error': {
      // One code for every defect of the token; the message says which. Audience and issuer
      // name the project the token was made for.
      const message = String(err?.message ?? '');
      return /"(aud|iss)"/.test(message) ? 'wrong-project' : 'invalid';
    }
    case 'auth/invalid-id-token':
      return 'invalid';
    default:
      // Network trouble, missing credentials, an internal error, or something unforeseen.
      return 'unavailable';
  }
}

/**
 * @param {object} [options]
 * @param {string} [options.projectId]
 * @param {boolean} [options.checkRevoked]
 * @param {() => Promise<{ verifyIdToken: Function }>} [options.loadAuth] where the library comes
 *   from; tests pass a fake
 * @param {object} [options.env]
 * @param {{ error: Function }} [options.log]
 * @param {() => number} [options.now]
 */
export function createIdTokenVerifier({
  env = process.env,
  projectId = identityConfig(env).projectId,
  checkRevoked = identityConfig(env).checkRevoked,
  loadAuth = defaultLoadAuth(projectId),
  log = console,
  now = Date.now,
} = {}) {
  let lastLoggedAt = -Infinity;
  // Says what went wrong, never with the token. At most one line a minute.
  const complain = (what) => {
    if (now() - lastLoggedAt < LOG_EVERY_MS) return;
    lastLoggedAt = now();
    log.error(`[IDENTITY] Cannot verify sign-ins right now: ${what}`);
  };

  const refuse = (reason) => ({ ok: false, reason });

  async function verifyIdToken(token) {
    try {
      if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH || !JWT_SHAPE.test(token)) {
        return refuse('malformed');
      }

      // With the emulator variable set the library accepts UNSIGNED tokens, which would let
      // anyone claim any uid. It belongs on a developer's machine and in tests; set by mistake
      // on a real server it would void this whole check, so it must be allowed on purpose.
      if (env.FIREBASE_AUTH_EMULATOR_HOST && env.LOCUS_ALLOW_AUTH_EMULATOR !== 'true') {
        complain('FIREBASE_AUTH_EMULATOR_HOST is set, which would accept unsigned tokens. Refusing every sign-in.');
        return refuse('unavailable');
      }

      const auth = await loadAuth();
      const decoded = await auth.verifyIdToken(token, checkRevoked);
      const uid = decoded?.uid;
      if (typeof uid !== 'string' || uid.length === 0 || uid.length > MAX_UID_LENGTH) return refuse('invalid');
      return { ok: true, uid };
    } catch (err) {
      const reason = reasonFor(err);
      if (reason === 'unavailable') complain(`${typeof err?.code === 'string' ? err.code : 'error'}`);
      return refuse(reason);
    }
  }

  return { verifyIdToken };
}
