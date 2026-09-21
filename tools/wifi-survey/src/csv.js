// One row per access point seen at a point. Flat on purpose: Stage 3's "strongest RSSI
// wins per BSSID" pass is then a plain group-by over bssid, no unnesting.
export const CSV_COLUMNS = [
  'point_id',
  'timestamp',
  'lat',
  'lng',
  'accuracy_m',
  'bssid',
  'ssid',
  'rssi',
  'frequency_mhz',
  // Where the point is, as tagged by the surveyor. Indoors GPS is often off by 20-40 m,
  // so these are the real ground truth there. building is an exact SRM_MASTER_DATABASE
  // name, OTHER, or empty for outdoors. floor is an integer (0 = ground, -1 = basement)
  // or empty. spot is free text.
  'building',
  'floor',
  'spot',
];

export const CSV_HEADER = CSV_COLUMNS.join(',');

/**
 * RFC 4180 field quoting. SSIDs are arbitrary user-chosen strings - commas, quotes,
 * leading spaces and even newlines all occur in the wild - so anything that could be
 * misread by a parser (or silently trimmed by one) is quoted.
 */
export function csvField(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\r\n]/.test(text) || /^\s|\s$/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

const isFiniteNumber = (n) => typeof n === 'number' && Number.isFinite(n);

/**
 * Build the CSV lines for one logged point. Throws rather than writing a malformed row:
 * a bad row in the middle of a survey is far harder to spot later than a failed tap now.
 *
 * @param {object} point
 * @param {number} point.pointId   positive integer, shared by every row of this point
 * @param {string} point.timestamp ISO-8601 UTC
 * @param {{lat:number,lng:number,accuracy:number}} point.fix
 * @param {{bssid:string,ssid:string,rssi:number,frequencyMhz:number}[]} point.aps
 * @param {{building?:string, floor?:number|null, spot?:string}} [point.tag]
 */
export function buildPointRows({ pointId, timestamp, fix, aps, tag = {} }) {
  if (!Number.isInteger(pointId) || pointId < 1) {
    throw new Error(`Invalid point_id: ${pointId}`);
  }
  if (!fix || !isFiniteNumber(fix.lat) || !isFiniteNumber(fix.lng) || !isFiniteNumber(fix.accuracy)) {
    throw new Error('GPS fix is missing lat/lng/accuracy');
  }
  if (!Array.isArray(aps) || aps.length === 0) {
    throw new Error('No access points to log');
  }
  const floor = tag.floor ?? null;
  if (floor !== null && !Number.isInteger(floor)) {
    throw new Error(`Invalid floor: ${floor}`);
  }

  const shared = [pointId, timestamp, fix.lat.toFixed(7), fix.lng.toFixed(7), fix.accuracy.toFixed(1)];
  const place = [(tag.building ?? '').trim(), floor, (tag.spot ?? '').trim()];
  return aps.map((ap) => {
    if (typeof ap.bssid !== 'string' || !ap.bssid || !isFiniteNumber(ap.rssi) || !isFiniteNumber(ap.frequencyMhz)) {
      throw new Error(`Malformed access point: ${JSON.stringify(ap)}`);
    }
    return [...shared, ap.bssid, ap.ssid ?? '', ap.rssi, ap.frequencyMhz, ...place].map(csvField).join(',');
  });
}
