// Sample data for the dev-only preview gallery (preview.html). Made-up people and numbers,
// placed on the SRM KTR campus so distances and directions look real. Nothing here is a
// credential or a real account.

export const ME = { lat: 12.8237, lng: 80.0444 };

const secondsAgo = (s) => Date.now() - s * 1000;

export const MEMBERS = [
  { id: 's-meera', uid: 'u-meera', name: 'MEERA', photo: null, role: 'MEMBER', hasFix: true, lat: 12.8246, lng: 80.0446, speed: 4, heading: 20, battery: 82, status: 'ACTIVE', lastSeen: secondsAgo(3) },
  { id: 's-aarav', uid: 'u-aarav', name: 'AARAV', photo: null, role: 'MEMBER', hasFix: true, lat: 12.8231, lng: 80.0472, speed: 0, heading: 0, battery: 19, status: 'FROZEN', lastSeen: secondsAgo(140) },
  { id: 's-rohan', uid: 'u-rohan', name: 'ROHAN', photo: null, role: 'MEMBER', hasFix: false, lat: null, lng: null, speed: 0, heading: 0, battery: 0, status: 'ACTIVE', lastSeen: null },
];

export const BUILDING = {
  id: 2,
  name: 'Tech Park',
  category: 'Academic',
  lat: 12.8250,
  lng: 80.0453,
  info: 'Computing and IT departments, labs and lecture halls.',
};

export const NOTICES = [
  { severity: 'success', message: 'Code copied.' },
  { severity: 'info', message: 'A squad member designated a rally point. Tap to view it.', title: 'RALLY_POINT' },
  { severity: 'warning', message: 'Could not reach the clipboard. Read the code out instead.', title: 'COPY_FAILED' },
  { severity: 'error', message: '[SYS_AR] ALIGN: centre a building in the view first.' },
];

export const SOS = { senderName: 'Meera', lat: 12.82461, lng: 80.04462, ageMs: 0, pendingCount: 1 };

const MANIFEST = {
  version: '1.2.0',
  tag: 'v1.2.0',
  apkUrl: 'https://example.invalid/locus.apk',
  apkSize: 14.2 * 1024 * 1024,
  sha256: 'a'.repeat(64),
  notes: 'Calmer look, light and dark themes.\nPaused sharing now really pauses.',
};

const noop = () => {};

/** A fake useAppUpdate() result in the given state (see UpdateStatus). */
export const appUpdate = (status, extra = {}) => ({
  supported: true,
  status,
  manifest: MANIFEST,
  installedVersion: '1.1.0',
  progress: { percent: 46, loaded: 6.5 * 1024 * 1024, total: 14.2 * 1024 * 1024 },
  error: null,
  mandatory: false,
  dismissed: false,
  check: noop,
  startDownload: noop,
  openInstallSettings: noop,
  dismiss: noop,
  reset: noop,
  ...extra,
});

/** A fake useLiveUpdate() result in the given state (see LiveUpdateStatus). */
export const liveUpdate = (status, extra = {}) => ({
  visible: true,
  status,
  manifest: { version: '1.1.20', minNative: '1.1.0' },
  download: { percent: 38, startedAt: Date.now() - 9000 },
  error: null,
  dismiss: noop,
  applyNow: noop,
  ...extra,
});

/** AR Scan tags as the Landmark Anchor Engine would place them (x, y in % of the view). */
export const AR_TAGS = [
  { name: 'TECH PARK', distanceText: '180 M', x: 50, y: 38, variant: 'target' },
  { name: 'UNIVERSITY BUILDING', distanceText: '320 M', x: 22, y: 30, variant: 'building' },
  { name: 'MEERA', distanceText: '95 M', x: 74, y: 46, variant: 'member', focused: true },
  { name: 'JAVA GREEN', distanceText: '410 M', x: 4, y: 52, variant: 'building', edge: 'left' },
];
