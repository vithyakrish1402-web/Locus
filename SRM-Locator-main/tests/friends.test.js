import { describe, it, expect, vi } from 'vitest';
import { createFriendsStore, sosAudience, friendsLoaderFromEnv, FRIENDS_CACHE_TTL_MS } from '../backend/friends.js';

// Trusted friends on the server (backend/friends.js): who hears an SOS, and never waiting on
// Firestore while one is raised.
const quiet = { warn: () => {}, error: () => {} };

describe('sosAudience', () => {
  it("is the sender's friends, the main admin and the moderators, never the sender", () => {
    const audience = sosAudience({ senderUid: 'uB', friends: new Set(['uC']), adminUids: ['uA', 'uA'], moderatorUids: ['uM', 'uB'] });
    expect([...audience].sort()).toEqual(['uA', 'uC', 'uM']);
  });

  it('still reaches the admin and moderators when the sender has no friends', () => {
    expect([...sosAudience({ senderUid: 'uB', friends: new Set(), adminUids: ['uA'] })]).toEqual(['uA']);
  });

  it('is everyone when nobody would be left, the friends are not known, or the sender has no uid', () => {
    expect(sosAudience({ senderUid: 'uA', friends: new Set(), adminUids: ['uA', null] })).toBeNull();
    expect(sosAudience({ senderUid: 'uB', friends: null, adminUids: ['uA'] })).toBeNull();
    expect(sosAudience({ senderUid: null, friends: new Set(['uC']), adminUids: ['uA'] })).toBeNull();
  });
});

describe('createFriendsStore', () => {
  it('knows nothing until fetched, then answers at once without waiting', async () => {
    const load = vi.fn(async () => ['uC', 'uB']);
    const store = createFriendsStore({ load, log: quiet });
    expect(store.friendsOf('uB')).toBeNull(); // starts a fetch, does not wait for it
    await store.prefetch('uB');
    expect([...store.friendsOf('uB')]).toEqual(['uC']); // never your own friend
    await store.prefetch('uB'); // still fresh: not read again
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('fetches again in the background once what it holds is old, still answering with it meanwhile', async () => {
    let now = 0;
    let answer = ['uC'];
    const load = vi.fn(async () => answer);
    const store = createFriendsStore({ load, now: () => now, log: quiet });
    await store.prefetch('uB');
    answer = ['uD'];
    now += FRIENDS_CACHE_TTL_MS;
    expect([...store.friendsOf('uB')]).toEqual(['uC']);
    await store.prefetch('uB');
    expect([...store.friendsOf('uB')]).toEqual(['uD']);
  });

  it('keeps what it had when a fetch fails or takes too long', async () => {
    let fail = false;
    const load = vi.fn(async () => {
      if (fail) throw new Error('offline');
      return ['uC'];
    });
    const store = createFriendsStore({ load, log: quiet });
    await store.refresh('uB');
    fail = true;
    await store.refresh('uB');
    expect([...store.friendsOf('uB')]).toEqual(['uC']);

    const slow = createFriendsStore({ load: () => new Promise(() => {}), timeoutMs: 10, log: quiet });
    await slow.refresh('uB');
    expect(slow.friendsOf('uB')).toBeNull();
  });

  it('knows nothing, ever, with no way to load', async () => {
    const store = createFriendsStore({ load: null, log: quiet });
    await store.prefetch('uB');
    expect(store.friendsOf('uB')).toBeNull();
  });
});

describe('friendsLoaderFromEnv', () => {
  it('has no loader without a service account', () => {
    expect(friendsLoaderFromEnv({}, quiet)).toBeNull();
  });

  it('refuses the test table in production', () => {
    expect(friendsLoaderFromEnv({ NODE_ENV: 'production', LOCUS_TEST_FRIENDS: '{"uB":["uC"]}' }, quiet)).toBeNull();
  });

  it('reads the test table otherwise', async () => {
    const load = friendsLoaderFromEnv({ LOCUS_TEST_FRIENDS: '{"uB":["uC"]}' }, quiet);
    expect(await load('uB')).toEqual(['uC']);
    expect(await load('uX')).toEqual([]);
  });
});
