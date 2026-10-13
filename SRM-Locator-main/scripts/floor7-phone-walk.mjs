// The Floor 7 phone walk: error in metres per door.
//
// From a recording made in the app (LOCUS Test, F7 panel, Start recording ... Stop):
//
//   node scripts/floor7-phone-walk.mjs floor7_20261014_164710_estimates.csv [--csv errors.csv]
//
// It finds the matching _doors.csv next to the estimates file (or name it second). The app's
// door marks carry exact times, so there is no clock to compare and no --date.
//
// The older way still works: a doors file you wrote by hand and the phone's log.
//
//   node scripts/floor7-phone-walk.mjs doors.csv phone.log [--date 2026-10-14] [--csv errors.csv]
//
// doors.csv, one line per door, the clock time you got there:
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
// Either way the error is a WALK along the corridors from what the app showed to the door, plus
// the straight-line distance and the same for the raw estimate, so you can see what the filter
// did. See FLOOR7_TEST.md for the whole procedure. Not part of any app build.

import './lib/registerShims.mjs';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMapping } from './lib/floor7Anchors.mjs';
import { formatWalk, parseDoors, parseFixLog, resolveDoor, scoreDoors } from './lib/floor7PhoneWalk.mjs';
import { looksLikeEstimates, looksLikeMarks, reportFromFiles } from './lib/floor7Recording.mjs';

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
let [first, second] = args;
if (!first) {
  console.error('usage: node scripts/floor7-phone-walk.mjs <id>_estimates.csv [<id>_doors.csv] [--csv errors.csv]\n       node scripts/floor7-phone-walk.mjs doors.csv phone.log [--date YYYY-MM-DD] [--csv errors.csv]');
  process.exit(2);
}

const csvField = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);
const writeErrors = (rows) => {
  if (!csvOut) return;
  const header = 'door,place,shown,status,fixes_in_window,seconds_in,walk_error_m,straight_error_m,raw_walk_error_m';
  const body = rows.map((r) => [r.door, r.place, r.shown, r.status, r.fixesInWindow, r.shown ? r.secondsIn.toFixed(0) : '', r.shown ? r.walkM.toFixed(2) : '', r.shown ? r.straightM.toFixed(2) : '', r.shown ? r.rawWalkM.toFixed(2) : ''].map(csvField).join(','));
  writeFileSync(csvOut, `${[header, ...body].join('\n')}\n`);
  console.log(`\nwrote ${csvOut}`);
};

try {
  const planDoc = JSON.parse(readFileSync(join(root, 'floor7-inputs', 'floor7_plan.json'), 'utf8'));
  const text = (f) => readFileSync(f, 'utf8');
  // The two files can be given in either order: what is in them says which is which.
  if (second && looksLikeMarks(text(first)) && looksLikeEstimates(text(second))) [first, second] = [second, first];

  if (looksLikeEstimates(text(first))) {
    // A recording from the app.
    const marksFile = second ?? first.replace(/_estimates\.csv$/, '_doors.csv');
    if (marksFile === first || !existsSync(marksFile)) throw new Error(`no doors file to go with ${first}. Name it as the second argument (it ends in _doors.csv).`);
    const report = reportFromFiles({ estimatesText: text(first), marksText: text(marksFile), plan: floor7Plan, scale: PLAN_SCALE, doc: planDoc });
    const { fixes } = report;
    console.log(`${fixes.length} estimates in the recording, ${new Date(fixes[0]?.at ?? 0).toLocaleTimeString()} to ${new Date(fixes.at(-1)?.at ?? 0).toLocaleTimeString()}; PLAN_SCALE ${PLAN_SCALE}\n`);
    console.log(report.text);
    writeErrors(report.doorRows);
  } else {
    // The older way: a hand-written doors file and the phone's log.
    const [doorsFile, logFile] = [first, second];
    if (!logFile) throw new Error("give the phone log as the second argument, or a recording's _estimates.csv as the first");
    const mapping = readMapping(readFileSync(join(root, 'floor7-inputs', 'survey_name_to_plan_spot.csv'), 'utf8'));
    const fixes = parseFixLog(text(logFile));
    if (fixes.length === 0) throw new Error(`no "[F7] {...}" lines in ${logFile}. Was it saved right after the walk, with the LOCUS Test app open, signed in as the owner, in a squad?`);
    const doors = parseDoors(text(doorsFile));

    const d = date ? date.split('-').map(Number) : null;
    const firstFix = new Date(fixes[0].at);
    const day = d ?? [firstFix.getFullYear(), firstFix.getMonth() + 1, firstFix.getDate()];

    const rows = scoreDoors({
      doors, fixes, day, plan: floor7Plan, scale: PLAN_SCALE,
      resolve: (name) => resolveDoor(name, planDoc, mapping),
    });
    console.log(`${fixes.length} estimates in the log, ${new Date(fixes[0].at).toLocaleTimeString()} to ${new Date(fixes.at(-1).at).toLocaleTimeString()}; walk on ${day.join('-')}; PLAN_SCALE ${PLAN_SCALE}\n`);
    console.log(formatWalk(rows));
    writeErrors(rows);
  }
} catch (e) {
  console.error(`\n  phone walk: ${e.message}\n`);
  process.exit(1);
}
