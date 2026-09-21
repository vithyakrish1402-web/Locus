import './style.css';
import { FIX_WINDOW_MS, GOOD_FIX_M, bestFix } from './bestFix.js';
import { CAMPUS_BUILDINGS } from './campusBuildings.js';
import { CSV_HEADER, buildPointRows } from './csv.js';
import { describeScan } from './outcome.js';
import { Geo, WifiSurvey, isNative, onResume } from './platform.js';
import { blockersFromStatus } from './readiness.js';
import { scanBudget } from './scanBudget.js';

const SCAN_TIMEOUT_MS = 10_000;
const GPS_TIMEOUT_MS = 15_000;
const POOR_ACCURACY_M = 25;
const AP_ROWS_SHOWN = 12;
const TOP_FLOOR = 15; // Tech Park
const TAG_STORAGE_KEY = 'wifiSurvey.tag';

const state = {
  status: null,
  blockers: [],
  statusError: null,
  live: null, // latest fix from the live watch
  liveError: null,
  watchId: null,
  busy: false,
  sessionPoints: 0,
  acceptedScans: [], // epoch ms of scans the OS accepted, for the throttle readout
  lastScan: null, // last *fresh* scan: { apCount, at }
  result: null, // banner: { kind, title, detail }
  progress: null, // while a tap is in flight: { startedAt, scanDone, gps }
  lastPoint: null,
  log: null, // getLogInfo(); null until read - logging is blocked without it
  logError: null,
};

const $ = (id) => document.getElementById(id);
const els = {
  simBanner: $('sim-banner'),
  blockers: $('blockers'),
  gps: $('gps'),
  accuracy: $('accuracy'),
  lastScan: $('last-scan'),
  session: $('session'),
  file: $('file'),
  budget: $('budget'),
  throttleTip: $('throttle-tip'),
  result: $('result'),
  resultTitle: $('result-title'),
  resultDetail: $('result-detail'),
  lastPoint: $('last-point'),
  lastPointTitle: $('last-point-title'),
  apRows: $('ap-rows'),
  share: $('share'),
  logPoint: $('log-point'),
  building: $('building'),
  floor: $('floor'),
  spot: $('spot'),
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const errorText = (e) => (e && (e.message || e.errorMessage)) || String(e);

// ------------------------------------------------------------------ location tag

const floorLabel = (floor) => (floor === null ? '' : floor === 0 ? 'G' : floor < 0 ? `B${-floor}` : String(floor));
const titleCase = (text) => text.charAt(0) + text.slice(1).toLowerCase();

function setupTagInputs() {
  els.building.append(new Option('Outdoors / not in a building', ''));
  const groups = new Map();
  for (const { name, category } of CAMPUS_BUILDINGS) {
    if (!groups.has(category)) {
      const group = document.createElement('optgroup');
      group.label = titleCase(category);
      groups.set(category, group);
      els.building.append(group);
    }
    groups.get(category).append(new Option(name, name));
  }
  els.building.append(new Option('Other building (name it in Spot)', 'OTHER'));

  els.floor.append(new Option('Floor -', ''));
  for (let floor = -1; floor <= TOP_FLOOR; floor++) {
    els.floor.append(new Option(`Floor ${floorLabel(floor)}`, String(floor)));
  }

  // Building and floor are sticky across taps and app restarts: you set them once on
  // entering a building and again only when changing floor.
  try {
    const saved = JSON.parse(localStorage.getItem(TAG_STORAGE_KEY) || '{}');
    if ([...els.building.options].some((o) => o.value === saved.building)) els.building.value = saved.building;
    if ([...els.floor.options].some((o) => o.value === saved.floor)) els.floor.value = saved.floor;
  } catch {
    // Storage unavailable: start untagged.
  }
  const save = () => {
    try {
      localStorage.setItem(TAG_STORAGE_KEY, JSON.stringify({ building: els.building.value, floor: els.floor.value }));
    } catch {
      // Not persisting is fine; the fields still work for this session.
    }
  };
  els.building.addEventListener('change', () => {
    if (!els.building.value) els.floor.value = ''; // outdoors has no floor
    save();
  });
  els.floor.addEventListener('change', save);
}

function currentTag() {
  return {
    building: els.building.value,
    floor: els.floor.value === '' ? null : Number(els.floor.value),
    spot: els.spot.value.trim(),
  };
}

function describeTag(tag) {
  return [tag.building || 'Outdoors', tag.floor === null ? '' : `floor ${floorLabel(tag.floor)}`, tag.spot]
    .filter(Boolean)
    .join(' · ');
}

// ------------------------------------------------------------------ status / GPS watch

async function refreshStatus() {
  try {
    state.status = await WifiSurvey.getStatus();
    state.statusError = null;
    state.blockers = blockersFromStatus(state.status);
  } catch (e) {
    state.statusError = errorText(e);
    state.blockers = [];
  }
  await syncWatch();
  render();
}

function ready() {
  return state.status !== null && state.statusError === null && state.blockers.length === 0;
}

async function startWatch() {
  if (state.watchId !== null) return;
  state.watchId = 'starting';
  try {
    state.watchId = await Geo.watchPosition(
      { enableHighAccuracy: true, timeout: GPS_TIMEOUT_MS, maximumAge: 0 },
      (position, err) => {
        if (err) {
          state.liveError = errorText(err);
        } else if (position) {
          state.live = position;
          state.liveError = null;
        }
        render();
      },
    );
  } catch (e) {
    state.watchId = null;
    state.liveError = errorText(e);
  }
}

async function stopWatch() {
  const id = state.watchId;
  if (id === null || id === 'starting') return;
  state.watchId = null;
  state.live = null;
  try {
    await Geo.clearWatch({ id });
  } catch {
    // The watch is already gone; nothing to clean up.
  }
}

async function syncWatch() {
  if (ready()) await startWatch();
  else await stopWatch();
}

// ------------------------------------------------------------------ actions

async function logPoint() {
  if (state.busy) return;
  state.busy = true;
  state.result = null;
  state.progress = { startedAt: Date.now(), scanDone: false, gps: null };
  const tag = currentTag(); // what the surveyor said at the moment of the tap
  render();

  try {
    await refreshStatus();
    if (!ready() || !state.log) {
      return; // the blocker cards already say why
    }

    // The scan (4-7 s) and the GPS window run together. GPS keeps the most accurate fix
    // for up to FIX_WINDOW_MS, stopping early at ±GOOD_FIX_M. If the scan comes back
    // unusable, the GPS wait is cut short: that tap won't be logged anyway.
    const stopGps = new AbortController();
    const scanning = WifiSurvey.scan({ timeoutMs: SCAN_TIMEOUT_MS }).then(
      (scan) => {
        if (scan.outcome !== 'fresh') stopGps.abort();
        return scan;
      },
      (e) => {
        stopGps.abort();
        throw e;
      },
    );
    scanning.finally(() => {
      if (state.progress) state.progress.scanDone = true;
      render();
    }).catch(() => {});
    const [gps, scanned] = await Promise.allSettled([
      bestFix(Geo, {
        signal: stopGps.signal,
        onProgress: (p) => {
          if (state.progress) state.progress.gps = p;
          render();
        },
      }),
      scanning,
    ]);

    if (scanned.status === 'rejected') {
      await refreshStatus();
      state.result = state.blockers.length
        ? null
        : { kind: 'error', title: 'Scan failed. Nothing logged.', detail: errorText(scanned.reason) };
      return;
    }

    const scan = scanned.value;
    if (scan.accepted) state.acceptedScans.push(scan.requestedAt);
    const described = describeScan(scan, scanBudget(state.acceptedScans, Date.now()).retryInMs);
    if (!described.loggable) {
      state.result = described;
      return;
    }
    state.lastScan = { apCount: scan.aps.length, at: scan.completedAt };

    if (gps.status === 'rejected') {
      await refreshStatus();
      state.result = state.blockers.length
        ? null
        : { kind: 'error', title: 'No GPS fix. Nothing logged.', detail: errorText(gps.reason) };
      return;
    }

    const { latitude, longitude, accuracy } = gps.value.position.coords;
    const fix = { lat: latitude, lng: longitude, accuracy };
    const pointId = state.log.lastPointId + 1;
    const lines = buildPointRows({
      pointId,
      timestamp: new Date(scan.completedAt).toISOString(),
      fix,
      aps: scan.aps,
      tag,
    });
    state.log = await WifiSurvey.appendLog({ header: CSV_HEADER, lines });
    state.sessionPoints += 1;
    state.lastPoint = { pointId, tag, aps: [...scan.aps].sort((a, b) => b.rssi - a.rssi) };
    els.spot.value = ''; // spot describes one point; building and floor carry over

    const fixes = gps.value.fixes;
    let gpsNote = ` GPS ±${accuracy.toFixed(1)} m, best of ${fixes} ${fixes === 1 ? 'fix' : 'fixes'}.`;
    if (accuracy > POOR_ACCURACY_M) {
      gpsNote += tag.building
        ? ' GPS is poor here, so the building and floor tag is what places this point.'
        : ' GPS is poor and no building is set, so this point may not place well. Set the building if you are inside one.';
    }
    state.result = {
      kind: 'fresh',
      title: `Point #${pointId} logged: ${plural(scan.aps.length, 'access point')}`,
      detail: `${describeTag(tag)}. ${described.detail}${gpsNote}`,
    };
  } catch (e) {
    state.result = { kind: 'error', title: 'Something went wrong. Nothing logged.', detail: errorText(e) };
  } finally {
    state.busy = false;
    state.progress = null;
    render();
  }
}

/** The banner while a tap is in flight, so a long GPS wait never looks like a hang. */
function progressResult() {
  const p = state.progress;
  const wifi = p.scanDone ? 'WiFi scan done.' : 'Scanning WiFi...';
  let gps = 'Waiting for GPS...';
  if (p.gps) {
    const accuracy = p.gps.best.coords.accuracy;
    const left = Math.max(0, Math.ceil((FIX_WINDOW_MS - (Date.now() - p.startedAt)) / 1000));
    gps =
      accuracy <= GOOD_FIX_M
        ? `GPS ±${accuracy.toFixed(0)} m, good.`
        : `GPS ±${accuracy.toFixed(0)} m, waiting for ±${GOOD_FIX_M} m (up to ${left} s more).`;
  }
  return { kind: 'busy', title: 'Hold still...', detail: `${wifi} ${gps}` };
}

async function shareLog() {
  try {
    await WifiSurvey.shareLog();
  } catch (e) {
    state.result = { kind: 'error', title: "Couldn't share the log", detail: errorText(e) };
    render();
  }
}

const blockerActions = {
  request: { label: 'Grant location', run: () => WifiSurvey.requestLocationPermission() },
  appSettings: { label: 'Open app settings', run: () => WifiSurvey.openAppSettings() },
  locationSettings: { label: 'Open Location settings', run: () => WifiSurvey.openLocationSettings() },
  wifiSettings: { label: 'Turn on WiFi', run: () => WifiSurvey.openWifiSettings() },
};

async function runBlockerAction(key) {
  try {
    await blockerActions[key].run();
  } catch (e) {
    state.result = { kind: 'error', title: 'Could not open that screen', detail: errorText(e) };
  }
  await refreshStatus();
}

// ------------------------------------------------------------------ render

// Rebuilt only when the content changes: render() also runs on a 1 s tick, and replacing
// a button between touch-down and touch-up swallows the tap.
let renderedBlockers = '';
let renderedPointId = null;

function renderBlockers() {
  const cards = [...state.blockers];
  if (state.statusError) {
    cards.push({ title: "Couldn't read the phone's WiFi/location state", detail: state.statusError, actions: [] });
  }
  if (state.logError) {
    cards.push({ title: "Couldn't read the log file", detail: `${state.logError}. Logging is off so point IDs can't collide.`, actions: [] });
  }
  const signature = JSON.stringify(cards);
  if (signature === renderedBlockers) return;
  renderedBlockers = signature;
  els.blockers.replaceChildren();
  for (const blocker of cards) {
    const card = document.createElement('div');
    card.className = 'blocker';
    const title = document.createElement('strong');
    title.textContent = blocker.title;
    const detail = document.createElement('p');
    detail.textContent = blocker.detail;
    const buttons = document.createElement('div');
    buttons.className = 'buttons';
    for (const key of blocker.actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = blockerActions[key].label;
      button.addEventListener('click', () => runBlockerAction(key));
      buttons.append(button);
    }
    card.append(title, detail, buttons);
    els.blockers.append(card);
  }
}

function renderLive() {
  els.gps.classList.toggle('mono', Boolean(state.live)); // monospace only for coordinates
  if (state.live) {
    const { latitude, longitude, accuracy } = state.live.coords;
    const age = Math.max(0, Math.round((Date.now() - state.live.timestamp) / 1000));
    els.gps.textContent = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
    els.accuracy.textContent = `±${accuracy.toFixed(1)} m · ${age} s ago`;
  } else {
    els.gps.textContent = state.liveError ? `GPS error: ${state.liveError}` : ready() ? 'Waiting for a fix' : 'Off';
    els.accuracy.textContent = '-';
  }
}

function renderResult() {
  const result = state.progress ? progressResult() : state.result;
  els.result.hidden = !result;
  if (!result) return;
  els.result.className = `result ${result.kind}`;
  els.resultTitle.textContent = result.title;
  els.resultDetail.textContent = result.detail;
}

function renderLastPoint() {
  const point = state.lastPoint;
  els.lastPoint.hidden = !point;
  if (!point || point.pointId === renderedPointId) return;
  renderedPointId = point.pointId;
  const extra = point.aps.length > AP_ROWS_SHOWN ? `, strongest ${AP_ROWS_SHOWN} shown` : '';
  els.lastPointTitle.textContent =
    `Point #${point.pointId} · ${describeTag(point.tag)}: ${plural(point.aps.length, 'AP')}${extra}`;
  els.apRows.replaceChildren(
    ...point.aps.slice(0, AP_ROWS_SHOWN).map((ap) => {
      // The BSSID is never truncated: its last octets are what tell two APs apart.
      const row = document.createElement('tr');
      const rssi = document.createElement('td');
      rssi.textContent = String(ap.rssi);
      const network = document.createElement('td');
      const ssid = document.createElement('span');
      ssid.className = 'ssid';
      ssid.textContent = ap.ssid || '(hidden)';
      const bssid = document.createElement('span');
      bssid.className = 'bssid mono';
      bssid.textContent = ap.bssid;
      network.append(ssid, bssid);
      const mhz = document.createElement('td');
      mhz.textContent = String(ap.frequencyMhz);
      row.append(rssi, network, mhz);
      return row;
    }),
  );
}

function render() {
  renderBlockers();
  renderLive();
  renderResult();
  renderLastPoint();

  els.lastScan.textContent = state.lastScan
    ? `${plural(state.lastScan.apCount, 'AP')} · ${new Date(state.lastScan.at).toLocaleTimeString()}`
    : 'No successful scan yet';
  els.session.textContent = String(state.sessionPoints);
  els.file.textContent = state.log
    ? `${state.log.points} (${plural(state.log.rows, 'row')})`
    : state.logError
      ? 'unreadable'
      : 'loading';

  // Android's scan throttle, not a cap on points. Known off when the setting says so, or
  // when this session got more scans accepted in the window than the limit allows.
  const budget = scanBudget(state.acceptedScans, Date.now());
  const throttleOff = state.status?.scanThrottle === false || budget.used > budget.limit;
  els.budget.textContent = throttleOff
    ? 'Off, no limit'
    : budget.retryInMs > 0
      ? `4 of 4 used · next in ${Math.ceil(budget.retryInMs / 1000)} s`
      : `${budget.used} of ${budget.limit} used per 2 min`;
  els.throttleTip.hidden = throttleOff;

  els.logPoint.disabled = state.busy || !ready() || !state.log;
  els.logPoint.textContent = state.busy ? 'SCANNING...' : 'LOG POINT';
  els.share.disabled = state.busy || !state.log || state.log.rows === 0;
  // The tag is captured at the tap; locking it mid-scan avoids "which tag did that point get?".
  els.building.disabled = els.floor.disabled = els.spot.disabled = state.busy;
}

// ------------------------------------------------------------------ boot

async function init() {
  els.simBanner.hidden = isNative;
  setupTagInputs();
  els.logPoint.addEventListener('click', logPoint);
  els.share.addEventListener('click', shareLog);
  onResume(async () => {
    // Coming back from Settings: re-read everything, and restart the GPS watch in case
    // the OS dropped it while the app was in the background.
    await stopWatch();
    await refreshStatus();
  });

  try {
    state.log = await WifiSurvey.getLogInfo();
  } catch (e) {
    state.logError = errorText(e);
  }
  await refreshStatus();
  if (state.status?.locationPermission === 'prompt') {
    await runBlockerAction('request');
  }
  setInterval(render, 1000);
}

init();
