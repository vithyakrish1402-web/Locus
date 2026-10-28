// A Leave (or sign-out) tapped while the phone was offline (a fix, 2026-10-28).
//
// socket.io used to keep the bare 'leave-squad' and send it on the next connection, which is on
// no roster, so the server removed nobody: the person stayed in the Group, and a Commander who
// left offline kept command from their stand-in for good. Now the Leave is kept here, with the
// Group's code and the sign-in proof (Firebase ID token) taken before signing out could take it
// away, and App.jsx sends it first thing on the next connection; the server applies it to that
// person (backend/server.js, leaveByUid). The token lasts an hour: a Leave kept longer than that
// can no longer be proved, and the server ignores it.

const KEY = 'locus.pendingLeave';

/** Keeps { roomCode, uid, idToken } until it can be sent. */
export function rememberLeave(entry) {
  try {
    localStorage.setItem(KEY, JSON.stringify(entry));
  } catch {
    // Storage blocked: the Leave can't outlive this moment.
  }
}

/** The Leave still to send, or null. */
export function pendingLeave() {
  try {
    const entry = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return entry && typeof entry.roomCode === 'string' && typeof entry.idToken === 'string' ? entry : null;
  } catch {
    return null;
  }
}

export function forgetLeave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing kept to forget.
  }
}
