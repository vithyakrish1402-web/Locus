// The app's side of background sharing (Stage 3b Part B): keep showing the person to their
// Group after the app is swiped away or the screen is off.
//
// The native half is the LocusBackground plugin (android/.../sharing/LocusBackgroundPlugin.java,
// contract in its header comment). This file is the JavaScript bridge to it and the one place
// that talks to the server's /api/background/token endpoint:
//
//   1. the app asks the server for a *device token* with the person's Firebase ID token
//      (the plugin never sees an ID token or a Firebase refresh token);
//   2. it hands the device token to the plugin, which reports positions on its own.
//
// Everything is guarded. Nothing here runs unless the app is running inside the Android shell,
// the plugin is present in that shell, and the plugin reports the contract version this file was
// written for. A shell that predates the plugin (or is newer than this file understands) simply
// never shows the switch and never calls the plugin. The server has its own say: see
// fetchServerStatus.
//
// The plugin is registered here; tests replace it by passing their own to every function.

import { registerPlugin, Capacitor } from '@capacitor/core';

/** The plugin contract this file speaks. getCapabilities().version must equal it exactly. */
export const SUPPORTED_PLUGIN_VERSION = 1;

const unavailable = () => Promise.reject(Object.assign(new Error('Background sharing is only available in the Android app'), { code: 'UNAVAILABLE' }));

export const LocusBackground = /*#__PURE__*/ registerPlugin('LocusBackground', {
  web: {
    getCapabilities: unavailable,
    getState: unavailable,
    start: unavailable,
    updateToken: unavailable,
    pause: unavailable,
    resume: unavailable,
    stop: () => Promise.resolve(),
    requestPermissions: unavailable,
    setSosAlerts: unavailable,
    sosShown: () => Promise.resolve(),
    acknowledgeSos: () => Promise.resolve(),
    addListener: () => Promise.resolve({ remove: () => {} }),
  },
});

/** The settings-screen refresh rate, as the plugin's reporting interval (the same numbers App.jsx uses). */
export function pollingMsFor(polling) {
  if (polling === 'eco') return 15000;
  if (polling === 'max') return 1000;
  return 5000;
}

/**
 * Whether background sharing can be used here at all.
 * @returns {Promise<{ supported: true, capabilities: object } | { supported: false, reason: string, version?: number }>}
 */
export async function checkSupport(plugin = LocusBackground) {
  try {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return { supported: false, reason: 'not-android' };
    if (!Capacitor.isPluginAvailable('LocusBackground')) return { supported: false, reason: 'no-plugin' };
    if (typeof plugin?.getCapabilities !== 'function') return { supported: false, reason: 'no-plugin' };
    const capabilities = await plugin.getCapabilities();
    if (capabilities?.version !== SUPPORTED_PLUGIN_VERSION) {
      return { supported: false, reason: 'plugin-version', version: capabilities?.version };
    }
    return { supported: true, capabilities };
  } catch {
    return { supported: false, reason: 'plugin-error' };
  }
}

/**
 * Does the server have background sharing switched on? One tiny question with no sign-in
 * (GET /api/background/status, which answers even when the feature is off).
 *
 * Fails closed: 'available' only on a clear yes. 'off' for a clear no (including the 503
 * "disabled" an older server gives everywhere). 'unknown' for anything else (no answer, a server
 * without the route): the caller leaves the switch out until it can ask again.
 *
 * @returns {Promise<'available' | 'off' | 'unknown'>}
 */
export async function fetchServerStatus({ baseUrl, fetchImpl = fetch, timeoutMs = 10000 }) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(`${baseUrl}/api/background/status`, { method: 'GET', signal: controller.signal, redirect: 'error', cache: 'no-store' });
    } finally {
      clearTimeout(timer);
    }
    const body = await parse(response);
    if (response.status === 200 && body.available === true) return 'available';
    if (response.status === 200 && body.available === false) return 'off';
    if (response.status === 503 && body.error === 'disabled') return 'off';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

const parse = async (response) => {
  try {
    return await response.json();
  } catch {
    return {};
  }
};

/**
 * Asks the server for a device token for `roomCode`, proving who the person is with their
 * Firebase ID token. Each token ends the one before it (the server keeps one session per person
 * and Group), so call this only when sharing is about to start or renew.
 *
 * @returns {Promise<{ ok: true, token: string, expiresAt: number } | { ok: false, reason: string }>}
 *   reason: server-off (the server has background sharing switched off), no-group, blocked,
 *   not-member, not-signed-in, busy, network, server-error
 */
export async function mintDeviceToken({ baseUrl, roomCode, idToken, fetchImpl = fetch, timeoutMs = 20000 }) {
  let response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      response = await fetchImpl(`${baseUrl}/api/background/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ roomCode }),
        signal: controller.signal,
        redirect: 'error',
      });
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return { ok: false, reason: 'network' };
  }
  const body = await parse(response);
  if (response.status === 200) {
    if (typeof body.token !== 'string' || !body.token || !Number.isFinite(body.expiresAt) || body.expiresAt <= Date.now()) {
      return { ok: false, reason: 'server-error' };
    }
    return { ok: true, token: body.token, expiresAt: body.expiresAt };
  }
  if (response.status === 503) return { ok: false, reason: body.error === 'disabled' ? 'server-off' : 'server-error' };
  if (response.status === 404) return { ok: false, reason: 'no-group' };
  if (response.status === 403) return { ok: false, reason: body.error === 'blocked' ? 'blocked' : 'not-member' };
  if (response.status === 401) return { ok: false, reason: 'not-signed-in' };
  if (response.status === 429) return { ok: false, reason: 'busy' };
  return { ok: false, reason: 'server-error' };
}

/**
 * Starts (or restarts) background sharing for the Group the person is in.
 *
 * @param {{ baseUrl: string, roomCode: string, groupName: string, pollingMs: number,
 *   getIdToken: () => Promise<string>, plugin?: object, fetchImpl?: typeof fetch,
 *   now?: () => number, sleep?: (ms: number) => Promise<void>, stillWanted?: () => boolean }} options
 *   stillWanted: asked last thing before the service starts; false (the person left, switched it
 *   off, went Hidden while the token was fetched or a stop finished) and nothing starts.
 * @returns {Promise<{ ok: true } | { ok: false, reason: string }>} reason is one of mintDeviceToken's,
 *   or: unsupported, permission-denied, notifications-denied, location-denied, cannot-start, not-signed-in,
 *   no-longer-wanted
 */
export async function startBackgroundSharing({ baseUrl, roomCode, groupName, pollingMs, getIdToken, plugin = LocusBackground, fetchImpl, now = Date.now, sleep = defaultSleep, stillWanted = () => true }) {
  const support = await checkSupport(plugin);
  if (!support.supported) return { ok: false, reason: 'unsupported' };

  // Permissions first: a token minted for a start that then fails would end the session of
  // anything already running, for nothing. The plugin never prompts by itself.
  let capabilities = support.capabilities;
  if (!capabilities.locationGranted || !capabilities.notificationsEnabled) {
    try {
      await plugin.requestPermissions({ permissions: ['location', 'notifications'] });
      capabilities = await plugin.getCapabilities();
    } catch {
      return { ok: false, reason: 'permission-denied' };
    }
    if (!capabilities.locationGranted) return { ok: false, reason: 'location-denied' };
    if (!capabilities.notificationsEnabled) return { ok: false, reason: 'notifications-denied' };
  }

  let idToken;
  try {
    idToken = await getIdToken();
  } catch {
    return { ok: false, reason: 'not-signed-in' };
  }
  if (!idToken) return { ok: false, reason: 'not-signed-in' };

  const minted = await mintDeviceToken({ baseUrl, roomCode, idToken, fetchImpl });
  if (!minted.ok) return minted;

  // Never moved silently from one Group to another. A start for a new Group used to swap the
  // running service over to it (a pause included), and the old Group's pass was never ended: its
  // members saw "signal lost" minutes later. Sharing for any other Group is ended first.
  const previous = sharedRoom();
  if (previous && previous !== roomCode) await stopBackgroundSharing(APP_STOP, plugin);
  // A stop finishes on the phone only after it has told the server, and the service ending then
  // takes a start that came in meanwhile down with it, silently. Give a recent stop time to finish.
  const settle = STOP_SETTLE_MS - (now() - lastStopAt);
  if (settle > 0) await sleep(settle);
  // All of the above takes time. Sharing for a Group the person has left in the meantime would
  // carry on after leaving, with nothing left on screen to stop it.
  if (!stillWanted()) return { ok: false, reason: 'no-longer-wanted' };

  try {
    const result = await plugin.start({ baseUrl, roomCode, groupName, deviceToken: minted.token, expiresAt: minted.expiresAt, pollingMs });
    if (result?.started) {
      rememberSharedRoom(roomCode);
      return { ok: true };
    }
    return { ok: false, reason: typeof result?.state === 'string' ? result.state : 'cannot-start' };
  } catch {
    return { ok: false, reason: 'cannot-start' };
  }
}

/**
 * The stop reason for every stop the app makes itself (leaving, signing out, the switch, Start
 * fresh, moving to another Group). The notification's own Stop button says "user-stop", which is
 * how the app tells the person's Stop (the switch goes off) from its own.
 */
export const APP_STOP = 'app-stop';

/**
 * Ends background sharing and wipes the token: for leaving the Group, logging out, or turning it
 * off. Safe to call at any time, from anywhere, as often as you like: with nothing running, or
 * outside the Android shell, it does nothing. Never throws.
 */
export function stopBackgroundSharing(reason = APP_STOP, plugin = LocusBackground) {
  rememberSharedRoom(null);
  try {
    if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('LocusBackground') || typeof plugin?.stop !== 'function') return Promise.resolve();
    lastStopAt = Date.now();
    return Promise.resolve(plugin.stop({ reason })).catch(() => {});
  } catch {
    return Promise.resolve();
  }
}

/**
 * How long after a stop a new start waits. The service tells the server it has stopped and only
 * then ends itself, so a start inside that window was ended along with it. Ending a pass on
 * Render takes well under a second; this leaves room for a slow answer.
 */
export const STOP_SETTLE_MS = 5000;
let lastStopAt = -Infinity;
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Tests only: forget the last stop, so the next start does not wait for it. */
export function forgetLastStopForTests() {
  lastStopAt = -Infinity;
}

// The Group the service was last started for, kept across a closed app, so that a start for
// another Group knows to end that one first (see startBackgroundSharing).
export const SHARED_ROOM_KEY = 'locus.backgroundSharing.room';

export function sharedRoom() {
  try {
    return window.localStorage?.getItem(SHARED_ROOM_KEY) || null;
  } catch {
    return null;
  }
}

function rememberSharedRoom(roomCode) {
  try {
    if (roomCode) window.localStorage?.setItem(SHARED_ROOM_KEY, roomCode);
    else window.localStorage?.removeItem(SHARED_ROOM_KEY);
  } catch {
    // Not remembered: a start for another Group then swaps the service over, as it used to.
  }
}

/** Stop reasons that mean the Group the phone was sharing with no longer exists. */
export const GROUP_ENDED_REASONS = ['group-gone', 'revoked'];
