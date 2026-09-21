import { App } from '@capacitor/app';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { simulatedGeolocation, simulatedWifiSurvey } from './simulator.js';

export const isNative = Capacitor.isNativePlatform();

// Native half: android/app/src/main/java/com/locus/wifisurvey/WifiSurveyPlugin.java,
// registered by hand in MainActivity (it's local, not an npm package).
export const WifiSurvey = registerPlugin('WifiSurvey', { web: simulatedWifiSurvey });

export const Geo = isNative ? Geolocation : simulatedGeolocation;

/** Coming back from a Settings screen is the usual way a blocker gets fixed. */
export function onResume(handler) {
  if (isNative) {
    App.addListener('resume', handler);
  } else {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') handler();
    });
  }
}
