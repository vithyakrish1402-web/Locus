# LOCUS — Floor 7 Wi-Fi Positioning v2: corridor map + Kalman filter + movement rules

This replaces the earlier Kalman prompt. Everything already approved still stands: position-only filter,
25 m jump cap, reset after 2 rejects, scan cadence only (no motion sensors), test build only
(`WIFI_POSITIONING_ENABLED` true only in `sidetest` mode), live `wifi_aps` table untouched, automated
build check, no new dependencies, minimal diffs. What changes: we now have a real (estimated-scale)
floor plan, so the placeholder map is replaced by it.

## Inputs added to the repo (do not edit their contents, only read them)
- `floor7_plan.json`: walkable corridors, walls, doors, corridor centrelines with stations, places,
  `survey_spots`. Units metres, x east, y north, origin = centre of lift lobby A.
- `floor7_plan_v3.svg`: the drawing, for the debug overlay and for humans.
- `survey_name_to_plan_spot.csv`: maps every name typed in the survey to a plan spot (place id,
  corridor, distance, plan x/y, notes, special rules).
- The Floor 7 survey CSVs (4 files; the newest one contains the earlier session's points 19 to 31).

**Scale is estimated, not measured.** The spine-to-spine length of 46 m is a guess; phone GPS averages
suggest 40 to 44 m. Put one constant `PLAN_SCALE = 1.0` in a single place that multiplies every plan
coordinate and every distance, so a later tape measurement fixes everything with one number.

## What the plan looks like (so you do not assume a loop)
The walkable space is an **H shape with two dead ends**, not a ring:
- `west_spine` and `east_spine` run north–south (27 m each), joined by the `passage` at y = 0 (46 m).
- `west_back` and `east_back` are short back paths (17 m) that branch off the spines at y = 7.9 and
  **end in dead ends** at the restrooms. They do not connect across the labs.
- So there is exactly one walking route between any two points. Walking distance can be a different
  number from straight-line distance (for example the new ladies restroom door is about 8 m from the
  Department door in a straight line but roughly 40 m on foot).
Several features are drawn from guesses (marked `guess` in the file): all restroom positions, which
side of the passage the labs are on, Room 702 and 704 positions, east-wing room order. Treat
`confidence: guess` items as soft and say so in your reports.

## Step 0 — Check, read only, then stop and wait
Report in plain language:
1. Whether `floor7_plan.json` loads and passes these checks: every `survey_spots` point and centreline
   station lies inside corridor space, no centreline crosses a wall, the junction stations connect
   the five centrelines into one graph. (We checked by hand and found no problems; confirm.)
2. Whether `survey_name_to_plan_spot.csv` covers every spot name in the four survey CSVs, and what
   happens to the one `DROP` entry (`tp 707`).
3. Two known gaps for you to handle: (a) `survey_spots` in the JSON has no entry for the new ladies
   restroom (`rW`), so "Near The New Restroom L" must use the `places` entry; (b) distances along a
   centreline start at the south end of each spine, so build one graph with nodes at the junctions
   rather than comparing distances between different centrelines.
4. The decisions from the earlier Step 0 that are still open, if any.
Then wait for approval.

## Build, in this order (report after each group)

### Group 1 — Plan loader, graph and tests (no phone, no AP data)
1. `floor7Plan.js` loads the JSON, applies `PLAN_SCALE`, and exposes the corridor graph: nodes at
   junctions, line ends, and every station; edges with lengths in metres.
2. `snapToCorridor(x, y)`: nearest point on any corridor centreline, returns the edge, offset and
   the distance moved. Points inside the lift lobbies snap to the passage.
3. `walkingDistance(a, b)`: shortest route along the graph between two snapped points.
4. Tests: round trip, snapping at junctions and dead ends, walking distance across the floor
   (west 701 to east 704 is the length of west spine north half + passage + east spine north half),
   the dead-end back path distances, and scale changes when `PLAN_SCALE` changes.
5. Debug overlay (dev only, test build only) draws the SVG plan with the corridor centrelines, the
   raw estimate, the snapped estimate and the filtered track.

### Group 2 — Access point placement from the survey
1. Dev script `scripts/build-floor7-aps.mjs` reads the four survey CSVs, applies
   `survey_name_to_plan_spot.csv`, and writes `src/data/floor7Aps.json` with positions in plan metres.
2. Rules (agreed earlier): campus access points are SRMIST or SRMIST-UA **plus** any BSSID sharing
   its first five parts with one of those; group by radio (first five parts); anchor each radio at
   the plan spot where any of its BSSIDs was heard strongest; within 3 dB of the runner-up use the
   midpoint of those two spots; radios heard at only one spot get `single_spot: true`;
   an `overrides` section lets the team move any radio by hand.
3. Special rules to implement exactly: in the newest file any "Computing Lab F" scan at point 69 or
   later is really Lab E (use `labD`); drop `tp 707`; leave out the two "Staff Room" scans (marked HOLD in the table) until the team confirms they were taken in the corridor; skip blank rows; ignore GPS completely for
   placement; use the mapping's plan coordinates only.
4. Merge the first-session scans: the newest file already contains the earlier session's points 19 to
   31, so do not count them twice. Keep a per-scan session id so repeats are traceable.
5. The estimator's AP source is this local file in the test build only (the seam we agreed on).

### Group 3 — Filter, gates and wiring
1. `positionFilter.js`: position-only Kalman filter in plan metres, `update(estimate, timestamp)`,
   `reset()`, position, uncertainty radius, status (`tracking`, `rejected`, `reacquiring`).
   Process noise grows with the time gap; measurement noise = `MEASUREMENT_NOISE_BASE_M / max(confidence, 0.2)`.
2. **Snap, then gate.** For each Wi-Fi estimate: convert to plan metres, snap to the nearest corridor
   point, then compare with the last accepted position using **walking distance along the graph**,
   not straight-line distance. Reject if it exceeds `min(MAX_WALK_SPEED_MPS × seconds + uncertainty, MAX_JUMP_M)`
   with `MAX_JUMP_M = 25`. Two rejects in a row triggers reacquire.
3. **Wall rule is built in.** Because every output is snapped onto a corridor line, a position can never
   be inside a room, wall or outside the building, and a move always follows corridors. Keep a plain
   test that a straight-line move through a wall that is short on a map but long on foot is judged by the
   long walking distance. Do not add a separate wall-crossing check unless the tests show it is needed.
4. Wire in at the single point agreed before (`wifiFusion.js`, after `estimate(...)` and before
   `finish(...)`). GPS never overrides a Wi-Fi position on this floor; accept GPS only below
   `GPS_TRUST_MAX_ACCURACY_M = 50`, and not at all indoors for this demo.
5. Constants (state assumptions): `MAX_WALK_SPEED_MPS = 2.0`, `MAX_JUMP_M = 25`,
   `REACQUIRE_AFTER_REJECTS = 2`, `PROCESS_NOISE_M2_PER_S = 0.7`, `MEASUREMENT_NOISE_BASE_M = 4`,
   `GPS_TRUST_MAX_ACCURACY_M = 50`, `PLAN_SCALE = 1.0`. Reuse the existing staleness constant.

## Checking (state clearly which checks are simulation and which need the phone)
1. Unit tests for everything above, plus mutation tests like earlier stages.
2. **Leave-one-scan-out** replay: for each survey scan, rebuild the anchors without it, estimate, snap to
   the corridor, and report the **walking distance in metres** to its true plan spot. Report separately
   for spots with only one scan. Caveats to print: plan distances are estimated, spot positions are
   good to a few metres at best, and all scans come from the same people on the same day.
3. **Simulated walks** along the corridor graph with noise and occasional bad jumps; report how
   much steadier the filtered track is than the raw one. Expect most of the gain from the gates and
   the snapping, not from smoothing.
4. **Build check** (as already agreed): flag off means none of the new modules appear in the output;
   sidetest build contains them; normal build still has the flag false.
5. **Phone walk** (the team does this): walk the corridor route and compare the shown position at
   each door; give a small script that prints the error in metres per door.

## Acceptance checklist
- [ ] Step 0 report approved first
- [ ] Plan loads, one connected graph, back paths are dead ends
- [ ] Walking distance and snapping tests pass; `PLAN_SCALE` changes everything consistently
- [ ] No survey name is left unmapped (except the dropped `tp 707`); Lab F at point 69+ is treated as E
- [ ] The new ladies restroom scans anchor at the `rW` position, not the disabled restroom
- [ ] A move of more than 25 m of walking distance is rejected; two rejects reacquire
- [ ] Output is always on a corridor; never inside a room or wall
- [ ] Leave-one-scan-out results reported with the caveats above
- [ ] Normal build contains none of the new code, flag still false; no new dependencies
- [ ] Final message explains each change in plain language and lists what still needs the phone walk

## On-site checks the team can do (feed back the numbers, they only change constants)
1. Pace or tape the passage length from the west spine to the east spine (drawn: 46 m).
2. Pace from Room 706 to Room 706A and from Room 703 to Room 703A; the plan says both are about 6.5 m.
   Phone GPS put 706A much further south in two visits, so check.
3. Confirm which side of the passage Labs C/F and D/E are on, and the real position of Rooms 702 and 704.

## Out of scope
Radio map with grid points, other floors or buildings, particle filter, turning positioning on for
all users.
