import { Capacitor, registerPlugin } from '@capacitor/core';

// The SOS klaxon and the ping blip at full volume, on a phone (android/.../AlertSoundPlugin.java).
// They used to be Web Audio only, which plays on the media stream: quiet at a low media volume,
// silent with it at zero. The native side plays them on the ALARM stream with the alarm volume
// raised, and puts the volume back afterwards. Where it is missing (the web, a shell from before
// it existed) every function here says so, and the caller plays its Web Audio sound as before.

// How loud an alert plays: a fraction of the phone's maximum alarm volume.
export const ALERT_ALARM_VOLUME_FRACTION = 1.0;

const AlertSound = registerPlugin('AlertSound');

/** Whether this is a phone whose app has the native alert sounds. */
export const hasNativeAlertSound = () =>
  Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('AlertSound');

/** Plays 'sos' (looping until stopAlertSound) or 'ping' (once). @returns {Promise<boolean>} whether it plays */
export async function playAlertSound(kind) {
  if (!hasNativeAlertSound()) return false;
  try {
    const { playing } = await AlertSound.play({ kind, volumeFraction: ALERT_ALARM_VOLUME_FRACTION });
    return Boolean(playing);
  } catch {
    return false;
  }
}

export async function stopAlertSound() {
  if (!hasNativeAlertSound()) return;
  try {
    await AlertSound.stop();
  } catch {
    // Nothing playing, or no plugin: nothing to stop.
  }
}

/** Tells native code (a ping notification raised while the app is closed) about LOCUS's Do Not Disturb. */
export async function shareInAppDnd(on) {
  if (!hasNativeAlertSound()) return;
  try {
    await AlertSound.setInAppDnd({ on: Boolean(on) });
  } catch {
    // An older shell: nothing native to tell.
  }
}

/** Whether alerts may sound through the phone's own Do Not Disturb. null: not a phone that can say. */
export async function dndAccessGranted() {
  if (!hasNativeAlertSound()) return null;
  try {
    const { granted } = await AlertSound.getDndAccess();
    return Boolean(granted);
  } catch {
    return null;
  }
}

/** Opens the system screen where Do Not Disturb access is given. @returns {Promise<boolean>} whether it opened */
export async function openDndAccessSettings() {
  if (!hasNativeAlertSound()) return false;
  try {
    await AlertSound.openDndAccessSettings();
    return true;
  } catch {
    return false;
  }
}
