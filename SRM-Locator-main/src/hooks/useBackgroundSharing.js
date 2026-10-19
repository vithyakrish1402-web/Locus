import { useCallback, useEffect, useRef, useState } from 'react';
import {
  APP_STOP,
  GROUP_ENDED_REASONS,
  LocusBackground,
  checkSupport,
  fetchServerStatus,
  pollingMsFor,
  startBackgroundSharing,
  stopBackgroundSharing,
} from '../utils/backgroundSharing';
import { giveConsent, hasConsent } from '../utils/backgroundConsent';

// Keeping a person on their Group's map while LOCUS is closed (Stage 3b). See
// src/utils/backgroundSharing.js for what it does and when it does nothing at all.
//
//   const bg = useBackgroundSharing({ inGroup, hidden, roomCode, groupName, polling, backendUrl, getIdToken, onGroupEnded });
//   bg.available      whether to show the switch: this phone's app can do it AND the server has it on
//   bg.on             the switch (off until the person turns it on, and only once they have agreed)
//   bg.requestChange(on)  the switch was tapped: turning on asks for consent first, if not given
//   bg.consentOpen / bg.acceptConsent() / bg.declineConsent()   the consent step
//   bg.refresh()      ask the server again whether it is on
//   bg.status         { state: 'off' | 'starting' | 'running' | 'paused' | 'refused' | 'stopped', reason? }
//   bg.serviceState  'running' | 'paused' | null: what the service last said, in a Group or not
//   bg.sosAlerts     null where this phone's app cannot raise SOS alerts while closed; otherwise
//                     { on, audible, fullScreen, setOn(enabled) }: the person's "SOS alerts when the
//                     app is closed" choice (on until they turn it off; it only does anything while
//                     sharing is on), whether the phone lets that alert ring (audible), and whether
//                     it may take over a locked screen (fullScreen). The service does the listening.
//   bg.pause() / bg.resume()   the person paused or resumed in the app: the service follows, so the
//                     notification, the app and the Group always agree (a pause from the
//                     notification reaches the app through bg.status)
//
// `hidden`: the person chose Hidden in the app. The service has no "hidden" to report (only live
// or paused, both on the map), so sharing does not run while hidden; it starts again on Live.
//
// Order when turning on, the first time: consent, then the permissions (notifications, location),
// then the device token, then the service. Any step failing means nothing starts and the status
// says why. While the switch is on and the person is in a Group (admitted, not just waiting), sharing
// runs; leaving the Group, the switch going off, or this component going away stops it. A swipe does
// neither: the WebView dies without running any cleanup, which is the point.
// `onGroupEnded` is called once, at launch, when the last sharing stopped because the Group ended
// (the server restarted): the caller shows its lobby message.

const SWITCH_KEY = 'locus.backgroundSharing';
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

export function useBackgroundSharing({ inGroup, hidden = false, roomCode, groupName, polling, backendUrl, getIdToken, onGroupEnded, plugin = LocusBackground, fetchImpl }) {
  const [support, setSupport] = useState(null); // null while checking
  const [serverStatus, setServerStatus] = useState('checking'); // 'checking' | 'available' | 'off' | 'unknown'
  const [on, setOnState] = useState(readSwitch);
  const [consented, setConsented] = useState(hasConsent);
  const [consentOpen, setConsentOpen] = useState(false);
  // What the last start attempt, or the service itself, said (cleared whenever sharing ends here).
  const [outcome, setOutcome] = useState(null);
  // "SOS alerts when the app is closed": what the shell says (null while unknown or unsupported).
  const [sosPrefs, setSosPrefs] = useState(null);

  // Read at call time, so a changing function identity never restarts sharing.
  const latest = useRef({});
  useEffect(() => {
    latest.current = { groupName, polling, backendUrl, getIdToken, onGroupEnded, fetchImpl };
  });

  useEffect(() => {
    let alive = true;
    checkSupport(plugin).then((result) => { if (alive) setSupport(result); });
    return () => { alive = false; };
  }, [plugin]);

  const supported = Boolean(support?.supported);

  // The shell's word on SOS alerts, from its capabilities (a shell that predates them says nothing).
  const readSosPrefs = useCallback((capabilities) => {
    if (!capabilities?.sosAlerts) return;
    setSosPrefs({ on: capabilities.sosAlertsOn !== false, audible: capabilities.sosAudible !== false, fullScreen: capabilities.sosFullScreen !== false });
  }, []);

  useEffect(() => {
    if (support?.supported) readSosPrefs(support.capabilities);
  }, [support, readSosPrefs]);

  const refresh = useCallback(() => {
    if (!supported) return Promise.resolve();
    const { backendUrl: baseUrl, fetchImpl: fetcher } = latest.current;
    // The phone's own notification settings can change while Settings is closed: ask again.
    Promise.resolve(plugin.getCapabilities?.()).then(readSosPrefs).catch(() => {});
    return fetchServerStatus({ baseUrl, fetchImpl: fetcher }).then((result) => setServerStatus(result));
  }, [supported, plugin, readSosPrefs]);

  const setSosOn = useCallback((enabled) => {
    setSosPrefs((previous) => (previous ? { ...previous, on: enabled } : previous));
    Promise.resolve(plugin.setSosAlerts?.({ enabled })).catch(() => {
      // The shell would not take it: show what is true.
      setSosPrefs((previous) => (previous ? { ...previous, on: !enabled } : previous));
    });
  }, [plugin]);

  // Ask the server once the app can do it, and again each time the person joins a Group (a server
  // that was asleep or has just been switched on or off is noticed then).
  useEffect(() => {
    if (!supported) return undefined;
    let alive = true;
    const { backendUrl: baseUrl, fetchImpl: fetcher } = latest.current;
    fetchServerStatus({ baseUrl, fetchImpl: fetcher }).then((result) => { if (alive) setServerStatus(result); });
    return () => { alive = false; };
  }, [supported, inGroup]);

  // At launch: did sharing last end because the Group did? Say so once, in the lobby.
  useEffect(() => {
    if (!supported) return undefined;
    let alive = true;
    Promise.resolve(plugin.getState?.()).then((state) => {
      if (!alive || !state) return undefined;
      // Opened again while the service is still sharing, paused from its notification: the app
      // starts out paused too, rather than showing Live and sending live positions over it.
      if (state.running) {
        if (state.state === 'paused') setOutcome({ state: 'paused' });
        return undefined;
      }
      if (!state.reason) return undefined;
      if (GROUP_ENDED_REASONS.includes(state.reason)) latest.current.onGroupEnded?.();
      // Shown (or not ours to show): the phone can forget why, so it is not shown again next launch.
      return plugin.acknowledgeStop?.();
    }).catch(() => {});
    return () => { alive = false; };
  }, [supported, plugin]);

  // The service tells us what it is doing, including when it stops by itself (the pass ran out,
  // the Group ended, the person was removed, the server switched it off ...).
  useEffect(() => {
    if (!supported) return undefined;
    let handle = null;
    let gone = false;
    Promise.resolve(plugin.addListener('stateChanged', (event) => {
      // Stop on the notification: the person turned sharing off, so the switch says so. (It used
      // to stay on, with the line under it still saying "Sharing".)
      if (event?.state === 'stopped' && event.reason === 'user-stop') {
        writeSwitch(false);
        setOnState(false);
        setOutcome(null);
      } else if (event?.state === 'stopped' && event.reason === APP_STOP) setOutcome(null); // the app's own: nothing to report
      else if (event?.state === 'stopped') setOutcome({ state: 'stopped', reason: event.reason });
      else if (event?.state === 'paused') setOutcome({ state: 'paused' });
      else if (event?.state === 'running') setOutcome({ state: 'running' });
    })).then((h) => {
      if (gone) h?.remove?.();
      else handle = h;
    }).catch(() => {});
    return () => { gone = true; handle?.remove?.(); };
  }, [supported, plugin]);

  const available = supported && serverStatus === 'available';
  const effectiveOn = on && consented;
  const active = available && effectiveOn && inGroup && !hidden && Boolean(roomCode);

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    const { groupName: name, polling: rate, backendUrl: baseUrl, getIdToken: idToken, fetchImpl: fetcher } = latest.current;
    startBackgroundSharing({ baseUrl, roomCode, groupName: name || roomCode, pollingMs: pollingMsFor(rate), getIdToken: idToken, plugin, fetchImpl: fetcher, stillWanted: () => !cancelled }).then((result) => {
      if (cancelled) return;
      // 'running' may already have been said by the service itself: a refusal is the only news here.
      setOutcome((previous) => (result.ok ? (previous?.state === 'paused' ? previous : { state: 'running' }) : { state: 'refused', reason: result.reason }));
    });
    return () => {
      cancelled = true;
      // Leaving the Group, switching it off, or going away: sharing ends and the token is wiped.
      stopBackgroundSharing(APP_STOP, plugin);
      setOutcome(null);
    };
  }, [active, roomCode, plugin]);

  const requestChange = useCallback((value) => {
    if (!value) {
      writeSwitch(false);
      setOnState(false);
      return;
    }
    if (consented) {
      writeSwitch(true);
      setOnState(true);
    } else {
      setConsentOpen(true);
    }
  }, [consented]);

  const acceptConsent = useCallback(() => {
    giveConsent();
    setConsented(true);
    setConsentOpen(false);
    writeSwitch(true);
    setOnState(true);
  }, []);

  const declineConsent = useCallback(() => setConsentOpen(false), []);

  // Until resumed, like the app's own Paused. The service answers with its new state (stateChanged),
  // which is what bg.status then says: nothing is assumed here. A service that is not running yet
  // ignores it, and the app pauses it once it says it is running (see App.jsx).
  const pause = useCallback(() => {
    if (!active) return;
    Promise.resolve(plugin.pause?.({ minutes: 0 })).catch(() => {});
  }, [active, plugin]);

  const resume = useCallback(() => {
    if (!active) return;
    Promise.resolve(plugin.resume?.()).catch(() => {});
  }, [active, plugin]);

  let status = { state: 'off' };
  if (active) status = outcome ?? { state: 'starting' };
  else if (available && effectiveOn && outcome?.state === 'stopped') status = outcome;

  // What the service last said, whether or not this screen is in a Group yet: opened again while it
  // is paused, the app must be paused before it joins, or its first report would be a live one.
  const serviceState = outcome?.state === 'paused' || outcome?.state === 'running' ? outcome.state : null;

  const sosAlerts = sosPrefs ? { ...sosPrefs, setOn: setSosOn } : null;

  return { available, on: effectiveOn, status, serviceState, sosAlerts, consentOpen, requestChange, acceptConsent, declineConsent, refresh, pause, resume };
}
