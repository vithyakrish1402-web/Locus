// The Floor 7 walk recorder (test build only: imported by floor7Demo.js and the F7 overlay,
// both of which are left out of every other build). It OBSERVES the pipeline: the tracker
// hands it what it just computed, it never hands anything back. Nothing is stored before
// Start and nothing after Stop. See floor7Recording.mjs for the file formats.
//
// Files go to the phone's app folder through the native Recorder plugin (floor7RecorderNative.js);
// the recording is saved every AUTOSAVE_MS, so a crash loses at most that much, and an
// unfinished recording is offered for recovery the next time the app opens.

import { App as CapacitorApp } from '@capacitor/app';
import floor7Aps from '../data/floor7Aps.json';
import planDoc from '../../floor7-inputs/floor7_plan.json';
import { CAMPUS_SSIDS } from '../../scripts/lib/floor7Anchors.mjs';
import { DEFAULT_DWELL_S } from '../../scripts/lib/floor7PhoneWalk.mjs';
import {
  estimatesCsv, eventsCsv, marksCsv, reportFromFiles as scoreFiles, scansCsv,
} from '../../scripts/lib/floor7Recording.mjs';
import {
  CONFIRM_WITHIN_M, MAX_JUMP_M, MAX_WALK_SPEED_MPS, MEASUREMENT_NOISE_BASE_M,
  MIN_CONFIDENCE, PROCESS_NOISE_M2_PER_S, REACQUIRE_AFTER_REJECTS,
} from './positionFilter.js';
import { WIFI_CONFIDENCE_THRESHOLD } from './positionSource.js';
import {
  WIFI_ESTIMATE_MAX_AGE_MS, WIFI_SCAN_BUFFER_SIZE, WIFI_SCAN_INTERVAL_MS, WIFI_SCAN_MAX_AGE_MS,
} from './wifiFusion.js';
import { PLAN_SCALE, floor7Plan } from './floor7Plan.js';
import { recorderNative } from './floor7RecorderNative.js';

export const AUTOSAVE_MS = 10_000;
export const FILE_KINDS = ['estimates.csv', 'scans.csv', 'doors.csv', 'events.csv', 'summary.txt'];
const DATA_FILE = '_data.json';

/** Every constant that shapes what the filter shows, as it is in this build. */
export const CONSTANTS = {
  PLAN_SCALE, MAX_JUMP_M, MAX_WALK_SPEED_MPS, REACQUIRE_AFTER_REJECTS, CONFIRM_WITHIN_M,
  MEASUREMENT_NOISE_BASE_M, PROCESS_NOISE_M2_PER_S, MIN_CONFIDENCE,
  WIFI_CONFIDENCE_THRESHOLD, WIFI_SCAN_INTERVAL_MS, WIFI_SCAN_BUFFER_SIZE, WIFI_SCAN_MAX_AGE_MS,
  WIFI_ESTIMATE_MAX_AGE_MS, DEFAULT_DWELL_S,
};

const KNOWN_BSSIDS = new Set(floor7Aps.radios.flatMap((r) => r.bssids.map((b) => b.bssid.toLowerCase())));
/** A campus reading: a campus network name, or an access point the bundled table knows. */
export const isCampusReading = (ap) => CAMPUS_SSIDS.includes(ap.ssid) || KNOWN_BSSIDS.has(String(ap.bssid).toLowerCase());

// A small, stable fingerprint of the plan (FNV-1a over its JSON): same plan, same value.
function fingerprint(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}
export const PLAN_FINGERPRINT = fingerprint(JSON.stringify(planDoc));

/** The places a person can stand at, for the picker: the plan's places that have a front point. */
export function listPlaces(doc = planDoc) {
  return doc.places.filter((p) => p.front_point).map((p) => {
    const survey = doc.survey_spots.filter((s) => s.place_id === p.id).map((s) => s.name);
    const names = [...new Set([p.name, ...(p.aliases ?? []), ...survey])];
    return { id: p.id, name: p.name, search: names.join(' ').toLowerCase(), names };
  });
}

/** Why the filter showed what it showed, in words (it keeps no reason of its own). */
export function statusReason(status, walkFromLastM) {
  if (status === 'waiting') return `waiting for a second estimate within ${CONFIRM_WITHIN_M} m on foot that agrees`;
  if (status === 'rejected') return `${walkFromLastM === null ? 'jump' : `${walkFromLastM.toFixed(1)} m walk`} from the last shown position is more than the filter allows (cap ${MAX_JUMP_M} m)`;
  if (status === 'reacquiring') return `${REACQUIRE_AFTER_REJECTS} rejected estimates in a row agreed with each other: track restarted at the newest`;
  return '';
}

const pad = (n) => String(n).padStart(2, '0');
const newId = (ms) => {
  const d = new Date(ms);
  return `floor7_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
};

export const defaultMeta = () => ({
  phone: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
  // eslint-disable-next-line no-undef
  build: typeof __LOCUS_BUILD__ !== 'undefined' ? __LOCUS_BUILD__ : null,
  planFingerprint: PLAN_FINGERPRINT,
  planTitle: planDoc.meta?.title ?? '',
});

/** Score a recording from its own two files, the way the desktop script does (same function). */
export const reportFromFiles = (texts, { plan = floor7Plan, scale = PLAN_SCALE, doc = planDoc } = {}) => scoreFiles({ ...texts, plan, scale, doc });

// ------------------------------------------------------------------ storing (the native plugin)

/** Where the files go. The native plugin on the phone; memory in a browser or a test. */
export function createMemoryStore() {
  const dirs = new Map();
  const state = { keepOn: false, shared: [], downloads: [] };
  return {
    state,
    available: false,
    write: async (dir, name, content) => { if (!dirs.has(dir)) dirs.set(dir, new Map()); dirs.get(dir).set(name, content); },
    read: async (dir, name) => { const c = dirs.get(dir)?.get(name); if (c === undefined) throw new Error('NOT_FOUND'); return c; },
    list: async () => [...dirs].map(([id, files]) => ({ id, files: [...files.keys()] })),
    remove: async (dir) => { dirs.delete(dir); },
    share: async (dir, names) => { state.shared.push({ dir, names }); },
    saveToDownloads: async (dir, names) => { state.downloads.push({ dir, names }); return { saved: names.length }; },
    keepScreenOn: async (on) => { state.keepOn = on; },
  };
}

export const nativeStore = () => ({ ...recorderNative, available: recorderNative.available });

function defaultLifecycle(onChange) {
  const onVisibility = () => onChange(document.visibilityState !== 'hidden');
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
  let handle = null;
  try {
    Promise.resolve(CapacitorApp.addListener('appStateChange', ({ isActive }) => onChange(isActive))).then((h) => { handle = h; }).catch(() => {});
  } catch { /* no native app here */ }
  return () => {
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
    Promise.resolve(handle?.remove?.()).catch(() => {});
  };
}

// ------------------------------------------------------------------ the recorder

/**
 * @param {object} [deps] all injectable so tests run without a phone
 */
export function createRecorder({
  now = () => Date.now(),
  store = createMemoryStore(),
  meta = defaultMeta,
  constants = CONSTANTS,
  autosaveMs = AUTOSAVE_MS,
  setTimer = (fn, ms) => setInterval(fn, ms),
  clearTimer = (t) => clearInterval(t),
  attachLifecycle = defaultLifecycle,
  doc = planDoc,
} = {}) {
  let rec = null; // the live recording, or null
  let last = null; // the newest finished one: { id, report, files }
  let detach = null;
  let timer = null;
  let saving = Promise.resolve();
  let warning = null; // { leftAt, seconds|null, count } until dismissed
  const listeners = new Set();
  const emit = () => listeners.forEach((l) => l());

  const place = (id) => {
    const p = doc.places.find((x) => x.id === id);
    if (!p) throw new Error(`unknown place ${id}`);
    return p;
  };

  /** Door windows end at Done, at the next mark, at the default dwell, or at Stop, whichever is first. */
  const marksForFile = (r, endAt) => r.marks.map((m, i) => {
    if (m.kind !== 'door') return { ...m, dwellS: '' };
    const next = r.marks[i + 1]?.at ?? endAt;
    const end = Math.min(m.at + DEFAULT_DWELL_S * 1000, m.endedAt ?? next, endAt);
    return { ...m, dwellS: Math.max(0, (end - m.at) / 1000) };
  });

  const filesOf = (r, endAt, status) => {
    const marks = marksForFile(r, endAt);
    const estimatesText = estimatesCsv(r.estimates);
    const marksText = marksCsv(marks);
    const report = reportFromFiles({ estimatesText, marksText }, { doc });
    const summary = [
      `LOCUS Floor 7 walk recording ${r.id}`,
      `status: ${status}`,
      `started: ${new Date(r.startedAt).toISOString()}   ended: ${new Date(endAt).toISOString()}   (${((endAt - r.startedAt) / 1000).toFixed(0)} s)`,
      `estimates: ${r.estimates.length}   scans: ${r.scans.length}   door marks: ${marks.filter((m) => m.kind === 'door').length}`,
      '',
      `phone: ${r.meta.phone}`,
      `app: ${r.meta.build ? JSON.stringify(r.meta.build) : 'build info not available'}`,
      `plan: ${r.meta.planTitle} (fingerprint ${r.meta.planFingerprint})`,
      '',
      'constants in force:',
      ...Object.entries(r.constants).map(([k, v]) => `  ${k} = ${v}`),
      '',
      `events: ${r.events.length}${r.events.length ? ` (see ${r.id}_events.csv)` : ''}`,
      ...(r.events.some((e) => e.event === 'left_foreground') ? ['WARNING: the app left the foreground during this recording. Android slows Wi-Fi scans then, so there may be gaps.'] : []),
      '',
      'PRIVACY: these files hold the Wi-Fi names and hardware addresses of campus access points. No account data is in them.',
      '',
      'ERROR REPORT',
      report.text,
      '',
    ].join('\n');
    return {
      files: {
        [`${r.id}_estimates.csv`]: estimatesText,
        [`${r.id}_scans.csv`]: scansCsv(r.scans),
        [`${r.id}_doors.csv`]: marksText,
        [`${r.id}_events.csv`]: eventsCsv(r.events),
        [`${r.id}_summary.txt`]: summary,
      },
      report,
    };
  };

  const save = (r, endAt, status) => {
    const { files, report } = filesOf(r, endAt, status);
    const data = JSON.stringify({ ...r, status, endAt });
    saving = saving.then(async () => {
      for (const [name, content] of Object.entries(files)) await store.write(r.id, name, content);
      await store.write(r.id, DATA_FILE, data);
    }).catch((e) => { console.warn('[F7 recorder] save failed', e?.message); });
    return { files, report, done: saving };
  };

  const event = (name, detail = '') => { if (rec) rec.events.push({ at: now(), event: name, detail }); };

  const onForeground = (active) => {
    if (!rec) return;
    if (!active) {
      event('left_foreground', 'app in the background or screen off');
      warning = { leftAt: now(), seconds: null, count: (warning?.count ?? 0) + 1 };
    } else {
      event('returned_to_foreground');
      if (warning && warning.seconds === null) warning = { ...warning, seconds: Math.round((now() - warning.leftAt) / 1000) };
    }
    emit();
  };

  return {
    store,
    get recording() { return rec !== null; },
    get last() { return last; },

    /** Starts a new, separate recording. Nothing was stored before this. */
    start() {
      if (rec) return rec.id;
      const t = now();
      rec = { id: newId(t), startedAt: t, estimates: [], scans: [], marks: [], events: [], meta: meta(), constants };
      last = null;
      warning = null;
      event('start');
      store.keepScreenOn(true).catch(() => {});
      detach = attachLifecycle(onForeground);
      timer = setTimer(() => { if (rec) save(rec, now(), 'recording'); }, autosaveMs);
      save(rec, t, 'recording');
      emit();
      return rec.id;
    },

    /** Ends it, writes the files and the error report. Nothing is stored after this. */
    async stop() {
      if (!rec) return last;
      const r = rec;
      const t = now();
      rec = null;
      clearTimer(timer);
      detach?.();
      detach = null;
      r.events.push({ at: t, event: 'stop', detail: '' });
      store.keepScreenOn(false).catch(() => {});
      const { files, report, done } = save(r, t, 'done');
      await done;
      last = { id: r.id, report, files: Object.keys(files) };
      emit();
      return last;
    },

    /** What the tracker just computed. Ignored unless a recording is running. */
    recordEstimate(e) {
      if (!rec) return;
      const status = e.status === 'confirming' ? 'waiting' : e.status;
      const scans = (e.scans ?? []).map((s) => ({ at: s.at, aps: s.aps.filter(isCampusReading).map((a) => ({ bssid: String(a.bssid).toLowerCase(), ssid: a.ssid ?? '', rssi: a.rssi, frequency: a.frequency })) }));
      for (const s of scans) if (!rec.scans.some((x) => x.at === s.at)) rec.scans.push(s);
      rec.estimates.push({
        at: e.at, raw: e.raw, snapped: e.snapped, filtered: e.filtered, status,
        reason: statusReason(status, e.walkFromLastM ?? null), walkFromLastM: e.walkFromLastM ?? null,
        confidence: e.confidence, matched: e.matched, total: e.total,
        scansMerged: scans.length, scansUsed: scans.map((s) => s.at), unc: e.unc,
      });
      emit();
    },

    /** A scan cycle that ended without an estimate (scan error, throttled, nothing in range...). */
    recordCycle(outcome, detail = '') {
      if (rec && outcome !== 'estimate') event(`cycle_${outcome}`, detail);
    },

    markDoor(placeId) {
      if (!rec) return;
      const p = place(placeId);
      const t = now();
      const openAt = rec.marks.findLastIndex((m) => m.kind === 'door' && m.endedAt == null);
      if (openAt >= 0) rec.marks[openAt].endedAt = t;
      // closedIndex: the door this tap ended, so Undo can put it back
      rec.marks.push({ kind: 'door', placeId: p.id, placeName: p.name, at: t, endedAt: null, closedIndex: openAt });
      emit();
    },
    /** Ends the current door's dwell now (Done / next door). */
    doneDoor() {
      if (!rec) return;
      const open = rec.marks.findLast?.((m) => m.kind === 'door' && m.endedAt == null);
      if (open) { open.endedAt = now(); emit(); }
    },
    markWalk(which, placeId) {
      if (!rec) return;
      const p = place(placeId);
      rec.marks.push({ kind: which === 'start' ? 'walk_start' : 'walk_end', placeId: p.id, placeName: p.name, at: now() });
      emit();
    },
    undoMark() {
      if (!rec) return;
      const undone = rec.marks.pop();
      const reopened = rec.marks[undone?.closedIndex];
      if (reopened && reopened.endedAt === undone.at) reopened.endedAt = null;
      emit();
    },

    onForeground,
    dismissWarning() { warning = null; emit(); },

    snapshot() {
      if (!rec) return { recording: false, last, warning };
      const doors = rec.marks.filter((m) => m.kind === 'door');
      const cur = doors.at(-1);
      const t = now();
      const current = cur && cur.endedAt == null && t - cur.at < DEFAULT_DWELL_S * 1000
        ? { placeName: cur.placeName, secondsLeft: Math.max(0, Math.ceil((cur.at + DEFAULT_DWELL_S * 1000 - t) / 1000)) }
        : null;
      return {
        recording: true, id: rec.id, startedAt: rec.startedAt, elapsedMs: t - rec.startedAt, count: rec.estimates.length,
        current, marks: rec.marks.map((m) => ({ ...m })), warning,
        openWalkStart: (() => { const w = rec.marks.filter((m) => m.kind.startsWith('walk')); return w.at(-1)?.kind === 'walk_start' ? w.at(-1) : null; })(),
      };
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    // -------- earlier recordings
    async recordings() {
      const out = [];
      for (const { id } of await store.list()) {
        try {
          const d = JSON.parse(await store.read(id, DATA_FILE));
          out.push({ id, startedAt: d.startedAt, endAt: d.endAt, status: d.status, estimates: d.estimates.length, active: rec?.id === id });
        } catch { /* a folder without our data file */ }
      }
      return out.sort((a, b) => b.startedAt - a.startedAt);
    },
    /** Recordings the app was killed in the middle of (still marked 'recording', not the live one). */
    async recoverable() {
      return (await this.recordings()).filter((r) => r.status === 'recording' && !r.active);
    },
    /** Finishes a recording the app was killed in, as of its last autosave. */
    async recover(id) {
      const d = JSON.parse(await store.read(id, DATA_FILE));
      const endAt = Math.max(d.startedAt, d.endAt ?? 0, ...d.estimates.map((e) => e.at), ...d.marks.map((m) => m.at), ...d.events.map((e) => e.at));
      d.events.push({ at: endAt, event: 'recovered_after_app_closed', detail: 'the app was closed before Stop; this is the last autosave' });
      const { files, report, done } = save(d, endAt, 'recovered');
      await done;
      return { id, report, files: Object.keys(files) };
    },
    async report(id) {
      const d = JSON.parse(await store.read(id, DATA_FILE));
      return filesOf(d, d.endAt ?? d.startedAt, d.status).report;
    },
    fileNames: (id) => FILE_KINDS.map((k) => `${id}_${k}`),
    share(id) { return store.share(id, FILE_KINDS.map((k) => `${id}_${k}`)); },
    saveToDownloads(id) { return store.saveToDownloads(id, FILE_KINDS.map((k) => `${id}_${k}`)); },
    remove(id) { return store.remove(id); },
  };
}

/** The one the app uses: the native store on the phone. */
export const recorder = createRecorder({ store: nativeStore() });
