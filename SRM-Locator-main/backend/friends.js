// Trusted friends, as the server needs them: who hears a person's SOS.
//
// Friendships belong to people (Firebase uids) and live in Firestore, collection `friendships`,
// written by the two people's phones (src/utils/friends.js; the rules are in
// TRUSTED_FRIENDS_RULES.md). The server only READS them, with the Firebase Admin SDK, which needs
// a service account (LOCUS_FIREBASE_SERVICE_ACCOUNT, see the rules file).
//
// An SOS is decided on the spot, so the server never waits for Firestore then: it uses what it
// already has. A person's friends are fetched when they join a Group, again when either side of a
// friendship tells the server it changed ('friends-changed'), and again in the background once
// what is held is older than FRIENDS_CACHE_TTL_MS. When nothing is known about a person (no
// credentials, Firestore unreachable, never fetched), friendsOf answers null and their SOS goes to
// everyone in the Group, as before: never to fewer people than intended.

// How long a person's friend list is used before it is fetched again in the background.
export const FRIENDS_CACHE_TTL_MS = 60 * 1000;
// The most a fetch may take; after that it counts as failed (and the old list, if any, stays).
export const FRIENDS_LOOKUP_TIMEOUT_MS = 5000;

export const FRIENDSHIPS_COLLECTION = 'friendships';

/**
 * @param {{ load: ((uid: string) => Promise<string[]>) | null, ttlMs?: number, timeoutMs?: number,
 *   now?: () => number, log?: { warn: Function } }} options
 *   load: the uids `uid` is trusted friends with (accepted friendships only); null when there is
 *   no way to know, and then nothing is ever known
 */
export function createFriendsStore({ load, ttlMs = FRIENDS_CACHE_TTL_MS, timeoutMs = FRIENDS_LOOKUP_TIMEOUT_MS, now = Date.now, log = console } = {}) {
  const known = new Map(); // uid -> { friends: Set<string>, at }
  const inflight = new Map(); // uid -> Promise

  const fetchFor = (uid) => {
    if (!load || typeof uid !== 'string' || !uid) return Promise.resolve();
    if (inflight.has(uid)) return inflight.get(uid);
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timed out')), timeoutMs); });
    const job = Promise.race([load(uid), timeout])
      .then((uids) => {
        if (Array.isArray(uids)) known.set(uid, { friends: new Set(uids.filter((u) => typeof u === 'string' && u !== uid)), at: now() });
      })
      .catch((err) => log.warn?.(`[FRIENDS] Could not read ${uid}'s friends: ${err?.message ?? err}`))
      .finally(() => {
        clearTimeout(timer);
        inflight.delete(uid);
      });
    inflight.set(uid, job);
    return job;
  };

  return {
    /** Starts a fetch unless a fresh list is held. Resolves when it is done (for tests). */
    prefetch(uid) {
      const entry = known.get(uid);
      if (entry && now() - entry.at < ttlMs) return Promise.resolve();
      return fetchFor(uid);
    },
    /** Something changed for `uid`: fetch again now. */
    refresh(uid) {
      return fetchFor(uid);
    },
    /** `uid`'s trusted friends as last fetched (a Set), or null when nothing is known. Never waits. */
    friendsOf(uid) {
      const entry = known.get(uid);
      if (!entry || now() - entry.at >= ttlMs) fetchFor(uid);
      return entry ? entry.friends : null;
    },
  };
}

/**
 * Who hears an SOS from `senderUid`: their trusted friends, and always the Group's main admin
 * (whoever holds command, and the Group's own Commander) and its moderators, so an SOS from
 * someone with no friends yet still reaches someone. Returns a Set of uids, or null for "everyone
 * in the Group": the sender has no uid (an old app), their friends are not known, or nobody would
 * be left.
 */
export function sosAudience({ senderUid, friends, adminUids = [], moderatorUids = [] }) {
  if (!senderUid || !friends) return null;
  const audience = new Set([...friends, ...adminUids, ...moderatorUids].filter((u) => typeof u === 'string' && u));
  audience.delete(senderUid);
  return audience.size > 0 ? audience : null;
}

/**
 * A Firestore loader for createFriendsStore, or null when the server has no service account.
 * LOCUS_FIREBASE_SERVICE_ACCOUNT holds the service account's JSON key (the whole file's text).
 * LOCUS_TEST_FRIENDS ({"uid": ["friendUid", ...]}) stands in for Firestore in the e2e tests; it is
 * refused when NODE_ENV is production.
 */
export function friendsLoaderFromEnv(env = process.env, log = console) {
  if (env.LOCUS_TEST_FRIENDS) {
    if (env.NODE_ENV === 'production') {
      log.error('[FRIENDS] LOCUS_TEST_FRIENDS ignored: NODE_ENV is production.');
    } else {
      const table = JSON.parse(env.LOCUS_TEST_FRIENDS);
      log.warn('[FRIENDS] LOCUS_TEST_FRIENDS stands in for Firestore. Tests only.');
      return async (uid) => table[uid] ?? [];
    }
  }
  if (!env.LOCUS_FIREBASE_SERVICE_ACCOUNT) return null;
  let firestore = null;
  const db = async () => {
    if (firestore) return firestore;
    const [{ initializeApp, cert }, { getFirestore }] = await Promise.all([
      import('firebase-admin/app'),
      import('firebase-admin/firestore'),
    ]);
    const app = initializeApp({ credential: cert(JSON.parse(env.LOCUS_FIREBASE_SERVICE_ACCOUNT)) }, 'locus-friends');
    firestore = getFirestore(app);
    return firestore;
  };
  return async (uid) => {
    // One filter only, so Firestore needs no extra index; pending requests are left out here.
    const snap = await (await db()).collection(FRIENDSHIPS_COLLECTION)
      .where('users', 'array-contains', uid)
      .get();
    return snap.docs
      .filter((d) => d.get('status') === 'accepted')
      .flatMap((d) => (d.get('users') ?? []).filter((u) => u !== uid));
  };
}

/** The line the server logs at startup about where friendships come from. */
export const friendsStartupLine = (load) => (load
  ? '[FRIENDS] Trusted friends are read from Firestore: an SOS goes to the sender\'s friends, the Group Lead and moderators.'
  : '[FRIENDS] No LOCUS_FIREBASE_SERVICE_ACCOUNT: trusted friends cannot be read, so every SOS goes to the whole Group.');
