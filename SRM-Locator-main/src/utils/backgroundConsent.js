// The person's agreement to share their location while LOCUS is closed, kept on this phone.
// It is tied to the exact words they agreed to (a fingerprint of the consent text in
// copy/settings.js): change any word and everyone is asked again the next time they turn it on.
//
// And to the account that agreed (its Firebase uid). It used to be one per phone, so the next
// account to sign in on the phone shared its location from the background without ever having
// seen the words (a fix, 2026-10-28). An agreement from before that belongs to nobody: everyone
// is asked once more.

import { BACKGROUND_SHARING } from '../copy/settings';

const KEY = 'locus.backgroundSharingConsent';
const keyFor = (uid) => `${KEY}:${uid}`;

/** A short fingerprint (FNV-1a) of the words the person is shown. */
export function consentFingerprint(consent = BACKGROUND_SHARING.consent) {
  const text = [consent.title, consent.body, consent.accept, consent.decline].join('\u0001');
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** Has the account `uid` agreed to the words as they are now? Nobody signed in never has. */
export function hasConsent(uid) {
  if (!uid) return false;
  try {
    return localStorage.getItem(keyFor(uid)) === consentFingerprint();
  } catch {
    return false;
  }
}

export function giveConsent(uid) {
  if (!uid) return;
  try {
    localStorage.setItem(keyFor(uid), consentFingerprint());
  } catch {
    // Not remembered: they are asked again next time.
  }
}
