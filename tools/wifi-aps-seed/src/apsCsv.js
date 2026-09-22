// Turns the aggregated survey CSV (one row per BSSID, "strongest RSSI wins") into the
// documents written to the wifi_aps collection. Pure: no Firebase, no filesystem, so the
// whole mapping is unit tested and a dry run can show exactly what would be written.
//
// Fails closed. Any row that doesn't parse aborts the whole import with its line number,
// rather than being skipped or given a default. A silently defaulted ambiguous_floor
// would read as "trust this AP's floor", which is the one thing Stage 6 must not assume.

export const COLLECTION = 'wifi_aps';

const REQUIRED_COLUMNS = [
  'bssid',
  'ssid',
  'best_lat',
  'best_lng',
  'best_floor',
  'best_building',
  'best_rssi',
  'best_accuracy_m',
  'frequency_mhz',
  'num_sightings',
  'floors_seen',
  'ambiguous_floor',
];

const BSSID = /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/;
const INTEGER = /^-?\d+$/;

/**
 * RFC 4180: quoted fields may contain commas, quotes ("") and newlines. SSIDs are
 * user-chosen text, so any of those can appear. Returns rows with the 1-based line each
 * one started on, so errors can point at the file.
 * @param {string} text
 * @returns {{line:number, fields:string[]}[]}
 */
export function parseCsv(text) {
  const rows = [];
  let fields = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let rowLine = 1;

  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // Excel's BOM
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        if (c === '\n') line++;
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      fields.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      fields.push(field);
      rows.push({ line: rowLine, fields });
      fields = [];
      field = '';
      line++;
      rowLine = line;
    } else {
      field += c;
    }
  }
  if (inQuotes) {
    throw new Error(`Line ${rowLine}: unterminated quoted field`);
  }
  if (field !== '' || fields.length > 0) {
    fields.push(field);
    rows.push({ line: rowLine, fields });
  }
  // A blank line (the trailing newline's empty row included) is not a record.
  return rows.filter((r) => !(r.fields.length === 1 && r.fields[0] === ''));
}

// pandas writes True/False; accept the other obvious spellings, and nothing else.
function parseBool(text) {
  const t = text.trim().toLowerCase();
  if (t === 'true' || t === '1') return true;
  if (t === 'false' || t === '0') return false;
  throw new Error(`must be True or False, got "${text}"`);
}

function parseInteger(text) {
  const t = text.trim();
  if (!INTEGER.test(t)) throw new Error(`must be an integer, got "${text}"`);
  return Number(t);
}

function parseNumber(text) {
  const t = text.trim();
  const n = t === '' ? NaN : Number(t);
  if (!Number.isFinite(n)) throw new Error(`must be a number, got "${text}"`);
  return n;
}

function inRange(value, min, max) {
  if (value < min || value > max) throw new Error(`must be between ${min} and ${max}, got ${value}`);
  return value;
}

/**
 * One CSV record -> one wifi_aps document. The survey schema's outdoor convention
 * carries through: an empty building or floor means the AP was heard strongest outdoors,
 * and is stored as null.
 * @param {Record<string,string>} row values keyed by header name
 */
export function toApDoc(row) {
  const field = (column, parse) => {
    try {
      return parse(row[column]);
    } catch (e) {
      throw new Error(`${column} ${e.message}`);
    }
  };

  const bssid = field('bssid', (t) => {
    const b = t.trim().toLowerCase(); // the scan plugin reports lowercase; lookups must match
    if (!BSSID.test(b)) throw new Error(`is not a MAC address: "${t}"`);
    return b;
  });
  const floor = field('best_floor', (t) => (t.trim() === '' ? null : parseInteger(t)));
  const floorsSeen = field('floors_seen', (t) =>
    t.trim() === '' ? [] : t.split('|').map((part) => parseInteger(part))
  );
  if (floor !== null && !floorsSeen.includes(floor)) {
    // The strongest sighting's floor is one of the floors it was seen on, by construction.
    // If it isn't, the columns are misaligned and every value on this row is suspect.
    throw new Error(`best_floor ${floor} is not in floors_seen [${floorsSeen.join(', ')}]`);
  }

  return {
    bssid,
    ssid: row.ssid, // "" for hidden networks; kept verbatim, spaces and all
    lat: field('best_lat', (t) => inRange(parseNumber(t), -90, 90)),
    lng: field('best_lng', (t) => inRange(parseNumber(t), -180, 180)),
    floor,
    building: row.best_building.trim() === '' ? null : row.best_building.trim(),
    rssi: field('best_rssi', (t) => inRange(parseInteger(t), -127, 0)),
    accuracyM: field('best_accuracy_m', (t) => inRange(parseNumber(t), 0, Infinity)),
    frequencyMhz: field('frequency_mhz', (t) => inRange(parseInteger(t), 1, Infinity)),
    numSightings: field('num_sightings', (t) => inRange(parseInteger(t), 1, Infinity)),
    floorsSeen,
    ambiguousFloor: field('ambiguous_floor', parseBool),
  };
}

/**
 * @param {string} text the whole CSV file
 * @returns {{docs: object[], errors: string[]}} docs is only meaningful when errors is empty
 */
export function parseApsCsv(text) {
  const [header, ...records] = parseCsv(text);
  if (!header) return { docs: [], errors: ['The file is empty'] };

  const columns = header.fields.map((name) => name.trim());
  const missing = REQUIRED_COLUMNS.filter((name) => !columns.includes(name));
  if (missing.length > 0) {
    return { docs: [], errors: [`Missing column(s): ${missing.join(', ')}`] };
  }

  const docs = [];
  const errors = [];
  const firstLineFor = new Map();
  for (const { line, fields } of records) {
    if (fields.length !== columns.length) {
      errors.push(`Line ${line}: expected ${columns.length} fields, found ${fields.length}`);
      continue;
    }
    const row = Object.fromEntries(columns.map((name, i) => [name, fields[i]]));
    let doc;
    try {
      doc = toApDoc(row);
    } catch (e) {
      errors.push(`Line ${line}: ${e.message}`);
      continue;
    }
    // The BSSID is the document ID. A second row for it would silently replace the first
    // mid-import, so the CSV must already be one row per AP.
    if (firstLineFor.has(doc.bssid)) {
      errors.push(`Line ${line}: duplicate bssid ${doc.bssid} (first on line ${firstLineFor.get(doc.bssid)})`);
      continue;
    }
    firstLineFor.set(doc.bssid, line);
    docs.push(doc);
  }
  if (records.length === 0) errors.push('The file has a header but no rows');
  return { docs, errors };
}

/** What the completion log reports, computed the same way for dry and real runs. */
export function summarize(docs) {
  const byFloor = new Map();
  for (const d of docs) {
    const key = d.floor === null ? 'outdoors' : `floor ${d.floor}`;
    byFloor.set(key, (byFloor.get(key) ?? 0) + 1);
  }
  return {
    total: docs.length,
    ambiguousFloor: docs.filter((d) => d.ambiguousFloor).length,
    byFloor: Object.fromEntries([...byFloor].sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))),
  };
}
