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

  it('asks for no wake lock, battery exemption or drawing over other apps', () => {
    for (const p of ['WAKE_LOCK', 'REQUEST_IGNORE_BATTERY_OPTIMIZATIONS', 'SYSTEM_ALERT_WINDOW']) {
      expect(permissions).not.toContain(`android.permission.${p}`);
    }
  });

  // Item 8 of the 2026-10 bug batch (Krish's decision): an SOS and a ping may ring through Do Not
  // Disturb. That needs the access the person grants in the system's settings, which the app may
  // ask for (ACCESS_NOTIFICATION_POLICY) and only the alert channels use.
  it('asks to let only the SOS and ping alerts through Do Not Disturb', () => {
    expect(permissions).toContain('android.permission.ACCESS_NOTIFICATION_POLICY');
    const users = [
      ...fs.readdirSync(path.join(javaDir, 'sharing')).map((f) => ['sharing', f]),
      ...fs.readdirSync(path.join(javaDir, 'alerts')).map((f) => ['alerts', f]),
    ].filter(([dir, f]) => f.endsWith('.java') && /setBypassDnd\(/.test(read(dir, f))).map(([, f]) => f);
    expect(users.sort()).toEqual(['AlertChannels.java', 'SosNotifications.java']);
  });

  it('asks for the full-screen intent only for the SOS alert, and only the SOS notification code uses it', () => {
    expect(permissions).toContain('android.permission.USE_FULL_SCREEN_INTENT');
    const sharing = fs.readdirSync(path.join(javaDir, 'sharing')).filter((f) => f.endsWith('.java'));
    const users = sharing.filter((f) => /setFullScreenIntent\(/.test(read('sharing', f)));
    expect(users).toEqual(['SosNotifications.java']);
    expect(read('sharing', 'SosNotifications.java')).toMatch(/fullScreenAllowed\(context\)\) builder\.setFullScreenIntent/);
  });

  it('shows the app over the lock screen only for an SOS launch, and takes that back when it leaves the screen', () => {
    expect(manifest).not.toMatch(/showWhenLocked|turnScreenOn/);
    const activity = read('MainActivity.java');
    expect(activity).toMatch(/SosLaunch\.prepareWindow\(this, getIntent\(\)\)/);
    expect(activity).toMatch(/onNewIntent[\s\S]*SosLaunch\.prepareWindow\(this, intent\)/);
    expect(activity).toMatch(/onStop[\s\S]*SosLaunch\.releaseWindow\(this\)/);
    expect(read('sharing', 'SosLaunch.java')).toMatch(/if \(!isSosIntent\(activity, intent\)\) return;/);
  });

  it('takes an SOS launch only from LOCUS itself: another app cannot fake one (it must carry the install\'s launch key)', () => {
    const launch = read('sharing', 'SosLaunch.java');
    expect(launch).toMatch(/\.putExtra\(EXTRA_KEY, launchKey\(context\)\)/);
    expect(launch).toMatch(/String key = intent\.getStringExtra\(EXTRA_KEY\);\s*return key != null && MessageDigest\.isEqual\(/);
    expect(launch).toMatch(/getSharedPreferences\(PREFS, Context\.MODE_PRIVATE\)/);
    expect(read('sharing', 'LocusBackgroundPlugin.java')).toMatch(/if \(!SosLaunch\.isSosIntent\(getContext\(\), intent\)\) return;/);
  });

  it('trusts certificates the user installed only in debug builds', () => {
    const config = fs.readFileSync(path.join(root, 'res/xml/network_security_config.xml'), 'utf8');
    const [base] = config.match(/<base-config[\s\S]*?<\/base-config>/);
    expect(base).toMatch(/<certificates src="system" \/>/);
    expect(base).not.toMatch(/src="user"/);
    expect(config).toMatch(/<debug-overrides>[\s\S]*<certificates src="user" \/>[\s\S]*<\/debug-overrides>/);
  });

  it('hands a locked phone back to its lock screen once the SOS shown over it is acknowledged', () => {
    expect(read('sharing', 'LocusBackgroundPlugin.java')).toMatch(/SosLaunch\.leaveIfStillLocked\(getActivity\(\)\)/);
    expect(read('sharing', 'SosLaunch.java')).toMatch(/isLocked\(activity\)\) activity\.finishAndRemoveTask\(\)/);
  });

  it('never unlocks the phone or switches Do Not Disturb off', () => {
    for (const dir of ['sharing', 'alerts']) {
      for (const f of fs.readdirSync(path.join(javaDir, dir)).filter((name) => name.endsWith('.java'))) {
        expect(read(dir, f), f).not.toMatch(/requestDismissKeyguard|setInterruptionFilter|disableKeyguard/);
      }
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
    // ...and not onStop, which comes later (or, in split screen, never). (MainActivity does have an
    // onStop, only to take the SOS lock-screen privilege back; it must not report liveness.)
    expect(activity).not.toMatch(/onStart/);
    expect(activity.match(/void onStop\(\)[^}]*\}/)?.[0] ?? '').not.toMatch(/SharingState/);
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
