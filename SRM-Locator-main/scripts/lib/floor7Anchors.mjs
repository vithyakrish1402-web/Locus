// Where each Floor 7 access point sits, worked out from the survey CSVs and the team's name
// table (floor7-inputs/survey_name_to_plan_spot.csv), which maps every name typed in the
// survey to a spot on the plan. Pure functions: scripts/build-floor7-aps.mjs does the file
// reading and writing, and the leave-one-scan-out replay reuses buildAnchors.
//
// Ground truth is the plan spot a scan was logged at, never GPS: indoors the survey's GPS
// fixes are off by tens of metres (some are stale fixes 400 m away), so GPS is ignored here
// completely. Positions are plan metres (x east, y north, origin at lift lobby A), before
// PLAN_SCALE: the app multiplies by it when it loads them.

/** SSIDs that make an access point campus infrastructure. Defined once, here. */
export const CAMPUS_SSIDS = ['SRMIST', 'SRMIST-UA'];

/** Two spots whose best readings are this close (dB) share the access point between them. */
export const TIE_DB = 3;

/** A gap this long (ms) between two scans of one file starts a new session (morning / afternoon). */
export const SESSION_GAP_MS = 60 * 60 * 1000;

/**
 * "Computing Lab F" scans from point 69 of the newest export on were really Lab E (the
 * surveyor's note), so they are placed at Lab D/E's spot. Earlier ones really are Lab C/F.
 */
export const LAB_F_RULE = {
  file: 'wifi_survey_20261013_170507.csv',
  fromPoint: 69,
  rawNames: ['Computing Lab F', 'Comouting Lab F'],
  placeAs: 'Computing Lab D',
};

/** First five of the six BSSID bytes: the radios of one physical access point share them. */
export const radioOf = (bssid) => bssid.toLowerCase().slice(0, 14);

/** RFC 4180 CSV -> array of rows (arrays of strings). Quoted fields may hold commas and newlines. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function objects(text, label, needed) {
  const [header, ...body] = parseCsv(text).filter((r) => r.some((f) => f.trim() !== ''));
  const col = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
  for (const need of needed) if (!(need in col)) throw new Error(`${label}: no "${need}" column`);
  return body.map((r) => Object.fromEntries(Object.entries(col).map(([name, i]) => [name, r[i] ?? ''])));
}

/**
 * Survey CSV text -> readings. Blank rows (the empty lines some exports end with) and rows
 * without a BSSID are skipped. `scan` is `${file}#${point_id}`: ids restart in every file, so
 * the file is part of the identity. GPS columns are never read.
 * @returns {{file:string, scan:string, point:number, time:number, spot:string, bssid:string,
 *   ssid:string, rssi:number}[]}
 */
export function readSurvey(text, file) {
  return objects(text, file, ['point_id', 'bssid', 'ssid', 'rssi', 'spot'])
    .filter((r) => r.bssid.trim())
    .map((r) => ({
      file,
      scan: `${file}#${r.point_id}`,
      point: Number(r.point_id),
      time: Date.parse(r.timestamp ?? ''),
      spot: r.spot,
      bssid: r.bssid.trim().toLowerCase(),
      ssid: r.ssid,
      rssi: Number(r.rssi),
    }));
}

/** `wifi_survey_20261013_170507.csv` -> `170507`; any other name is used whole. */
export const fileShort = (file) => file.match(/_(\d{6})\.csv$/)?.[1] ?? file;

/** `wifi_survey_20261013_170507.csv#56` -> `170507#56`: how scans are named in reports and in floor7Aps.json. */
export const shortScan = (scan) => scan.replace(/^(.*)#/, (_, file) => `${fileShort(file)}#`);

/**
 * Sets `phone` (the file's short name: each file is one phone), `part` ('morning' or
 * 'afternoon') and `session` on every reading. `session` is: the file's short name, plus " morning" or " afternoon"
 * when a gap of more than SESSION_GAP_MS inside the file splits it in two (the newest export
 * holds the morning scans 19 to 31 and the afternoon ones after). Morning is before 14:00 IST
 * (08:30 UTC). Each file is one phone.
 */
export function assignSessions(readings) {
  const byFile = new Map();
  for (const r of readings) {
    if (!byFile.has(r.file)) byFile.set(r.file, new Map());
    byFile.get(r.file).set(r.scan, r.time);
  }
  const segmentOf = new Map(); // scan -> segment index
  const segments = new Map(); // file -> segment count
  for (const [file, scans] of byFile) {
    const ordered = [...scans].sort((a, b) => a[1] - b[1]);
    let seg = 0;
    ordered.forEach(([scan, time], i) => {
      if (i > 0 && time - ordered[i - 1][1] > SESSION_GAP_MS) seg++;
      segmentOf.set(scan, seg);
    });
    segments.set(file, seg + 1);
  }
  const partOfDay = (time) => {
    const d = new Date(time);
    return d.getUTCHours() * 60 + d.getUTCMinutes() < 8 * 60 + 30 ? 'morning' : 'afternoon';
  };
  for (const r of readings) {
    r.phone = fileShort(r.file);
    r.part = partOfDay(r.time);
    r.session = segments.get(r.file) > 1 ? `${r.phone} ${r.part}` : r.phone;
  }
  return readings;
}

/**
 * The name table -> Map(raw survey name -> row). `drop` rows are scans to throw away,
 * `hold` rows are left out until the team confirms where they were taken.
 */
export function readMapping(text) {
  const rows = objects(text, 'name table', ['raw_name', 'place_id', 'plan_x', 'plan_y', 'confidence']);
  const map = new Map();
  for (const r of rows) {
    if (!r.raw_name) continue;
    map.set(r.raw_name, {
      rawName: r.raw_name,
      placeId: r.place_id,
      planName: r.plan_name,
      corridor: r.corridor,
      x: r.plan_x === '' ? null : Number(r.plan_x),
      y: r.plan_y === '' ? null : Number(r.plan_y),
      confidence: r.confidence,
      note: r.note,
      drop: r.place_id === 'DROP',
      hold: r.confidence === 'hold',
    });
  }
  return map;
}

/**
 * Gives every reading a plan spot. Scans whose name is DROPped or on HOLD are set aside,
 * and a name missing from the table is an error (a typo must not silently vanish).
 * @returns {{placed: object[], dropped: string[], held: string[]}} `placed` readings gain
 *   `place` (the spot's id), `x`, `y`; `dropped` and `held` list the scan ids.
 */
export function placeReadings(readings, mapping) {
  const placed = [];
  const dropped = new Set();
  const held = new Set();
  const unmapped = new Set();
  for (const r of readings) {
    let row = mapping.get(r.spot);
    if (!row) { unmapped.add(`${r.spot} (${r.scan})`); continue; }
    if (row.drop) { dropped.add(r.scan); continue; }
    if (row.hold) { held.add(r.scan); continue; }
    if (r.file === LAB_F_RULE.file && r.point >= LAB_F_RULE.fromPoint && LAB_F_RULE.rawNames.includes(r.spot)) {
      row = mapping.get(LAB_F_RULE.placeAs);
    }
    placed.push({ ...r, place: row.placeId, x: row.x, y: row.y });
  }
  if (unmapped.size) throw new Error(`Survey names missing from the name table: ${[...unmapped].join('; ')}`);
  return { placed, dropped: [...dropped], held: [...held] };
}

/**
 * Only campus access points: SSID on the allowlist, OR sharing the first five BSSID bytes
 * with one that is. A hidden (blank) name is often a second radio of a named SRMIST box.
 */
export function campusOnly(readings) {
  const campusRadios = new Set(readings.filter((r) => CAMPUS_SSIDS.includes(r.ssid)).map((r) => radioOf(r.bssid)));
  return readings.filter((r) => campusRadios.has(radioOf(r.bssid)));
}

// ---------------------------------------------------------------- guess items

const RESTROOMS = ['rL', 'rM', 'rNew', 'rW'];
const EAST_WING_LINES = ['east_spine', 'east_back'];

/**
 * Why a plan spot cannot be trusted as much as the rest, as plain sentences; empty when it
 * can. The team marked these as guesses: Room 702 and Room 704, all four restrooms, and the
 * east wing (drawn as a mirror of the west one). Anything else the plan itself marks `guess`
 * is flagged too.
 * @param {string} placeId a plan place id, or `between:a,b` for the midpoint of two
 * @param {object} planDoc floor7_plan.json
 * @param {Map} [mapping] the name table, for rows marked `guess` there
 */
export function guessReasons(placeId, planDoc, mapping) {
  const ids = placeId.startsWith('between:') ? placeId.slice(8).split(',') : [placeId];
  const reasons = new Set();
  for (const id of ids) {
    const place = planDoc.places.find((p) => p.id === id);
    const rows = mapping ? [...mapping.values()].filter((m) => m.placeId === id) : [];
    if (id === 'r702') reasons.add('Room 702 position is a guess');
    if (id === 'r704') reasons.add('Room 704 position is a mirror guess');
    if (RESTROOMS.includes(id)) reasons.add('restroom position is a guess');
    if (place && EAST_WING_LINES.includes(place.corridor)) reasons.add('east wing is a mirror of the west wing');
    const marked = place?.confidence === 'guess' || rows.some((m) => m.confidence === 'guess');
    if (marked && reasons.size === 0) reasons.add(`${place?.name ?? id} is marked as a guess in the plan`);
  }
  return [...reasons];
}

// ---------------------------------------------------------------- placing radios

/**
 * Places every radio at the plan spot where any of its BSSIDs was heard strongest. Within
 * TIE_DB of the runner-up spot, it sits at the midpoint of those two spots. A radio heard at
 * one spot only is flagged `single_spot`.
 *
 * @param {object[]} placed campus readings from placeReadings()
 * @param {object} [options]
 * @param {Record<string, {x?:number, y?:number, place?:string}>} [options.overrides] keyed by
 *   radio (first five BSSID bytes); a hand-set position wins over everything measured
 * @param {(reading: object) => boolean} [options.use] which readings count (default all);
 *   how the replay leaves a scan or a whole session out
 * @param {object} [options.planDoc] with `mapping`, marks anchors that rest on a guess item
 * @param {Map} [options.mapping]
 * @returns {{radio:string, x:number, y:number, place:string|null, basis:'best'|'tie'|'override',
 *   single_spot:boolean, tie?:string[], guess:string[], heard:[string, number][],
 *   bssids:{bssid:string, ssid:string}[]}[]} sorted by radio
 */
export function buildAnchors(placed, { overrides = {}, use = () => true, planDoc = null, mapping = null } = {}) {
  const spotXY = new Map();
  const radios = new Map();
  for (const r of placed) {
    if (!use(r)) continue;
    spotXY.set(r.place, [r.x, r.y]);
    const radio = radioOf(r.bssid);
    if (!radios.has(radio)) radios.set(radio, { best: new Map(), bssids: new Map() });
    const entry = radios.get(radio);
    entry.best.set(r.place, Math.max(entry.best.get(r.place) ?? -Infinity, r.rssi));
    if (!entry.bssids.has(r.bssid) || r.ssid) entry.bssids.set(r.bssid, r.ssid || entry.bssids.get(r.bssid) || '');
  }

  const reasonsFor = (place) => (planDoc ? guessReasons(place, planDoc, mapping) : []);
  const out = [];
  for (const [radio, { best, bssids }] of radios) {
    const ranked = [...best].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en'));
    const list = [...bssids].map(([bssid, ssid]) => ({ bssid, ssid })).sort((a, b) => a.bssid.localeCompare(b.bssid));
    const over = overrides[radio];
    let placedAt;
    if (over && (Number.isFinite(over.x) || over.place)) {
      const xy = over.place ? spotXY.get(over.place) : [over.x, over.y];
      if (!xy) throw new Error(`Override for ${radio} names place "${over.place}", which no scan used`);
      placedAt = { x: xy[0], y: xy[1], place: over.place ?? null, basis: 'override', guess: [] };
    } else if (ranked.length > 1 && ranked[0][1] - ranked[1][1] < TIE_DB) {
      const [a, b] = [spotXY.get(ranked[0][0]), spotXY.get(ranked[1][0])];
      placedAt = {
        x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, place: null, basis: 'tie',
        tie: [ranked[0][0], ranked[1][0]], guess: [...new Set([...reasonsFor(ranked[0][0]), ...reasonsFor(ranked[1][0])])],
      };
    } else {
      const xy = spotXY.get(ranked[0][0]);
      placedAt = { x: xy[0], y: xy[1], place: ranked[0][0], basis: 'best', guess: reasonsFor(ranked[0][0]) };
    }
    out.push({
      radio, ...placedAt,
      x: Math.round(placedAt.x * 100) / 100,
      y: Math.round(placedAt.y * 100) / 100,
      single_spot: ranked.length === 1,
      heard: ranked,
      bssids: list,
    });
  }
  return out.sort((a, b) => a.radio.localeCompare(b.radio));
}
