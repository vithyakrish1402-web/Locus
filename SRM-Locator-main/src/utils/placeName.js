// A place's name as the screen shows it. The campus data stores most names in capitals ("TECH
// PARK 2", "C V RAMAN BLOCK"), and those are left exactly as stored (the Firestore places are a
// teammate's to manage): only what is drawn changes. A name already in mixed case was written
// that way on purpose, so it is shown as it is.

/** Words kept exactly as written: initials and short names said letter by letter. */
export const PLACE_NAME_KEEP = new Set([
  'SRM', 'SRMIST', 'KTR', 'MBA', 'BBA', 'TP', 'TP2', 'ESB', 'MEB', 'BEL', 'SOBE', 'ASRL', 'CSE',
  'IT', 'ECE', 'EEE', 'CV', 'PG', 'UG', 'OG', 'ATM', 'AI', 'ML', 'IOT', 'MBBS', 'BDS', 'NCC', 'NSS',
  'VIP', 'ACM', 'SIGKDD', 'HDFC', 'SVS', 'APJ', 'STP', 'PF',
]);

/** Words with a casing of their own. */
const SPELLED = { IMAC: 'iMac', FABLAB: 'FabLab' };

// Little words that stay small inside a name ("School of Architecture"), never as its first word.
const SMALL = new Set(['OF', 'AND', 'THE', 'FOR', 'IN', 'AT', 'ON', 'TO', 'BY']);

function word(token, first) {
  if (!/[A-Z]/.test(token)) return token; // numbers, "&", punctuation
  // Brackets and the like around a word: "(ESB)", "(HANGAR)".
  const [, lead, core, tail] = token.match(/^([^A-Z0-9]*)(.*?)([^A-Z0-9]*)$/);
  if (!core) return token;
  // Initials ("C", "N", "T.P."), anything with a digit ("TP2"), and the kept words stay as written.
  if (core.length === 1 || /[.\d]/.test(core) || PLACE_NAME_KEEP.has(core)) return token;
  if (SPELLED[core]) return `${lead}${SPELLED[core]}${tail}`;
  if (!first && !lead && SMALL.has(core)) return `${lead}${core.toLowerCase()}${tail}`;
  // "HI-TECH" → "Hi-Tech": each part of a hyphenated word.
  const cased = core.split('-').map((part) => (PLACE_NAME_KEEP.has(part) || part.length <= 1 ? part : part[0] + part.slice(1).toLowerCase())).join('-');
  return `${lead}${cased}${tail}`;
}

/** "TECH PARK 2" → "Tech Park 2", "C V RAMAN BLOCK" → "C V Raman Block"; mixed case as it is. */
export function displayPlaceName(name) {
  if (typeof name !== 'string' || !name) return name ?? '';
  if (/[a-z]/.test(name)) return name;
  return name.split(/(\s+)/).map((token, i) => (/^\s+$/.test(token) ? token : word(token, i === 0))).join('');
}
