import { SRM_MASTER_DATABASE } from './srmDatabase';

// AR Scan's landmark data: what the Landmark Anchor Engine needs about each building on
// top of SRM_MASTER_DATABASE (which the map, the info panel and search share). Correct an
// anchor here, never in the engine. Keyed by the building's id in SRM_MASTER_DATABASE,
// with its `name` alongside: an entry applies only where the name matches too, so a
// renumbered or reused id never hands one building another's height.
//
//   heightM        the building's height in metres. Unknown ones get the engine's
//                  DEFAULT_BUILDING_HEIGHT_M (15). The tag sits HEIGHT_ANCHOR_RATIO (0.6)
//                  of the way up.
//   entrance       { lat, lng }: when set, the tag anchors on the entrance instead of the
//                  building's centre point.
//   anchorOffsetM  { east, north } in metres: a nudge for an anchor that sits a little
//                  off the building in the camera (measured on campus).
//
// Nothing below is measured yet. Heights from a floor count are floors x 3.5 m.
export const AR_LANDMARK_OVERRIDES = {
  2: { name: 'TECH PARK', heightM: 52 }, // "15 floors" (its info text); estimate, verify on campus
};

const isPoint = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng);

/**
 * The engine's landmark list from SRM_MASTER_DATABASE entries (or any list shaped like it)
 * and the overrides: [{ id, kind: 'building', name, lat, lng, heightM, anchorOffsetM,
 * footprint }]. `id` is `building-<db id>`; lat/lng is the entrance when one is marked,
 * otherwise the database's centre point. heightM is null when unknown (the engine's
 * default applies). Entries without a position are left out.
 */
export const buildArLandmarks = (buildings = SRM_MASTER_DATABASE, overrides = AR_LANDMARK_OVERRIDES) =>
  buildings
    .filter(isPoint)
    .map((b) => {
      const entry = overrides[b.id];
      const o = entry && (!entry.name || entry.name === b.name) ? entry : {};
      const anchor = isPoint(o.entrance) ? o.entrance : b;
      return {
        id: `building-${b.id}`,
        kind: 'building',
        name: b.name,
        lat: anchor.lat,
        lng: anchor.lng,
        heightM: Number.isFinite(o.heightM) ? o.heightM : null,
        anchorOffsetM: o.anchorOffsetM ?? null,
        footprint: Array.isArray(b.footprint) ? b.footprint : null,
      };
    });
