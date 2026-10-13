import { useCallback, useEffect, useState } from 'react';
import { DEVELOPER_STORAGE_KEY, developerStatus, readDeveloperUid, writeDeveloperUid } from '../utils/developerMode.js';

/** True while the phone has a network connection (approximate: the browser's own word for it). */
export function useOnline() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}

/**
 * Whether Developer mode is on. It is remembered per account on this phone and is shown only
 * while `status` is 'admin' (see developerStatus). 'denied' (signed out, another account, no
 * longer admin) switches it off and forgets it; 'unknown' (loading, offline) only hides it.
 * @param {{ authLoading: boolean, user: object|null, adminEmail: string, enabled: boolean }} options
 *   enabled: false in every build but the test build
 * @returns {{ status: 'unknown'|'admin'|'denied', on: boolean, setOn: (on: boolean) => void }}
 */
export function useDeveloperMode({ authLoading, user, adminEmail, enabled }) {
  const online = useOnline();
  const status = enabled ? developerStatus({ authLoading, user, online, adminEmail }) : 'denied';
  const uid = user?.uid ?? null;
  const [onFor, setOnFor] = useState(() => (enabled ? readDeveloperUid() : null));
  // Switching off by derivation while rendering: no extra render with the old value showing.
  if (status === 'denied' && onFor !== null) setOnFor(null);
  useEffect(() => {
    if (status === 'denied') writeDeveloperUid(null);
  }, [status]);
  const on = enabled && status === 'admin' && uid !== null && onFor === uid;
  const setOn = useCallback((value) => {
    if (!enabled || status !== 'admin' || !uid) return;
    writeDeveloperUid(value ? uid : null);
    setOnFor(value ? uid : null);
  }, [enabled, status, uid]);
  return { status, on, setOn };
}

export { DEVELOPER_STORAGE_KEY };
