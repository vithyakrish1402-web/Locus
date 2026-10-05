import { AUTH_PROBLEMS } from '../copy/access';

// Firebase Auth's error codes, as the sentence the sign-in and create-account screens show
// (in an amber card). Codes Firebase has used for "wrong email or password" over the years
// all read the same; anything unknown gets the general sentence, never Firebase's own
// English, which was shown raw before ("[SYS_FAILURE] Firebase: Error (auth/...)").
const BY_CODE = {
  'auth/invalid-credential': AUTH_PROBLEMS.wrongCredentials,
  'auth/wrong-password': AUTH_PROBLEMS.wrongCredentials,
  'auth/invalid-login-credentials': AUTH_PROBLEMS.wrongCredentials,
  'auth/user-not-found': AUTH_PROBLEMS.noAccount,
  'auth/invalid-email': AUTH_PROBLEMS.badEmail,
  'auth/missing-email': AUTH_PROBLEMS.missingEmailForReset,
  'auth/email-already-in-use': AUTH_PROBLEMS.emailInUse,
  'auth/weak-password': AUTH_PROBLEMS.weakPassword,
  'auth/too-many-requests': AUTH_PROBLEMS.tooManyTries,
  'auth/network-request-failed': AUTH_PROBLEMS.offline,
};

/**
 * @param {{ code?: string }|undefined|null} error a Firebase Auth error
 * @param {'sign-in'|'create'|'reset'} [action] the reset flow says "no account" for an
 *   unknown email; signing in says the pair doesn't match (it never confirms which half).
 * @returns {string}
 */
export function authProblem(error, action = 'sign-in') {
  const code = error?.code;
  if (action === 'sign-in' && code === 'auth/user-not-found') return AUTH_PROBLEMS.wrongCredentials;
  return BY_CODE[code] ?? AUTH_PROBLEMS.unknown;
}
