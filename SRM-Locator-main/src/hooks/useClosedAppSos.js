import { useCallback, useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { LocusBackground } from '../utils/backgroundSharing';

// SOS from the Group while LOCUS was closed: the app's half of it. The Android sharing service
// listens for the alert and raises the notification (android/.../sharing/SosListener.java); this
// is how that hands over to the SOS overlay the app already has. No new screen.
//
//   const { current, pendingCount, receive, acknowledge } = useIncomingSos(socket);
//   const ack = useClosedAppSos({ current, pendingCount, receive, acknowledge });
//
//  - The person taps the notification (or the full-screen alert on a locked phone): the plugin sends
//    "sosOpened", with the alert, and it is queued like any beacon that came over the socket. A tap
//    that starts the app from cold is held by the plugin until this listens, so it is not lost.
//    When the same beacon then arrives over the socket (the app rejoining its Group) it is the same
//    id, so it is held once.
//  - Whenever an alert is on screen, the plugin is told ("sosShown") and takes that alert's
//    notification down: the person never has both the overlay and a system notification for the
//    same SOS, and never neither.
//  - Acknowledging also tells the server through the plugin ("acknowledgeSos"): the app's socket may
//    not be in the Group yet after a cold start from the notification, and the socket's own
//    acknowledgement would then reach nobody. It also tells the phone whether another alert is
//    waiting ("more"): an alert shown over a locked screen hands the phone back to the lock
//    screen once the last one is acknowledged, so the rest of the app is not open to whoever
//    picked the phone up.
//
// A phone whose app has none of this (an older shell) just never gets the events; every call is
// guarded and swallowed. Tests pass their own plugin.

const present = (plugin) => {
  try {
    return plugin === LocusBackground ? Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('LocusBackground') : Boolean(plugin);
  } catch {
    return false;
  }
};

const quietly = (call) => {
  try {
    Promise.resolve(call()).catch(() => {});
  } catch {
    // An older shell without the method: nothing to tell.
  }
};

/**
 * @param {{ current: { id: string } | null, pendingCount?: number, receive: (payload: object) => void, acknowledge: () => void, plugin?: object }} args
 * @returns {() => void} the acknowledge to give the overlay
 */
export function useClosedAppSos({ current, pendingCount = 0, receive, acknowledge, plugin = LocusBackground }) {
  const latest = useRef({ current, pendingCount, acknowledge });
  useEffect(() => {
    latest.current = { current, pendingCount, acknowledge };
  });

  useEffect(() => {
    if (!present(plugin) || typeof plugin.addListener !== 'function') return undefined;
    let handle = null;
    let gone = false;
    try {
      Promise.resolve(plugin.addListener('sosOpened', (event) => {
        if (event && typeof event.id === 'string' && event.id) receive(event);
      })).then((h) => {
        if (gone) h?.remove?.();
        else handle = h;
      }).catch(() => {});
    } catch {
      // not available in this shell
    }
    return () => { gone = true; handle?.remove?.(); };
  }, [plugin, receive]);

  const shownId = current?.id ?? null;
  useEffect(() => {
    if (shownId && present(plugin) && typeof plugin.sosShown === 'function') quietly(() => plugin.sosShown({ id: shownId }));
  }, [shownId, plugin]);

  return useCallback(() => {
    const { current: head, pendingCount: waiting } = latest.current;
    const id = head?.id;
    latest.current.acknowledge();
    if (id && present(plugin) && typeof plugin.acknowledgeSos === 'function') quietly(() => plugin.acknowledgeSos({ id, more: waiting > 0 }));
  }, [plugin]);
}
