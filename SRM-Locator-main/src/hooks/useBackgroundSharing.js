import { useCallback, useEffect, useRef, useState } from 'react';
import {
  GROUP_ENDED_REASONS,
  LocusBackground,
  checkSupport,
  isTestSwitchAvailable,
  pollingMsFor,
  startBackgroundSharing,
  stopBackgroundSharing,
} from '../utils/backgroundSharing';

// Background sharing for the Group the person is in (Stage 3b Part B). See
// src/utils/backgroundSharing.js for what it does and when it does nothing at all.
//
//   const bg = useBackgroundSharing({ inGroup, roomCode, groupName, polling, backendUrl, getIdToken, onGroupEnded });
//   bg.available   whether to show the switch (only in the test build, inside a shell that has the plugin)
//   bg.on          the switch (remembered on this phone; off until someone turns it on)
//   bg.setOn(v)
//   bg.status      { state: 'off' | 'starting' | 'running' | 'refused' | 'stopped', reason? }
//
// While the switch is on and the person is in a Group (admitted, not just waiting), sharing is
// started; leaving the Group, the switch going off, or this component going away stops it. A
// swipe does neither: the WebView dies without running any cleanup, which is the point.
// `onGroupEnded` is called once, at launch, when the last sharing stopped because the Group
// ended (the server restarted): the caller shows its lobby message.

const SWITCH_KEY = 'locus.backgroundSharingTest';
const readSwitch = () => {
  try {
    return localStorage.getItem(SWITCH_KEY) === '1';
  } catch {
    return false;
  }
};
const writeSwitch = (on) => {
  try {
    localStorage.setItem(SWITCH_KEY, on ? '1' : '0');
  } catch {
    // Not remembered; the switch still works for this session.
  }
};

export function useBackgroundSharing({ inGroup, roomCode, groupName, polling, backendUrl, getIdToken, onGroupEnded, plugin = LocusBackground }) {
  const [support, setSupport] = useState(null); // null while checking
  const [on, setOnState] = useState(readSwitch);
  // What the last start attempt, or the service itself, said (cleared whenever sharing ends here).
  const [outcome, setOutcome] = useState(null);

  // Read at call time, so a changing function identity never restarts sharing.
  const latest = useRef({});
  useEffect(() => {
    latest.current = { groupName, polling, backendUrl, getIdToken, onGroupEnded };
  });

  useEffect(() => {
    if (!isTestSwitchAvailable()) return undefined;
    let alive = true;
    checkSupport(plugin).then((result) => { if (alive) setSupport(result); });
    return () => { alive = false; };
  }, [plugin]);

  const supported = Boolean(support?.supported);

  // At launch: did sharing last end because the Group did? Say so once, in the lobby.
  useEffect(() => {
    if (!supported) return undefined;
    let alive = true;
    Promise.resolve(plugin.getState?.()).then((state) => {
      if (alive && state && !state.running && GROUP_ENDED_REASONS.includes(state.reason)) latest.current.onGroupEnded?.();
    }).catch(() => {});
    return () => { alive = false; };
  }, [supported, plugin]);

  // The service tells us when it stops by itself (the pass ran out, the Group ended, the person
  // was removed ...), so the switch can say so instead of looking on.
  useEffect(() => {
    if (!supported) return undefined;
    let handle = null;
    let gone = false;
    Promise.resolve(plugin.addListener('stateChanged', (event) => {
      if (event?.state === 'stopped' && event.reason !== 'user-stop') setOutcome({ state: 'stopped', reason: event.reason });
    })).then((h) => {
      if (gone) h?.remove?.();
      else handle = h;
    }).catch(() => {});
    return () => { gone = true; handle?.remove?.(); };
  }, [supported, plugin]);

  const active = supported && on && inGroup && Boolean(roomCode);
  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    const { groupName: name, polling: rate, backendUrl: baseUrl, getIdToken: idToken } = latest.current;
    startBackgroundSharing({ baseUrl, roomCode, groupName: name || roomCode, pollingMs: pollingMsFor(rate), getIdToken: idToken, plugin }).then((result) => {
      if (!cancelled) setOutcome(result.ok ? { state: 'running' } : { state: 'refused', reason: result.reason });
    });
    return () => {
      cancelled = true;
      // Leaving the Group, switching it off, or going away: sharing ends and the token is wiped.
      stopBackgroundSharing('user-stop', plugin);
      setOutcome(null);
    };
  }, [active, roomCode, plugin]);

  const setOn = useCallback((value) => {
    writeSwitch(value);
    setOnState(value);
  }, []);

  let status = { state: 'off' };
  if (active) status = outcome ?? { state: 'starting' };
  else if (supported && on && outcome?.state === 'stopped') status = outcome;

  return { available: supported, on, setOn, status };
}
