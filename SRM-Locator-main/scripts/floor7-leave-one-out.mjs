// The Floor 7 leave-one-scan-out report.
//
//   node scripts/floor7-leave-one-out.mjs
//
// Replays the survey through the REAL estimator (src/utils/wifiPositioning.js) and the REAL
// plan (src/utils/floor7Plan.js), and writes floor7-reports/leave_one_scan_out.md. All of it
// is a simulation on the survey data: no phone is involved. See scripts/lib/floor7Replay.mjs.
//
//   1. leave-one-scan-out: each scan is estimated from anchors built without it;
//   2. the same, split by session (the phones read signal strength differently);
//   3. anchors built from one session, tested on another (the realistic numbers);
//   4. with and without the radios weaker than MIN_ANCHOR_BEST_DBM, and which setting is kept;
//   5. the afternoon scans replayed in time order as a walk through the position filter.

import './lib/registerShims.mjs';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIN_ANCHOR_BEST_DBM, assignSessions, buildAnchors, campusOnly, placeReadings, readMapping, readSurvey, shortScan } from './lib/floor7Anchors.mjs';
import { walkingMidpoint } from './lib/floor7DrawnPlan.mjs';
import { blindGuessWalk, compareWalk, evaluate, groupBy, scansOf, stats, walkReplay } from './lib/floor7Replay.mjs';

const { estimatePosition } = await import('../src/utils/wifiPositioning.js');
const { PLAN_SCALE, floor7Plan: plan } = await import('../src/utils/floor7Plan.js');
const { accessPointTable } = await import('../src/utils/floor7ApTable.js');
const { toLocal } = await import('../src/utils/floor7Frame.js');
const { createPositionFilter } = await import('../src/utils/positionFilter.js');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const INPUTS = join(root, 'floor7-inputs');
const OUT_DIR = process.env.FLOOR7_REPORT_DIR ?? join(root, 'floor7-reports'); // the tests point this at a temp folder

const planDoc = JSON.parse(readFileSync(join(INPUTS, 'floor7_plan.json'), 'utf8'));
const mapping = readMapping(readFileSync(join(INPUTS, 'survey_name_to_plan_spot.csv'), 'utf8'));
const files = readdirSync(INPUTS).filter((f) => /^wifi_survey_.*\.csv$/.test(f)).sort();
const raw = assignSessions(files.flatMap((f) => readSurvey(readFileSync(join(INPUTS, f), 'utf8'), basename(f))));
const { placed, dropped, held } = placeReadings(raw, mapping);
const campus = campusOnly(placed);
const scans = scansOf(placed);
const all = [...scans.values()];

// ------------------------------------------------------------ the estimate

// Anchors are in plan metres as drawn; accessPointTable applies PLAN_SCALE, exactly as the app
// does, and toLocal brings the estimate back in real metres, the plan's own unit.
const estimate = (scan, radios) => {
  const e = estimatePosition([scan.readings], accessPointTable(radios, PLAN_SCALE));
  return e.lat === null ? null : { ...toLocal(e.lat, e.lng), confidence: e.confidence };
};
const midpoint = walkingMidpoint(planDoc);
const run = (anchorOptions) => (tests, trainFor) =>
  evaluate({ tests, campus, trainFor, estimate, plan, scale: PLAN_SCALE, planDoc, mapping, anchorOptions });

/** The WiFi staleness constant (WIFI_ESTIMATE_MAX_AGE_MS = 2 scan intervals); a test pins them equal. */
const STALE_MS = 70_000;

// ------------------------------------------------------------ labels and formatting

const placeName = (id) => {
  if (id.startsWith('between:')) return `between ${id.slice(8).split(',').map(placeName).join(' and ')}`;
  return planDoc.places.find((p) => p.id === id)?.name ?? id;
};
const m = (v) => (v === undefined || v === null ? '-' : `${v.toFixed(1)} m`);
const pct = (v) => `${Math.round(v * 100)}%`;
const statsRow = (label, s) =>
  s.estimated === 0
    ? `| ${label} | ${s.scans} | ${s.noEstimate} | - | - | - | - | - | - |`
    : `| ${label} | ${s.scans} | ${s.noEstimate} | ${m(s.median)} | ${m(s.mean)} | ${m(s.p90)} | ${m(s.max)} | ${pct(s.within5)} | ${pct(s.within10)} |`;
const HEAD = '| group | scans | no estimate | median | mean | 90th pct | worst | within 5 m | within 10 m |\n|---|---|---|---|---|---|---|---|---|';

// ------------------------------------------------------------ the analysis, once per setting

const isPhone = (...ids) => (s) => ids.includes(s.phone);
const SPLITS = [
  { name: 'morning (all three phones) -> afternoon', train: (s) => s.part === 'morning', test: (s) => s.part === 'afternoon' },
  { name: 'afternoon -> morning (all three phones)', train: (s) => s.part === 'afternoon', test: (s) => s.part === 'morning' },
  { name: 'third phone, morning -> third phone, afternoon', train: (s) => s.phone === '170507' && s.part === 'morning', test: (s) => s.phone === '170507' && s.part === 'afternoon' },
  { name: 'third phone, afternoon -> third phone, morning', train: (s) => s.phone === '170507' && s.part === 'afternoon', test: (s) => s.phone === '170507' && s.part === 'morning' },
  { name: 'the other two phones -> third phone (both parts)', train: isPhone('115710', '120055'), test: isPhone('170507') },
  { name: 'third phone (both parts) -> the other two phones', train: isPhone('170507'), test: isPhone('115710', '120055') },
];

function analyse(anchorOptions) {
  const go = run(anchorOptions);
  const loo = go(all, (scan) => (r) => r.scan !== scan.scan);
  const crossResults = SPLITS.map((sp) => {
    const trainScans = new Set(all.filter(sp.train).map((s) => s.scan));
    const tests = all.filter(sp.test);
    const rows = go(tests, () => (r) => trainScans.has(r.scan));
    const trainPlaces = new Set(all.filter(sp.train).map((s) => s.place));
    return { ...sp, rows, trainCount: trainScans.size, unseen: [...new Set(tests.filter((t) => !trainPlaces.has(t.place)).map((t) => t.place))] };
  });
  const anchors = buildAnchors(campus, { ...anchorOptions, planDoc, mapping });
  return { anchorOptions, loo, crossResults, anchors };
}

const WITHOUT = analyse({ midpoint, minBestDbm: -Infinity });
const WITH = analyse({ midpoint, minBestDbm: MIN_ANCHOR_BEST_DBM });

const looMean = (a) => stats(a.loo).mean;
/** A cut must lower the leave-one-out mean error by at least this much (m) to be kept. */
const MEANINGFUL_GAIN_M = 0.05;
/**
 * Over the cross-session tests, on the scans BOTH settings produce an estimate for (a setting
 * that gives up on more scans must not look better for it): mean walking error each, and how
 * many scans only one of them could estimate.
 */
const crossPaired = () => {
  const pairs = WITH.crossResults.flatMap((c, i) => c.rows.map((r, j) => [WITHOUT.crossResults[i].rows[j], r]));
  const both = pairs.filter(([a, b]) => a.walk !== null && b.walk !== null);
  const mean = (xs) => xs.reduce((x, y) => x + y, 0) / xs.length;
  return {
    scans: pairs.length,
    both: both.length,
    without: mean(both.map(([a]) => a.walk)),
    with: mean(both.map(([, b]) => b.walk)),
    onlyWithout: pairs.filter(([a, b]) => a.walk !== null && b.walk === null).length,
    onlyWith: pairs.filter(([a, b]) => a.walk === null && b.walk !== null).length,
  };
};
// The kept setting: the cut is kept only if it lowers the mean leave-one-out walking error by
// MEANINGFUL_GAIN_M or more. Otherwise there is no case for throwing evidence away.
const KEEP_FILTER = looMean(WITHOUT) - looMean(WITH) >= MEANINGFUL_GAIN_M;
const CHOSEN = KEEP_FILTER ? WITH : WITHOUT;
const { loo, crossResults, anchors } = CHOSEN;

const perPlace = groupBy(loo, (r) => r.place);
const scansPerPlace = new Map([...perPlace].map(([p, rows]) => [p, rows.length]));
const sessionsPerPlace = new Map([...perPlace].map(([p, rows]) => [p, new Set(rows.map((r) => r.session))]));
const multi = loo.filter((r) => scansPerPlace.get(r.place) > 1);
const single = loo.filter((r) => scansPerPlace.get(r.place) === 1);
const oneSession = loo.filter((r) => scansPerPlace.get(r.place) > 1 && sessionsPerPlace.get(r.place).size === 1);
const blind = blindGuessWalk(scans, plan, PLAN_SCALE);

// ------------------------------------------------------------ 5. the afternoon as a walk

const afternoon = loo.filter((r) => r.part === 'afternoon' && r.phone === '170507');
const walk = walkReplay({
  rows: afternoon, scans, plan, scale: PLAN_SCALE,
  makeFilter: () => createPositionFilter({ staleMs: STALE_MS, plan }),
});
const walkSummary = compareWalk(walk);

// ------------------------------------------------------------ the report

const out = [];
const w = (...lines) => out.push(...lines);
const sessionNames = [...new Set(all.map((s) => s.session))];

w('# Floor 7: leave-one-scan-out report', '',
  `Generated by \`node scripts/floor7-leave-one-out.mjs\`. **A simulation on the survey data; nothing here involved a phone.** Errors are *walking* distance in metres from the estimate (snapped onto the nearest corridor) to the plan spot the scan was taken at. PLAN_SCALE = ${PLAN_SCALE}.`, '',
  '## What went in', '',
  `- ${files.length} survey files, ${raw.length} readings, ${all.length} scans used, ${campus.length} campus readings, ${anchors.length} access points (radios).`,
  `- Dropped: ${dropped.map(shortScan).join(', ') || 'none'} (Room 707 does not exist).`,
  `- Held back until the team confirms where they were taken: ${held.map(shortScan).join(', ') || 'none'}.`,
  `- "Computing Lab F" scans from point 69 of file 170507 on are treated as Lab E (Lab D/E's spot).`,
  `- Sessions (each file is one phone; the newest file is split into its morning and afternoon scans):`,
  ...sessionNames.map((s) => `  - ${s}: ${all.filter((x) => x.session === s).length} scans`),
  `- For scale: a blind guess of "some surveyed spot" would be wrong by about ${m(blind.mean)} on average (${blind.spots} spots, median ${m(blind.median)}).`, '');

w('## How to read these numbers', '',
  '- **Leave-one-scan-out (sections 1 and 2) is optimistic.** Scans at one spot are near-duplicates: the same person standing in the same place a minute apart, so leaving one out still leaves its twins in the training set. Read it as a best case.',
  '- **The cross-session rows (section 3) are the realistic ones.** There the test scans are not in the training set at all, and the anchors come from another time and often another phone.', '');

w('## 1. Leave one scan out (best case)', '', 'Each scan is estimated from anchors built from every OTHER scan.', '', HEAD,
  statsRow('all scans', stats(loo)),
  statsRow('spots with two or more scans', stats(multi)),
  statsRow('spots with exactly ONE scan (its anchors are gone when it is left out)', stats(single)),
  statsRow('spots whose scans all came from one session', stats(oneSession)), '');

w('### Spots with exactly one scan, listed separately', '', '| spot | session | walking error | radios matched | guess spot? |', '|---|---|---|---|---|');
for (const r of single) w(`| ${placeName(r.place)} | ${r.session} | ${m(r.walk)} | ${r.matchedRadios} | ${r.truthIsGuess ? 'yes' : 'no'} |`);
w('');
const r704 = loo.filter((r) => r.place === 'r704');
w('### Room 704', '', `Room 704's position is a mirror guess and it has ${r704.length} scan(s), ${[...new Set(r704.map((r) => r.session))].join(', ')} only. ` +
  (r704.length ? r704.map((r) => `${shortScan(r.scan)}: ${r.walk === null ? 'no estimate' : m(r.walk)} (${r.matchedRadios} radios matched, ${r.anchorsForPlace} anchored at 704 once it is left out)`).join('; ') + '.' : ''), '');

w('## 2. Split by session', '', 'The three phones read signal strength differently, and the morning and afternoon differ in who was around.', '', HEAD);
for (const [s, rows] of groupBy(loo, (r) => r.session)) w(statsRow(s, stats(rows)));
w('', 'Morning vs afternoon:', '', HEAD, statsRow('morning', stats(loo.filter((r) => r.part === 'morning'))), statsRow('afternoon', stats(loo.filter((r) => r.part === 'afternoon'))), '');

w('## 3. Anchors built from one session, tested on another (the realistic numbers)', '',
  'The test scans are NOT in the training set at all. "Spots unseen in training" have no scan of their own in it, so only neighbours can place them.', '', HEAD.replace('| group', '| train -> test'));
for (const c of crossResults) w(statsRow(`${c.name} (train ${c.trainCount} scans)`, stats(c.rows)));
w('');
for (const c of crossResults) if (c.unseen.length) w(`- ${c.name}: spots unseen in training: ${c.unseen.map(placeName).join(', ')}`);
w('');

const droppedRadios = WITHOUT.anchors.filter((a) => !WITH.anchors.some((b) => b.radio === a.radio));
const placeOf = (a) => (a.place ? placeName(a.place) : a.tie.map(placeName).join(' + '));
const cmp = (label, a, b) => [statsRow(`${label}: without the cut (${WITHOUT.anchors.length} radios)`, a), statsRow(`${label}: with the cut (${WITH.anchors.length} radios)`, b)];
w(`## 4. Radios weaker than ${MIN_ANCHOR_BEST_DBM} dBm: with and without`, '',
  `\`MIN_ANCHOR_BEST_DBM = ${MIN_ANCHOR_BEST_DBM}\`: a radio never heard stronger than that anywhere is left out of the anchors. Both settings, same scans, same estimator.`, '', HEAD.replace('| group', '| test'),
  ...cmp('leave one out', stats(WITHOUT.loo), stats(WITH.loo)),
  ...WITH.crossResults.flatMap((c, i) => cmp(c.name, stats(WITHOUT.crossResults[i].rows), stats(c.rows))), '');
w(`- Radios the cut removes: ${droppedRadios.length}: ${droppedRadios.map((a) => `${a.radio.slice(-5)} (${placeOf(a)}, ${a.heard[0][1]} dBm${a.single_spot ? ', heard at one spot only' : ''})`).join('; ') || 'none'}.`);
const lost704 = droppedRadios.filter((a) => a.place === 'r704').length;
if (lost704) w(`- **${lost704} of the radios the cut removes were anchored at Room 704**: ${WITH.anchors.filter((a) => a.place === 'r704').length} are left there with the cut.`);
const paired = crossPaired();
w(`- Mean walking error, leave one out: ${looMean(WITHOUT).toFixed(2)} m without the cut, ${looMean(WITH).toFixed(2)} m with it (a cut is kept only if it lowers this by ${MEANINGFUL_GAIN_M} m or more).`,
  `- Cross-session tests, on the ${paired.both} of ${paired.scans} scans that both settings can estimate: ${m(paired.without)} without, ${m(paired.with)} with. Scans only one setting could estimate: ${paired.onlyWithout} only without the cut, ${paired.onlyWith} only with it (more scans with no estimate at all is a cost the cut's better-looking medians do not show).`,
  `- **Kept: ${KEEP_FILTER ? 'WITH the cut' : 'WITHOUT the cut'}**${KEEP_FILTER ? '' : ' (the cut did not lower the leave-one-out error, and it costs Room 704 its only anchors)'}. \`ANCHOR_CUT_ENABLED\` in scripts/lib/floor7Anchors.mjs is ${KEEP_FILTER ? 'true' : 'false'}.`, '');

const t = (ms) => new Date(ms + 5.5 * 3600_000).toISOString().slice(11, 19);
w('## 5. The afternoon as a walk, raw against filtered', '',
  `The ${walk.length} scans of the third phone's afternoon, in the order they were taken, each estimated from anchors built without it (leave one out), snapped onto the corridor, then run through the position filter (gate on walking distance, MAX_JUMP_M = 25, 2 rejects to reacquire). "Raw" is the snapped estimate on its own; "filtered" is the filter's position. Error = walking distance to where the scan was really taken. Times are IST.`, '',
  '| | median | mean | 90th pct | worst |', '|---|---|---|---|---|',
  `| raw | ${m(walkSummary.raw.median)} | ${m(walkSummary.raw.mean)} | ${m(walkSummary.raw.p90)} | ${m(walkSummary.raw.max)} |`,
  `| filtered | ${m(walkSummary.filtered.median)} | ${m(walkSummary.filtered.mean)} | ${m(walkSummary.filtered.p90)} | ${m(walkSummary.filtered.max)} |`, '',
  `- Filtered was more than 0.5 m better than raw on ${walkSummary.better} scans and more than 0.5 m worse on ${walkSummary.worse} (of ${walkSummary.compared}).`,
  `- The filter rejected ${walkSummary.rejected} estimates and restarted ${walkSummary.reacquired} times.`,
  `- ${walk.filter((x) => x.truthStep !== null && x.truthStep > 25).length} of the ${walk.length} scans were taken more than 25 m on foot from the previous one: the surveyor really did move farther than the gate allows, so the filter cannot be right about those by design, and the long gaps between them (${walk.filter((x) => x.gapS > 70).length} gaps over 70 s) make it start afresh.`,
  '- The survey is spot to spot, not a continuous walk: the surveyor stood still for each scan and moved between them. A real walk is smoother than this, so the filter should do at least as well on the phone walk.', '',
  '| time | spot | gap | true step | raw | filtered | filter |', '|---|---|---|---|---|---|---|');
for (const x of walk) {
  w(`| ${t(x.time)} | ${placeName(x.place)} | ${x.gapS === null ? '-' : `${Math.round(x.gapS)} s`} | ${x.truthStep === null ? '-' : m(x.truthStep)} | ${m(x.raw)} | ${m(x.filtered)} | ${x.status} |`);
}
w('');

w('## Where the error is: by spot (leave one scan out)', '', '| spot | scans | median | worst | spot is a guess? | share of matched radios resting on a guess |', '|---|---|---|---|---|---|');
for (const [place, rows] of [...perPlace].sort((a, b) => placeName(a[0]).localeCompare(placeName(b[0])))) {
  const s = stats(rows);
  const share = rows.reduce((a, r) => a + r.guessShare, 0) / rows.length;
  w(`| ${placeName(place)} | ${rows.length}${rows.length === 1 ? ' (one)' : ''} | ${s.estimated ? m(s.median) : '-'} | ${s.estimated ? m(s.max) : '-'} | ${rows[0].truthIsGuess ? 'yes' : 'no'} | ${pct(share)} |`);
}
w('', '### Does resting on a guess cost accuracy?', '', HEAD.replace('| group', '| group'),
  statsRow('true spot is a guess item (702, 704, restrooms, east wing, ...)', stats(loo.filter((r) => r.truthIsGuess))),
  statsRow('true spot is not a guess item', stats(loo.filter((r) => !r.truthIsGuess))), '');

w('## The anchors', '', 'Same list as `src/data/floor7Aps.json`. "guess" = the anchor rests on a spot the team marked as a guess. "single" = heard at one spot only.', '',
  '| radio | at | basis | single | strongest | guess item(s) |', '|---|---|---|---|---|---|');
for (const a of anchors) {
  w(`| ${a.radio} | ${a.place ? placeName(a.place) : a.tie.map(placeName).join(' + ')} (${a.x}, ${a.y}) | ${a.basis} | ${a.single_spot ? 'yes' : ''} | ${a.heard[0][1]} dBm | ${a.guess.join('; ')} |`);
}
w('', `${anchors.filter((a) => a.guess.length).length} of ${anchors.length} anchors rest on a guess item; ${anchors.filter((a) => a.single_spot).length} are single-spot; ${anchors.filter((a) => a.heard[0][1] < MIN_ANCHOR_BEST_DBM).length} have no reading stronger than ${MIN_ANCHOR_BEST_DBM} dBm.`, '');

w('## Caveats', '',
  '- Plan distances are estimated, not measured (the 46 m passage is a guess), so every metre figure is only as good as the plan.',
  '- Spot positions are good to a few metres at best: a surveyor stood "in front of" a room, not on a mark.',
  '- Every scan comes from the same people on the same day, so these errors are optimistic: a different day, crowd or phone will do worse.',
  '- Leave-one-scan-out is optimistic because scans at one spot are near-duplicates (twins stay in the training set). Quote the cross-session rows (section 3) as the realistic ones.',
  `- Radios never heard stronger than ${MIN_ANCHOR_BEST_DBM} dBm: ${KEEP_FILTER ? 'left out (section 4)' : 'kept, because leaving them out did not help (section 4)'}.`);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'leave_one_scan_out.md'), `${out.join('\n')}\n`);
console.log(out.join('\n'));
