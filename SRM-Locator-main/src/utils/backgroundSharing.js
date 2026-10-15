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
// Everything is guarded. Nothing here runs unless
//   - this is a build that offers the switch at all (see isTestSwitchAvailable),
//   - the app is running inside the Android shell, the plugin is present in that shell, and
//     the plugin reports the contract version this file was written for.
// A shell that predates the plugin (or is newer than this file understands) simply never
// shows the switch and never calls the plugin.
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
    addListener: () => Promise.resolve({ remove: () => {} }),
  },
});

// TEMPORARY - replace with Jose's design. Until the real settings design exists, the only way
// to turn background sharing on is a plain switch in Settings, offered only in the "LOCUS Test"
// build (Vite mode `sidetest`, src/utils/buildMode.js): the real app under its own app id, with
// both updaters off. In every other build (releases included) this is false and the switch,
// and everything behind it, is never reached.
export function isTestSwitchAvailable() {
  return import.meta.env.MODE === 'sidetest';
}

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
 *   getIdToken: () => Promise<string>, plugin?: object, fetchImpl?: typeof fetch }} options
 * @returns {Promise<{ ok: true } | { ok: false, reason: string }>} reason is one of mintDeviceToken's,
 *   or: unsupported, permission-denied, notifications-denied, location-denied, cannot-start, not-signed-in
 */
export async function startBackgroundSharing({ baseUrl, roomCode, groupName, pollingMs, getIdToken, plugin = LocusBackground, fetchImpl }) {
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

  try {
    const result = await plugin.start({ baseUrl, roomCode, groupName, deviceToken: minted.token, expiresAt: minted.expiresAt, pollingMs });
    if (result?.started) return { ok: true };
    return { ok: false, reason: typeof result?.state === 'string' ? result.state : 'cannot-start' };
  } catch {
    return { ok: false, reason: 'cannot-start' };
  }
}

/**
 * Ends background sharing and wipes the token: for leaving the Group, logging out, or turning it
 * off. Safe to call at any time, from anywhere, as often as you like: with nothing running, or
 * outside the Android shell, it does nothing. Never throws.
 */
export function stopBackgroundSharing(reason = 'user-stop', plugin = LocusBackground) {
  try {
    if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('LocusBackground') || typeof plugin?.stop !== 'function') return Promise.resolve();
    return Promise.resolve(plugin.stop({ reason })).catch(() => {});
  } catch {
    return Promise.resolve();
  }
}

/** Stop reasons that mean the Group the phone was sharing with no longer exists. */
export const GROUP_ENDED_REASONS = ['group-gone', 'revoked'];
