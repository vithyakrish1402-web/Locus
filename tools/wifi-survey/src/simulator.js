// Browser-preview stand-in for the native WifiSurvey plugin and GPS, so the screen can be
// exercised on a desktop. Capacitor only uses these on the 'web' platform; on the phone
// the real native plugin and @capacitor/geolocation are used and nothing here runs.
//
// Force a state with ?sim=<mode>: ok (default), stale, throttled, timeout, empty,
// prompt, denied, approximate, locoff, wifioff, poorgps.

const mode = new URLSearchParams(globalThis.location?.search ?? '').get('sim') ?? 'ok';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let permission = { prompt: 'prompt', denied: 'denied', approximate: 'approximate' }[mode] ?? 'granted';
let header = null;
const lines = [];

// A short walk: each GPS fix steps ~20 m east, so consecutive points see different
// signal strengths the way a real survey would.
const position = { lat: 12.8231, lng: 80.0444 };

const FAKE_APS = [
  { bssid: 'a4:2b:b0:11:22:01', ssid: 'SRMIST', frequencyMhz: 2437, x: 0 },
  { bssid: 'a4:2b:b0:11:22:02', ssid: 'SRMIST', frequencyMhz: 5180, x: 1 },
  { bssid: 'a4:2b:b0:11:22:03', ssid: 'SRM-Guest', frequencyMhz: 2462, x: 2 },
  { bssid: 'c8:3a:35:40:00:10', ssid: 'Cafe "Java", Block B', frequencyMhz: 2412, x: 3 },
  { bssid: 'c8:3a:35:40:00:11', ssid: '', frequencyMhz: 5745, x: 4 },
  { bssid: '0c:80:63:aa:bc:01', ssid: 'Hostel-4F', frequencyMhz: 2437, x: 5 },
  { bssid: '0c:80:63:aa:bc:02', ssid: 'Library 2', frequencyMhz: 5220, x: 6 },
];

function status() {
  return {
    locationPermission: permission,
    locationServicesOn: mode !== 'locoff',
    wifiOn: mode !== 'wifioff',
    scanAlwaysAvailable: false,
    sdkInt: 0,
  };
}

function info() {
  const ids = lines.map((line) => Number(line.split(',')[0]));
  return {
    exists: lines.length > 0,
    path: '(browser simulator: in memory)',
    bytes: [header, ...lines].join('\n').length,
    rows: lines.length,
    points: new Set(ids).size,
    lastPointId: ids.length ? Math.max(...ids) : 0,
  };
}

export const simulatedWifiSurvey = {
  async getStatus() {
    return status();
  },
  async requestLocationPermission() {
    if (permission !== 'denied') permission = 'granted';
    return status();
  },
  async openAppSettings() {},
  async openLocationSettings() {},
  async openWifiSettings() {},

  async scan({ timeoutMs = 10000 } = {}) {
    const requestedAt = Date.now();
    await sleep(1200);
    const base = { accepted: true, requestedAt, completedAt: Date.now() };
    if (mode === 'throttled') return { ...base, accepted: false, outcome: 'throttled', newestResultAgeMs: 41000, cachedCount: 7 };
    if (mode === 'stale') return { ...base, outcome: 'stale', newestResultAgeMs: 64000, cachedCount: 7 };
    if (mode === 'empty') return { ...base, outcome: 'empty', cachedCount: 0 };
    if (mode === 'timeout') {
      await sleep(Math.max(0, timeoutMs - 1200));
      return { ...base, completedAt: Date.now(), outcome: 'timeout' };
    }
    position.lng += 0.0002; // walked ~20 m since the last point
    const step = Math.round((position.lng - 80.0444) / 0.0002);
    const aps = FAKE_APS.filter((ap) => Math.abs(ap.x - step) <= 3).map(({ x, ...ap }) => ({
      ...ap,
      rssi: -40 - Math.abs(x - step) * 12 - Math.floor(Math.random() * 5),
    }));
    return { ...base, outcome: aps.length ? 'fresh' : 'empty', aps, staleDropped: 1, cachedCount: aps.length + 1 };
  },

  async appendLog({ header: h, lines: newLines }) {
    if (!lines.length) header = h;
    lines.push(...newLines);
    return info();
  },
  async getLogInfo() {
    return info();
  },
  async shareLog() {
    if (!lines.length) throw Object.assign(new Error('Nothing logged yet'), { code: 'EMPTY_LOG' });
    console.info([header, ...lines].join('\n'));
    return { ...info(), fileName: 'wifi_survey_simulated.csv' };
  },
};

// poorgps: indoor-like fixes that never reach ±10 m, to exercise the 15 s GPS window.
function fix() {
  const accuracy = mode === 'poorgps' ? 18 + Math.random() * 16 : 3 + Math.random() * 4;
  return { timestamp: Date.now(), coords: { latitude: position.lat, longitude: position.lng, accuracy } };
}

export const simulatedGeolocation = {
  async watchPosition(_options, callback) {
    callback(fix());
    return String(setInterval(() => callback(fix()), 1500));
  },
  async clearWatch({ id }) {
    clearInterval(Number(id));
  },
};
