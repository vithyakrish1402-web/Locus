// The Floor 7 phone walk: error in metres per door.
//
//   node scripts/floor7-phone-walk.mjs doors.csv phone.log [--date 2026-10-14] [--csv errors.csv]
//
// doors.csv is what you write while walking, one line per door, the clock time you got there:
//
//   door,time
//   Room 701,16:47:10
//   Lift lobby A,16:51
//   Room 706A,16:58:30,90        (an optional third column: seconds you stood there, default 75)
//
// phone.log is the console output the test build prints, one "[F7] {...}" line per estimate:
//
//   adb logcat -d -s Capacitor/Console > phone.log
//
// Times are the clock of the computer running this, on the day of the walk (--date, or the
// day of the first estimate in the log). Use the phone's own clock to note the times.
// The error is a WALK along the corridors from what the app showed to the door, plus the
// straight-line distance and the same for the raw estimate, so you can see what the filter did.
// See FLOOR7_TEST.md for the whole procedure. Not part of any app build.

import './lib/registerShims.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMapping } from './lib/floor7Anchors.mjs';
import { formatWalk, parseDoors, parseFixLog, resolveDoor, scoreDoors } from './lib/floor7PhoneWalk.mjs';

const { PLAN_SCALE, floor7Plan } = await import('../src/utils/floor7Plan.js');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return null;
  const [, value] = args.splice(i, 2);
  return value;
};
const date = flag('--date');
const csvOut = flag('--csv');
const [doorsFile, logFile] = args;
if (!doorsFile || !logFile) {
  console.error('usage: node scripts/floor7-phone-walk.mjs doors.csv phone.log [--date YYYY-MM-DD] [--csv errors.csv]');
  process.exit(2);
}

try {
  const planDoc = JSON.parse(readFileSync(join(root, 'floor7-inputs', 'floor7_plan.json'), 'utf8'));
  const mapping = readMapping(readFileSync(join(root, 'floor7-inputs', 'survey_name_to_plan_spot.csv'), 'utf8'));
  const fixes = parseFixLog(readFileSync(logFile, 'utf8'));
  if (fixes.length === 0) throw new Error(`no "[F7] {...}" lines in ${logFile}. Was it saved right after the walk, with the LOCUS Test app open, signed in as the owner, in a squad?`);
  const doors = parseDoors(readFileSync(doorsFile, 'utf8'));

  const d = date ? date.split('-').map(Number) : null;
  const first = new Date(fixes[0].at);
  const day = d ?? [first.getFullYear(), first.getMonth() + 1, first.getDate()];

  const rows = scoreDoors({
    doors, fixes, day, plan: floor7Plan, scale: PLAN_SCALE,
    resolve: (name) => resolveDoor(name, planDoc, mapping),
  });
  console.log(`${fixes.length} estimates in the log, ${new Date(fixes[0].at).toLocaleTimeString()} to ${new Date(fixes.at(-1).at).toLocaleTimeString()}; walk on ${day.join('-')}; PLAN_SCALE ${PLAN_SCALE}\n`);
  console.log(formatWalk(rows));
  if (csvOut) {
    const header = 'door,place,shown,status,fixes_in_window,seconds_in,walk_error_m,straight_error_m,raw_walk_error_m';
    const body = rows.map((r) => [r.door, r.place, r.shown, r.status, r.fixesInWindow, r.shown ? r.secondsIn.toFixed(0) : '', r.shown ? r.walkM.toFixed(2) : '', r.shown ? r.straightM.toFixed(2) : '', r.shown ? r.rawWalkM.toFixed(2) : ''].map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(','));
    writeFileSync(csvOut, `${[header, ...body].join('\n')}\n`);
    console.log(`\nwrote ${csvOut}`);
  }
} catch (e) {
  console.error(`\n  phone walk: ${e.message}\n`);
  process.exit(1);
}
