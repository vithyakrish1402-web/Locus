// Places the admin adds from inside the app (Firestore `campus_places`), as opposed to the
// ones built into srmDatabase.js. Pure helpers only - no Firebase here, so the map, the list
// and the tests can all import it. The reads and writes are in campusPlacesStore.js.
//
// A place is the same shape as a SRM_MASTER_DATABASE entry ({ id, name, category, lat, lng,
// info }) plus optional `aliases` (what students call it). Its id is `cp-<document id>`, a
// string, so it can never clash with the database's numeric ids.

/** The categories a place can have: the database's five, plus open ground that has no floors. */
export const PLACE_CATEGORIES = ['ACADEMIC', 'ENGINEERING', 'MEDICAL', 'RESIDENTIAL', 'LOGISTICS', 'GROUNDS'];

/** Open areas (grounds, the pool): no floors, no lifts, no indoor view, no AR building tag. */
export const GROUNDS = 'GROUNDS';

/** Wide enough for the whole SRM KTR campus and its edges; a pin outside it is a typo. */
export const CAMPUS_BOUNDS = { minLat: 12.8, maxLat: 12.84, minLng: 80.02, maxLng: 80.06 };

export const NAME_MAX = 60;
export const ALIAS_MAX = 40;
export const INFO_MAX = 200;
const ALIASES_MAX = 6;

export const isOnCampus = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng)
  && lat >= CAMPUS_BOUNDS.minLat && lat <= CAMPUS_BOUNDS.maxLat
  && lng >= CAMPUS_BOUNDS.minLng && lng <= CAMPUS_BOUNDS.maxLng;

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const key = (s) => clean(s).toLowerCase();

/** "Vendhar Sq, vendhar  square" -> ["Vendhar Sq", "vendhar square"]. Comma or newline separated. */
export const parseAliases = (text) => {
  const list = Array.isArray(text) ? text : String(text ?? '').split(/[,\n]/);
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const alias = clean(item).slice(0, ALIAS_MAX);
    if (alias && !seen.has(key(alias))) {
      seen.add(key(alias));
      out.push(alias);
    }
  }
  return out.slice(0, ALIASES_MAX);
};

/**
 * A Firestore document as a place, or null when it is unusable. Documents can be hand-edited in
 * the console, so a bad one is skipped rather than allowed to put a pin in the wrong country.
 */
export function toCampusPlace(docId, data) {
  const name = clean(data?.name);
  if (!docId || !name || name.length > NAME_MAX) return null;
  if (!PLACE_CATEGORIES.includes(data?.category)) return null;
  if (!isOnCampus(data?.lat, data?.lng)) return null;
  const place = {
    id: `cp-${docId}`,
    name,
    category: data.category,
    lat: data.lat,
    lng: data.lng,
    info: clean(data.info).slice(0, INFO_MAX),
    aliases: parseAliases(data.aliases),
    added: true,
  };
  return place;
}

/**
 * What the admin typed, checked: { ok: true, fields } for Firestore, or { ok: false, reason }.
 * `existing` is every place already shown, so a name can't be used twice.
 */
export function validateNewPlace({ name, category, lat, lng, info, aliases }, existing = []) {
  const n = clean(name).toUpperCase();
  if (n.length < 2) return { ok: false, reason: 'name' };
  if (n.length > NAME_MAX) return { ok: false, reason: 'nameLong' };
  if (!PLACE_CATEGORIES.includes(category)) return { ok: false, reason: 'category' };
  if (!isOnCampus(lat, lng)) return { ok: false, reason: 'offCampus' };
  const taken = new Set(existing.flatMap((p) => [p.name, ...(p.aliases ?? [])]).map(key));
  const list = parseAliases(aliases);
  if (taken.has(key(n))) return { ok: false, reason: 'duplicate' };
  if (list.some((a) => taken.has(key(a)) || key(a) === key(n))) return { ok: false, reason: 'aliasTaken' };
  return {
    ok: true,
    fields: { name: n, category, lat, lng, info: clean(info).slice(0, INFO_MAX), aliases: list },
  };
}

/**
 * The built-in places followed by the added ones. A built-in place always wins: an added place
 * that reuses a built-in name or alias is dropped, never allowed to shadow it.
 */
export function mergeCampusPlaces(base, added) {
  const taken = new Set(base.flatMap((p) => [p.name, ...(p.aliases ?? [])]).map(key));
  const out = [...base];
  for (const place of added) {
    if (taken.has(key(place.name))) continue;
    taken.add(key(place.name));
    out.push(place);
  }
  return out;
}

/** Whether a search matches the place's name or any alias. An empty search matches all. */
export function placeMatches(place, query) {
  const q = key(query);
  if (!q) return true;
  return [place?.name, ...(place?.aliases ?? [])].some((s) => key(s).includes(q));
}

/** Open ground has no floors or AR building tag; everything else is a building. */
export const isGrounds = (place) => place?.category === GROUNDS;
