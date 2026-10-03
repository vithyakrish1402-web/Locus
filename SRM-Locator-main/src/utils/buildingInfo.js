// What the "Building Info" panel (components/BuildingInfo.jsx) knows about each building,
// keyed by the building's id in srmDatabase.js. Every field is optional and a building with
// no entry is fine: the panel shows BUILDING_INFO_EMPTY_TEXT instead. Only facts that
// srmDatabase.js already states are copied here - fill in the rest from the real source,
// never from a guess. The card already shows each building's one-line `info`, so a
// description here is only for something that line doesn't say.
//
//   description  string      one or two plain sentences
//   departments  string[]    departments / what is inside
//   floors       number      storeys above ground
//   facilities   string[]    notable rooms or facilities

/** Name of the option shown to users. */
export const BUILDING_INFO_LABEL = 'Building Info';
/** Shown when a building has no extra details yet. */
export const BUILDING_INFO_EMPTY_TEXT = 'More details coming soon';

export const BUILDING_DETAILS = {
  2: { departments: ['CSE', 'IT'], floors: 15 },
  5: { departments: ['Electrical and Electronics Engineering'] },
  6: { departments: ['Mechanical Engineering'], facilities: ['PG block'] },
  8: { departments: ['Architecture'], facilities: ['Design studios', 'Drafting rooms'] },
  9: { departments: ['ECE', 'EEE', 'Mechatronics'], facilities: ['Specialised labs'] },
  10: { departments: ['Biotechnology'], facilities: ['Genetic engineering and biotechnology research'] },
  11: { departments: ['Aerospace and Aeronautical Engineering'], facilities: ['Labs'] },
  14: { facilities: ['Dental hospital'] },
  33: { departments: ['Management (MBA)'] },
};

const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const list = (v) => (Array.isArray(v) ? v.map(text).filter(Boolean) : []);

/**
 * The displayable details for a building: each field present only if it has something to
 * show, so the panel never renders an empty row or the word "undefined". `hasDetails` is
 * false when there is nothing at all, and the panel falls back to BUILDING_INFO_EMPTY_TEXT.
 */
export function buildingDetails(building, table = BUILDING_DETAILS) {
  const extra = (building && table[building.id]) || {};
  const description = text(extra.description);
  const departments = list(extra.departments);
  const facilities = list(extra.facilities);
  const floors = Number.isInteger(extra.floors) && extra.floors > 0 ? extra.floors : null;
  return {
    description,
    departments,
    facilities,
    floors,
    hasDetails: Boolean(description || departments.length || facilities.length || floors),
  };
}
