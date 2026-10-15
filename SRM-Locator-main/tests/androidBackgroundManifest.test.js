import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Guards the decisions in the Android project that no JavaScript test can see: what background
 * sharing may ask the phone for, and that it can only start from the app. (Their behaviour is
 * covered by the JVM tests in android/app/src/test and the phone test script.)
 */

const root = path.resolve(import.meta.dirname, '../android/app/src/main');
// Comments explain the decisions in words (including the permissions NOT asked for); only code counts.
const manifest = fs.readFileSync(path.join(root, 'AndroidManifest.xml'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
const javaDir = path.join(root, 'java/com/locus/app');
const read = (...parts) => fs.readFileSync(path.join(javaDir, ...parts), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const permissions = [...manifest.matchAll(/<uses-permission android:name="([^"]+)"/g)].map((m) => m[1]);

describe('what background sharing asks the phone for', () => {
  it('declares the foreground service, its location type, and the notification permission', () => {
    expect(permissions).toContain('android.permission.FOREGROUND_SERVICE');
    expect(permissions).toContain('android.permission.FOREGROUND_SERVICE_LOCATION');
    expect(permissions).toContain('android.permission.POST_NOTIFICATIONS');
  });

  it('does not ask for location "all the time": a service started from the visible app keeps its access', () => {
    expect(permissions).not.toContain('android.permission.ACCESS_BACKGROUND_LOCATION');
    expect(manifest).not.toMatch(/ACCESS_BACKGROUND_LOCATION/);
  });

  it('asks for no wake lock, battery exemption or full-screen intent', () => {
    for (const p of ['WAKE_LOCK', 'REQUEST_IGNORE_BATTERY_OPTIMIZATIONS', 'USE_FULL_SCREEN_INTENT']) {
      expect(permissions).not.toContain(`android.permission.${p}`);
    }
  });

  it('declares the service as a private, location-type foreground service', () => {
    const service = manifest.match(/<service[^>]*LocationShareService[^>]*\/>/s)?.[0];
    expect(service).toBeTruthy();
    expect(service).toContain('android:exported="false"');
    expect(service).toContain('android:foregroundServiceType="location"');
  });

  it('adds nothing else that can be started from outside the app', () => {
    const exported = [...manifest.matchAll(/<(service|receiver|activity|provider)\b[^>]*android:exported="true"[^>]*>/gs)].map((m) => m[0]);
    expect(exported.filter((tag) => /sharing\./.test(tag) && !/BootResumeReceiver/.test(tag))).toEqual([]);
  });
});

describe('how the service can be started', () => {
  it('the plugin is registered with the app', () => {
    expect(read('MainActivity.java')).toContain('registerPlugin(LocusBackgroundPlugin.class)');
  });

  it('only the plugin starts it as a foreground service, and nothing starts it from a broadcast', () => {
    const sharing = fs.readdirSync(path.join(javaDir, 'sharing')).filter((f) => f.endsWith('.java'));
    const starters = sharing.filter((f) => /startForegroundService\(/.test(read('sharing', f)));
    expect(starters).toEqual(['LocusBackgroundPlugin.java']);
    for (const f of sharing.filter((name) => /Receiver/.test(name))) {
      expect(read('sharing', f)).not.toMatch(/startService\(|startForegroundService\(/);
    }
  });

  it('the token is never logged, anywhere in the sharing code', () => {
    for (const f of fs.readdirSync(path.join(javaDir, 'sharing')).filter((name) => name.endsWith('.java'))) {
      expect(read('sharing', f), f).not.toMatch(/Log\.[a-z]\(|System\.(out|err)|printStackTrace/);
    }
  });

  it('follows the app going to and from the foreground through onResume and onPause, which still fire when JavaScript is frozen', () => {
    const activity = read('MainActivity.java');
    expect(activity).toMatch(/public void onResume\(\)[\s\S]*SharingState\.activityResumed\(\)/);
    expect(activity).toMatch(/public void onPause\(\)[\s\S]*SharingState\.activityPaused\(\)/);
    // ...and not onStop, which comes later (or, in split screen, never).
    expect(activity).not.toMatch(/onStop|onStart/);
    // The pause is reported BEFORE super.onPause(), where Capacitor freezes the WebView.
    expect(activity.indexOf('SharingState.activityPaused()')).toBeLessThan(activity.indexOf('super.onPause()'));
  });

  it('refuses to send a token over anything but https (or the developer machine)', () => {
    expect(read('sharing', 'Endpoint.java')).toContain('scheme.equals("https")');
  });
});

describe('the notice after a restart', () => {
  it('asks only to hear that the phone has restarted', () => {
    expect(permissions).toContain('android.permission.RECEIVE_BOOT_COMPLETED');
  });

  it('is a receiver for the boot broadcast and nothing else', () => {
    const receiver = manifest.match(/<receiver[^>]*BootResumeReceiver[\s\S]*?<\/receiver>/)?.[0];
    expect(receiver).toBeTruthy();
    expect([...receiver.matchAll(/<action android:name="([^"]+)"/g)].map((m) => m[1])).toEqual(['android.intent.action.BOOT_COMPLETED']);
  });

  it('only posts a notice: it never starts the service, and never opens the sealed token', () => {
    const code = read('sharing', 'BootResumeReceiver.java');
    expect(code).not.toMatch(/LocationShareService|startService|startForegroundService|\.load\(|SharingState\.session|KeystoreSecretBox/);
    expect(code).toMatch(/resumeHint\(/);
    expect(code).toMatch(/ACTION_BOOT_COMPLETED/);
  });
});
