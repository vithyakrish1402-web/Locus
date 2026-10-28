// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { consentFingerprint, giveConsent, hasConsent } from '../src/utils/backgroundConsent.js';
import { BACKGROUND_SHARING } from '../src/copy/settings.js';

beforeEach(() => localStorage.clear());

describe('the consent to share when LOCUS is closed', () => {
  it('is not given until the person gives it', () => {
    expect(hasConsent('uA')).toBe(false);
  });

  it('is remembered once given', () => {
    giveConsent('uA');
    expect(hasConsent('uA')).toBe(true);
  });

  it('is the account\'s own: another account signed in on the same phone has not given it', () => {
    giveConsent('uA');
    expect(hasConsent('uB')).toBe(false);
  });

  it('is never anyone\'s while nobody is signed in, nor one stored before it was per account', () => {
    giveConsent(undefined);
    expect(hasConsent(undefined)).toBe(false);
    localStorage.setItem('locus.backgroundSharingConsent', consentFingerprint());
    expect(hasConsent('uA')).toBe(false);
  });

  it('is asked again if any word of what they agreed to changes', () => {
    giveConsent('uA');
    for (const field of ['title', 'body', 'accept', 'decline']) {
      const changed = { ...BACKGROUND_SHARING.consent, [field]: BACKGROUND_SHARING.consent[field] + ' ' };
      expect(consentFingerprint(changed), field).not.toBe(consentFingerprint());
    }
    localStorage.setItem('locus.backgroundSharingConsent:uA', consentFingerprint({ ...BACKGROUND_SHARING.consent, body: 'older words' }));
    expect(hasConsent('uA')).toBe(false);
  });

  it('is not given by an empty or unrelated stored value', () => {
    for (const value of ['', '1', 'true', 'undefined']) {
      localStorage.setItem('locus.backgroundSharingConsent:uA', value);
      expect(hasConsent('uA'), value).toBe(false);
    }
  });

  it('says what the approved words say (Group, Group Lead never "squad"), and mentions the key promises', () => {
    const { title, body, accept, decline } = BACKGROUND_SHARING.consent;
    expect(title).toBe('Share your location when LOCUS is closed?');
    expect([accept, decline]).toEqual(['Turn on', 'Not now']);
    for (const promise of ['live location', 'members of your current Group', 'even when the app is closed', 'notification stays visible', 'only to your Group', 'ends when you leave the Group', 'You can pause it from the notification, or stop it at any time from the notification or from Settings.', 'battery']) {
      expect(body, promise).toContain(promise);
    }
    expect(body + title).not.toMatch(/squad|log ?out/i);
  });

  it('does not throw when storage is unavailable', () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => { throw new Error('blocked'); };
    try {
      expect(hasConsent()).toBe(false);
    } finally {
      Storage.prototype.getItem = original;
    }
  });
});
