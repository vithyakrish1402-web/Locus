// The person's agreement to share their location while LOCUS is closed, kept on this phone.
// It is tied to the exact words they agreed to (a fingerprint of the consent text in
// copy/settings.js): change any word and everyone is asked again the next time they turn it on.

import { BACKGROUND_SHARING } from '../copy/settings';

const KEY = 'locus.backgroundSharingConsent';

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

/** Has this person agreed to the words as they are now? */
export function hasConsent() {
  try {
    return localStorage.getItem(KEY) === consentFingerprint();
  } catch {
    return false;
  }
}

export function giveConsent() {
  try {
    localStorage.setItem(KEY, consentFingerprint());
  } catch {
    // Not remembered: they are asked again next time.
  }
}
