import { useCallback, useEffect, useState } from 'react';
import {
  NO_FRIENDSHIPS, acceptFriendRequest, removeFriendship, sendFriendRequest, watchFriendships,
} from '../utils/friends';

/**
 * This person's trusted friends (utils/friends.js), followed live while signed in, and the actions
 * on them. Each action tells the server afterwards ('friends-changed'), so who hears an SOS
 * follows at once. Actions resolve true, or false when Firestore refused (no network, the rules).
 * @param {{uid: string, displayName?: string}|null} user
 * @param {{ emit: Function }} socket
 */
export function useFriends(user, socket) {
  const uid = user?.uid ?? null;
  const [state, setState] = useState(NO_FRIENDSHIPS);

  useEffect(() => {
    if (!uid) {
      setState(NO_FRIENDSHIPS);
      return undefined;
    }
    return watchFriendships(uid, setState);
  }, [uid]);

  const run = useCallback(async (change, otherUid) => {
    try {
      await change();
      socket.emit('friends-changed', { uid: otherUid });
      return true;
    } catch {
      return false;
    }
  }, [socket]);

  const me = uid ? { uid, name: user?.displayName ?? null } : null;
  return {
    ...state,
    /** 'friends' | 'asked' (they asked you) | 'sent' (you asked) | 'none' */
    statusOf: (otherUid) => (state.friends.has(otherUid) ? 'friends'
      : state.incoming.some((r) => r.uid === otherUid) ? 'asked'
        : state.outgoing.has(otherUid) ? 'sent' : 'none'),
    ask: (other) => run(() => sendFriendRequest(me, { uid: other.uid, name: other.name ?? null }), other.uid),
    accept: (otherUid) => run(() => acceptFriendRequest(me, otherUid), otherUid),
    remove: (otherUid) => run(() => removeFriendship(me, otherUid), otherUid),
  };
}
