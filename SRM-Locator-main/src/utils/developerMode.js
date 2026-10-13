// Developer mode: who may have it, and when it is on. Admin accounts only, and it fails
// closed: while the sign-in is loading, while the phone is offline, for a signed-out user, for
// anyone but the admin account, and for an admin address that has not been verified (Google
// sign-in verifies it; an email and password account that was never verified does not count).
// The check is only for what is shown. Developer mode never writes to the server.

/** 'unknown' hides it without forgetting the setting; 'denied' hides it and switches it off. */
export function developerStatus({ authLoading, user, online, adminEmail }) {
  if (authLoading || !online) return 'unknown';
  if (user && user.email === adminEmail && user.emailVerified === true) return 'admin';
  return 'denied';
}

export const DEVELOPER_STORAGE_KEY = 'locus.developerMode';

const storage = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

/** The uid the setting was turned on for, or null. */
export function readDeveloperUid() {
  try {
    return storage()?.getItem(DEVELOPER_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function writeDeveloperUid(uid) {
  try {
    if (uid) storage()?.setItem(DEVELOPER_STORAGE_KEY, uid);
    else storage()?.removeItem(DEVELOPER_STORAGE_KEY);
  } catch { /* a private window: it simply is not remembered */ }
}
