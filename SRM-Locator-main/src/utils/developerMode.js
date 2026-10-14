// Developer mode: who may have it, and when it is on. Admin accounts only, and it fails
// closed: while the sign-in is loading, while the phone is offline, for a signed-out user, for
// and anyone but the admin account. The app signs in with email and password only, and those
// accounts are never email-verified, so verification is not part of the rule. The admin address
// is a registered account, so nobody else can sign up under it.
// The check is only for what is shown. Developer mode never writes to the server.

/** 'unknown' hides it without forgetting the setting; 'denied' hides it and switches it off. */
export function developerStatus({ authLoading, user, online, adminEmail }) {
  if (authLoading || !online) return 'unknown';
  if (user && user.email === adminEmail) return 'admin';
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
