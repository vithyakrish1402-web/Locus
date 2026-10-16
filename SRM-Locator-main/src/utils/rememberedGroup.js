// The Group this phone was last let into, so that opening LOCUS again (after a swipe, or from
// the sharing notification) can offer to go back to it instead of starting at "Create a group"
// with a new code. Nothing here joins anything: the app shows "Return to <Group>" or "Start
// fresh" and the person chooses.
//
// Kept from the moment the server lets the person in (access-granted) until they are no longer in
// that Group by anyone's choice: they leave, sign out, are removed or blocked, are turned down, or
// the server says the Group is gone. A disconnect, a swipe or the phone killing the app is none of
// those, so it stays.
//
// Per person: another account signing in on the same phone is never offered someone else's Group.

export const REMEMBERED_GROUP_KEY = 'locus.group';

const CODE_SHAPE = /^[A-Z0-9]{1,64}$/;
const ROLES = ['OWNER', 'MEMBER'];

const storage = () => {
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
};

/** Remembers the Group `uid` is in now. Does nothing without a code and a uid. */
export function rememberGroup({ code, role, uid }) {
  const clean = typeof code === 'string' ? code.trim().toUpperCase() : '';
  if (!CODE_SHAPE.test(clean) || typeof uid !== 'string' || !uid) return;
  try {
    storage()?.setItem(REMEMBERED_GROUP_KEY, JSON.stringify({ code: clean, role: ROLES.includes(role) ? role : 'MEMBER', uid }));
  } catch {
    // Not saved (blocked storage): opening the app again starts at the lobby, as it always did.
  }
}

/** `uid`'s remembered Group, { code, role }, or null (none, someone else's, or unreadable). */
export function rememberedGroup(uid) {
  if (typeof uid !== 'string' || !uid) return null;
  try {
    const raw = storage()?.getItem(REMEMBERED_GROUP_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (entry?.uid !== uid || !CODE_SHAPE.test(entry?.code ?? '')) return null;
    return { code: entry.code, role: ROLES.includes(entry.role) ? entry.role : 'MEMBER' };
  } catch {
    return null;
  }
}

export function forgetGroup() {
  try {
    storage()?.removeItem(REMEMBERED_GROUP_KEY);
  } catch {
    // Nothing stored, or storage blocked: nothing to forget.
  }
}
