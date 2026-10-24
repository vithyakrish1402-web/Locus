// Trusted friends, on this phone: friend requests, accepting, declining and removing, written to
// Firestore (collection `friendships`). Only the two people in a friendship can read or change it:
// the rules are in TRUSTED_FRIENDS_RULES.md (published by hand in the Firebase console). The
// server reads accepted friendships to decide who hears an SOS (backend/friends.js).
//
// One document per pair, its id the two uids sorted and joined with '_', so a pair can never have
// two. Fields: users [uidA, uidB] (sorted), requester (who asked), status 'pending' | 'accepted',
// names { uid: name } (so a request says who it is from), createdAt, acceptedAt.
// Declining, cancelling and removing all delete the document.

import { collection, deleteDoc, doc, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import { db } from '../firebase.js';

export const FRIENDSHIPS_COLLECTION = 'friendships';

/** The document id for the pair `a`, `b`. */
export const friendshipId = (a, b) => [a, b].sort().join('_');

/**
 * What `uid`'s friendships mean for them: who their trusted friends are, the requests waiting for
 * them to answer, and the ones they have sent.
 * @returns {{ friends: Set<string>, incoming: Array<{id: string, uid: string, name: string|null}>, outgoing: Set<string> }}
 */
export function summarizeFriendships(uid, docs) {
  const friends = new Set();
  const incoming = [];
  const outgoing = new Set();
  for (const d of docs) {
    const other = (d.users ?? []).find((u) => u !== uid);
    if (!other) continue;
    if (d.status === 'accepted') friends.add(other);
    else if (d.status === 'pending' && d.requester === uid) outgoing.add(other);
    else if (d.status === 'pending') incoming.push({ id: d.id, uid: other, name: d.names?.[other] ?? null });
  }
  return { friends, incoming, outgoing };
}

export const NO_FRIENDSHIPS = Object.freeze({ friends: new Set(), incoming: [], outgoing: new Set() });

/**
 * Follows `uid`'s friendships; `onChange` gets each new summary. Anything Firestore refuses (no
 * network yet, the rules not published) reads as no friendships, never as a crash.
 * @returns {() => void} stop
 */
export function watchFriendships(uid, onChange) {
  try {
    const q = query(collection(db, FRIENDSHIPS_COLLECTION), where('users', 'array-contains', uid));
    return onSnapshot(
      q,
      (snap) => onChange(summarizeFriendships(uid, snap.docs.map((d) => ({ id: d.id, ...d.data() })))),
      () => onChange(NO_FRIENDSHIPS),
    );
  } catch {
    onChange(NO_FRIENDSHIPS);
    return () => {};
  }
}

/** `me` ({uid, name}) asks `other` ({uid, name}) to be trusted friends. */
export function sendFriendRequest(me, other) {
  const users = [me.uid, other.uid].sort();
  return setDoc(doc(db, FRIENDSHIPS_COLLECTION, friendshipId(me.uid, other.uid)), {
    users,
    requester: me.uid,
    status: 'pending',
    names: { [me.uid]: me.name ?? null, [other.uid]: other.name ?? null },
    createdAt: serverTimestamp(),
  });
}

/** The person asked accepts. */
export function acceptFriendRequest(me, otherUid) {
  return updateDoc(doc(db, FRIENDSHIPS_COLLECTION, friendshipId(me.uid, otherUid)), {
    status: 'accepted',
    acceptedAt: serverTimestamp(),
  });
}

/** Declines a request, cancels one sent, or ends a friendship. */
export function removeFriendship(me, otherUid) {
  return deleteDoc(doc(db, FRIENDSHIPS_COLLECTION, friendshipId(me.uid, otherUid)));
}
