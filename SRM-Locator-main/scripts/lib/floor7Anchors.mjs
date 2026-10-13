// Where each Floor 7 access point sits, worked out from the survey CSVs and the hand-placed
// spot positions in src/data/floor7Map.json. Pure functions: scripts/build-floor7-aps.mjs
// does the file reading and writing, and the leave-one-scan-out check reuses anchorRadios.
//
// Why spots, not GPS: indoors the survey's GPS fixes are off by tens of metres (some are
// stale fixes 400 m away), so the spot a reading was logged at is the ground truth and the
// access point is placed at that spot's hand-placed position.

/** SSIDs that make an access point campus infrastructure. Defined once, here. */
export const CAMPUS_SSIDS = ['SRMIST', 'SRMIST-UA'];

/** Two spots whose best readings are this close (dB) share the access point between them. */
export const TIE_DB = 3;

/** Spelling variants seen in the Floor 7 survey, after normalisation (see spotKey). */
const SPOT_ALIASES = { TP706A: 'TP706' };

/** Case and spacing do not tell two spots apart: "Room703" is "Room 703". */
export const spotKey = (name) => {
  const key = String(name).toUpperCase().replace(/\s+/g, '');
  return SPOT_ALIASES[key] ?? key;
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

/**
 * Survey CSV text -> readings. Blank rows (the 175 empty lines at the end of one export) are
 * skipped. `scan` is `${fileLabel}#${point_id}`: ids restart in every file, so the file is
 * part of the identity.
 * @returns {{scan:string, spot:string, bssid:string, ssid:string, rssi:number}[]}
 */
export function readSurvey(text, fileLabel) {
  const [header, ...body] = parseCsv(text).filter((r) => r.some((f) => f.trim() !== ''));
  const col = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
  for (const need of ['point_id', 'bssid', 'ssid', 'rssi', 'spot']) {
    if (!(need in col)) throw new Error(`${fileLabel}: no "${need}" column`);
  }
  return body
    .filter((r) => r[col.bssid]?.trim())
    .map((r) => ({
      scan: `${fileLabel}#${r[col.point_id]}`,
      spot: r[col.spot],
      bssid: r[col.bssid].trim().toLowerCase(),
      ssid: r[col.ssid] ?? '',
      rssi: Number(r[col.rssi]),
    }));
}

/**
 * Only campus access points: SSID on the allowlist, OR sharing the first five BSSID bytes
 * with one that is. A hidden (blank) name is often a second radio of a named SRMIST box.
 */
export function campusOnly(readings) {
  const campusRadios = new Set(readings.filter((r) => CAMPUS_SSIDS.includes(r.ssid)).map((r) => radioOf(r.bssid)));
  return readings.filter((r) => campusRadios.has(radioOf(r.bssid)));
}

/**
 * Places every radio at the hand-placed position of the spot it was heard strongest at.
 *
 * @param {object[]} readings campus readings (see readSurvey / campusOnly)
 * @param {Record<string, [number, number]>} spots spot name -> [x, y] metres
 * @param {object} [options]
 * @param {Record<string, {x?:number, y?:number, spot?:string}>} [options.overrides] keyed by radio
 *   (first five BSSID bytes); a hand-set position wins over everything measured
 * @param {string} [options.excludeScan] leave one scan out, for the leave-one-scan-out check
 * @returns {{radio:string, x:number, y:number, spot:string|null, basis:'best'|'tie'|'single-spot'|'override',
 *   tie?:string[], bssids:{bssid:string, ssid:string}[]}[]} sorted by radio
 */
export function anchorRadios(readings, spots, { overrides = {}, excludeScan = null } = {}) {
  const byKey = new Map(Object.entries(spots).map(([name, xy]) => [spotKey(name), { name, xy }]));
  const radios = new Map(); // radio -> { spotBest: Map(spotName -> rssi), bssids: Map }
  for (const r of readings) {
    if (r.scan === excludeScan) continue;
    const spot = byKey.get(spotKey(r.spot));
    if (!spot) throw new Error(`Unknown spot "${r.spot}" (scan ${r.scan}). Add it to floor7Map.json or the aliases.`);
    const radio = radioOf(r.bssid);
    if (!radios.has(radio)) radios.set(radio, { spotBest: new Map(), bssids: new Map() });
    const entry = radios.get(radio);
    entry.spotBest.set(spot.name, Math.max(entry.spotBest.get(spot.name) ?? -Infinity, r.rssi));
    if (!entry.bssids.has(r.bssid) || r.ssid) entry.bssids.set(r.bssid, r.ssid || entry.bssids.get(r.bssid) || '');
  }

  const out = [];
  for (const [radio, { spotBest, bssids }] of radios) {
    const ranked = [...spotBest].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en'));
    const list = [...bssids].map(([bssid, ssid]) => ({ bssid, ssid })).sort((a, b) => a.bssid.localeCompare(b.bssid));
    const over = overrides[radio];
    let placed;
    if (over && (Number.isFinite(over.x) || over.spot)) {
      const xy = over.spot ? spots[over.spot] : [over.x, over.y];
      if (!xy) throw new Error(`Override for ${radio} names unknown spot "${over.spot}"`);
      placed = { x: xy[0], y: xy[1], spot: over.spot ?? null, basis: 'override' };
    } else if (ranked.length > 1 && ranked[0][1] - ranked[1][1] < TIE_DB) {
      const [a, b] = [spots[ranked[0][0]], spots[ranked[1][0]]];
      placed = { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, spot: null, basis: 'tie', tie: [ranked[0][0], ranked[1][0]] };
    } else {
      const xy = spots[ranked[0][0]];
      placed = { x: xy[0], y: xy[1], spot: ranked[0][0], basis: ranked.length === 1 ? 'single-spot' : 'best' };
    }
    out.push({ radio, ...placed, x: Math.round(placed.x * 100) / 100, y: Math.round(placed.y * 100) / 100, bssids: list });
  }
  return out.sort((a, b) => a.radio.localeCompare(b.radio));
}
