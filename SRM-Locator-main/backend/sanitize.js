// What the server is willing to repeat to a whole Group, made safe first.
//
// Everything a phone sends is a claim. These helpers turn a claim into something safe to relay
// or store: a name cut to length with control and direction-flipping characters removed, a photo
// link only from hosts the app really uses, and the few fields of a route, zone or geofence
// alert the app really sends, each checked. Unknown fields are dropped, never an error.

export const MAX_NAME_LENGTH = 40; // a person's display name, cut to this
export const MAX_PHOTO_URL_LENGTH = 2048;
// The only places a profile picture may come from. Anywhere else is a tracking pixel: its owner
// would see the address of everyone in the Group who opens it. api.dicebear.com makes the avatar
// the app gives every new sign-up; Google sign-in hands out lh3-lh6 pictures. Exact host names.
export const ALLOWED_PHOTO_HOSTS = Object.freeze([
  'api.dicebear.com',
  'lh3.googleusercontent.com',
  'lh4.googleusercontent.com',
  'lh5.googleusercontent.com',
  'lh6.googleusercontent.com',
]);
export const MAX_ROUTE_POINTS = 2000; // a custom route is refused whole above this (the app's 100 KB limit allows about 2500)
export const MAX_ZONE_POINTS = 200;   // corners of a drawn zone

// Control characters, zero-width and direction-override characters: none belong in a name, and
// the last kind can make one read backwards or hide text next to it.
// Written as ranges of code points (not a regex literal full of invisible characters) so the
// list can be read: C0/C1 controls, soft hyphen, Arabic letter mark, zero-width and direction
// marks and overrides (U+200B-200F, 2028-202E, 2060-206F), and the byte-order mark.
const HIDDEN_RANGES = [[0x00, 0x1f], [0x7f, 0x9f], [0xad, 0xad], [0x61c, 0x61c], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x206f], [0xfeff, 0xfeff]];
const hex4 = (code) => code.toString(16).padStart(4, '0');
const HIDDEN_CHARACTERS = new RegExp(`[${HIDDEN_RANGES.map(([from, to]) => `\\u${hex4(from)}-\\u${hex4(to)}`).join('')}]`, 'g');

export const cleanText = (value, max) => {
  if (typeof value !== 'string') return null;
  const text = value.replace(HIDDEN_CHARACTERS, '').trim().slice(0, max);
  return text || null;
};
export const cleanName = (name, max = MAX_NAME_LENGTH) => cleanText(name, max);

/** The link itself when it is https, on an allowed host (exact match on the parsed host name),
 *  with no user name, password or port; otherwise null. */
export function cleanPhoto(url, hosts = ALLOWED_PHOTO_HOSTS) {
  if (typeof url !== 'string' || url.length > MAX_PHOTO_URL_LENGTH) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return null;
  return hosts.includes(parsed.hostname) ? parsed.href : null;
}

export const isRealCoordinate = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// A list of { lat, lng }: every point real, at most `max` of them, else null.
function cleanPoints(points, max, min = 0) {
  if (!Array.isArray(points) || points.length < min || points.length > max) return null;
  const clean = [];
  for (const point of points) {
    if (!isObject(point) || !isRealCoordinate(point.lat, point.lng)) return null;
    clean.push({ lat: point.lat, lng: point.lng });
  }
  return clean;
}

/** 'publish-custom-route': { key, data: { distance, eta, path } } or null when it is no route.
 *  The app sends { roomCode, key, data }; receivers read key and data only. */
export function cleanRoute(payload) {
  if (!isObject(payload)) return null;
  const key = cleanText(payload.key, 100);
  const data = isObject(payload.data) ? payload.data : null;
  const path = data ? cleanPoints(data.path, MAX_ROUTE_POINTS, 2) : null;
  if (!key || !path) return null;
  return {
    key,
    data: {
      distance: cleanText(data.distance, 20) ?? 'CUSTOM',
      eta: cleanText(data.eta, 20) ?? 'TACTICAL',
      path,
    },
  };
}

/** 'publish-zone': the zone itself as relayed ('new-zone'), or null. The shipped app no longer
 *  sends or listens for zones; this keeps older builds working with only these fields. */
export function cleanZone(zone) {
  if (!isObject(zone)) return null;
  const clean = {};
  const id = cleanText(typeof zone.id === 'number' ? String(zone.id) : zone.id, 64);
  const name = cleanText(zone.name, 80);
  const color = cleanText(zone.color, 16);
  if (id) clean.id = id;
  if (name) clean.name = name;
  if (color) clean.color = color;
  if (zone.lat !== undefined || zone.lng !== undefined) {
    if (!isRealCoordinate(zone.lat, zone.lng)) return null;
    clean.lat = zone.lat;
    clean.lng = zone.lng;
  }
  if (zone.radius !== undefined) {
    if (!Number.isFinite(zone.radius) || zone.radius < 0 || zone.radius > 100_000) return null;
    clean.radius = zone.radius;
  }
  if (zone.points !== undefined) {
    const points = cleanPoints(zone.points, MAX_ZONE_POINTS);
    if (!points) return null;
    clean.points = points;
  }
  return Object.keys(clean).length > 0 ? clean : null;
}

/** 'geofence-alert': what the Group is told. The person's name is the server's record of them
 *  (`userName`), never the one the sender put in the message. */
export function cleanGeofenceAlert(data, userName) {
  if (!isObject(data)) return null;
  const type = cleanText(data.type, 16);
  const zoneName = cleanText(data.zoneName, 80);
  if (!type || !zoneName) return null;
  const alert = { type: type.toUpperCase(), zoneName, userName: userName ?? null };
  if (data.lat !== undefined || data.lng !== undefined) {
    if (!isRealCoordinate(data.lat, data.lng)) return null;
    alert.lat = data.lat;
    alert.lng = data.lng;
  }
  if (Number.isFinite(data.timestamp)) alert.timestamp = data.timestamp;
  return alert;
}
