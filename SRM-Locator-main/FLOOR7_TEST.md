# Floor 7 test build: how to install it, walk it, and feed it new survey data

Everything here is for the **LOCUS Test** app only. It is a second app that sits next to LOCUS
on your phone, with its own sign-in. It never updates itself and nothing in it ships to anyone.
Run every command in a terminal opened in this folder:

```
C:\Users\Krish\Documents\Projects\LOCUS-floor7\SRM-Locator-main
```

(That is the separate copy of the project for this work. Do not use the main LOCUS folder:
another branch is checked out there.)

## 1. Build LOCUS Test and put it on your phone

1. **Prepare the phone.** Settings, Developer options, turn on **USB debugging**. Plug it into
   the PC with a USB cable and unlock it. If the phone asks "Allow USB debugging?", tick
   "Always allow" and press Allow.
2. **Check you are on the right branch.** Run `git branch --show-current`. It must say
   `claude/floor7-position-filter`.
3. **Copy the Android settings file, once.** This copy of the project does not have it, and
   the build needs it (it holds where the Android tools are). In PowerShell:
   ```
   Copy-Item C:\Users\Krish\Documents\Projects\LOCUS\SRM-Locator-main\android\local.properties android\local.properties
   ```
   Git ignores this file, so it will never be committed.
4. **Check the PC can see the phone.** Run:
   ```
   & "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" devices
   ```
   You should see one line ending in `device`. If it says `unauthorized`, look at the phone and
   allow the PC. If you see two phones, unplug the one you are not using.
5. **Build and install.** Run:
   ```
   npm run sidetest:install
   ```
   The first time it takes several minutes. It ends with "LOCUS Test is installed next to
   LOCUS". Your normal LOCUS is not touched. (To build without installing, add
   `-- --build-only`.) At the end it puts the normal web build back by itself; that is
   expected.
6. **Open LOCUS Test on the phone** (the app drawer now has two apps; LOCUS Test is the new
   one). Sign in with the owner account. It keeps its own sign-in, separate
   from LOCUS.
7. **Allow the permissions** when asked (location, and nearby Wi-Fi if it asks). Keep the
   phone's Location and Wi-Fi switched **on**: the app reads Wi-Fi scans to work out where you
   are.
8. **Join or create a group.** Wi-Fi positioning only runs while you are in a group. If LOCUS
   is also in the same group, use a different account in one of the two apps.
9. **Stand on Floor 7 of TECH PARK.** About 35 seconds later the first estimate arrives, and
   a second one a scan later starts the track (nothing is shown until two estimates agree).

### Seeing the overlay

10. Open **Settings** (the sliders icon at the top) and switch on **Developer mode**. The row is
    only there for the admin account (signed in with the admin email, online), and only in LOCUS Test.
    It is off after sign-out. A badge **Developer mode on** appears under the top bar; tap it
    to come back to the Developer mode screen.
11. To see the floor drawing on the main map screen, open the card **Floor 7 map overlay** and
    switch it on (it is off by default). You see the team's floor drawing with:
    - the blue dotted lines: the corridors the position is allowed to be on;
    - the **track**: a white-ringed circle is each raw estimate ("Wi-Fi guess"), the blue dot is
      that estimate moved onto the nearest corridor ("Guess moved onto corridor"), and the
      green line and big dot is the position the app is showing ("Position shown"). While the
      app is still waiting for a second estimate that agrees there is no green dot.
    The access points (all 38, with what to check about each) are under **Advanced details**
    in the walk test results.
12. Tap **Hide the plan** to hide it.

## 2. The phone walk: error in metres per door

1. **Before the walk,** clear the phone's log: `adb logcat -c` (use the full adb path from
   step 4 above if `adb` is not found).
2. **Walk.** At each door, stand in front of it for about a minute and note the clock time you
   arrived. Use the **phone's** clock. Write them in a file called `doors.csv`, one door a
   line, in any order:
   ```
   door,time
   Room 701,16:47:10
   Lift lobby A,16:51
   Room 706A,16:58:30
   Lab C,17:03,90
   ```
   The third number is optional: how many seconds you stood there (default 75). A door name is
   anything the plan or your survey called it: `Room 701`, `r706A`, `TP706A`, `Lab C`, `new
   ladies restroom`. If a name fits several places the script says which and asks you to pick.
3. **Straight after the walk,** save what the app printed:
   ```
   adb logcat -d -s Capacitor/Console > phone.log
   ```
   (The phone keeps only the last few minutes of log, so do this right away.)
4. **Print the errors:**
   ```
   node scripts/floor7-phone-walk.mjs doors.csv phone.log
   ```
   Add `--csv errors.csv` to also get a spreadsheet, and `--date 2026-10-14` if the walk was
   not on the day of the first estimate in the log.
5. **Reading it.** Per door you get the error of the position the app was showing when you
   left (as a walk along the corridors, and as a straight line), and beside it the error of
   the raw estimate, so you can see what the filter did. "no position shown" means the app was
   still waiting for two estimates to agree. At the end: the median, mean, worst, and how many
   doors were within 5 m and 10 m.

Save `doors.csv`, `phone.log` and the result somewhere (not in `floor7-inputs/`).

## 2a. The phone walk without a PC: the in-app recorder

LOCUS Test does the whole walk itself, as a guided flow (it needs the APK from
`npm run sidetest:install`, because the recorder has a small native part). Open **Developer
mode** (see "Seeing the overlay" above), then the card **Floor 7 walk test**:

1. **Ready check.** Ticks for: signed in as admin, in a group, Location on, Wi-Fi permission,
   Wi-Fi on, and a first position (up to 70 seconds). **Start recording** stays grey until all
   are ticked and says what is still needed. Under it is your route: the shortest walk
   through the doors starting at Room 701. Move a door with Up and Down, or Skip it.
2. **Walking.** The plan is on top, with your position. The card below always says what to do
   next ("Next: Room 701. Walk to the corridor in front of the door and stand still."). Tap
   **I'm here**, stand still for the countdown (or tap **Done, next door**). **Skip this door**
   and **Undo last** are under it. After the last door, walk the middle passage without
   stopping: **Start of walk**, then **End of walk**. A red **Recording** label and the time
   are always on screen. **Stop** asks first. The screen stays on while it records.
3. **Results.** A plain summary on top, then each door with a green (within 5 m), amber (5 to
   10 m), red (over 10 m) or grey (no position) chip, its walking error and the raw error.
   **Share files** sends the files through the Android share sheet; **Save to Downloads** copies
   them to `Downloads/LOCUS`. **Previous recordings** lists earlier walks to see, share, delete or
   recover one the app was closed in. **Advanced details** (closed) holds the technical names,
   access points, constants and per-estimate details.

The files are `<id>_estimates.csv`, `_scans.csv`, `_doors.csv`, `_events.csv` and `_summary.txt`.
They hold the Wi-Fi names and hardware addresses of campus access points; there is no account
data in them and nothing is uploaded. If the app leaves the screen, or the screen turns off,
the recording notes it and warns you on return: Android slows Wi-Fi scans then.

On a PC, from the shared files (this does not need the phone, and the old `doors.csv` plus log
way below still works):

```
node scripts/floor7-phone-walk.mjs floor7_20261014_164710_estimates.csv
```

## How fast the dot appears, and how fast you can walk

**Timing.** The app takes a Wi-Fi reading about every 35 seconds. The first one comes straight
after you join a group, but nothing is shown from one reading alone: a second reading, close
to the first, has to confirm it. So the first position normally appears 35 to 70 seconds after
you start (70 s if the first two readings disagree and a third is needed). From then on the dot
moves once every 35 seconds. If a track goes more than 70 seconds without an accepted reading
(the phone was asleep, or a reading was thrown out) it starts again and needs two new readings.

**Walking speed.** The filter does not accept a move of more than `MAX_JUMP_M` (25 m, walking
distance) between two readings. Readings are 35 seconds apart, and a brisk walk of 1.2 to
1.4 m/s covers 42 to 49 m in that time, so a brisk walk can be longer than the limit. The
filter then rejects the reading, and two readings in a row that agree with each other restart
the track at them: the dot lags by about two readings (70 s), then catches up. Standing at
doors never hits this; a continuous walk does. That is why the phone walk should be done
**both ways**, and each recorded on its own:

1. **Stopping at doors:** walk to a door, stand for a minute, note the time, go on (the walk in
   section 2). This tests where the dot settles.
2. **One continuous walk:** start at one end of the lab passage and walk it to the other end
   without stopping, at your normal pace, noting the time you set off and the time you
   arrive. Save the log, then compare the dot with where you were over the time it took. This
   tests whether the dot keeps up.

If the dot lags on the continuous walk, one line to try: in `src/utils/positionFilter.js`
change

```
export const MAX_JUMP_M = 25;
```

to a larger number (for example `45`, about a brisk walk's distance in 35 s), then rebuild
LOCUS Test (section 1, step 5). A larger limit also lets in more wrong readings, which is the
trade-off the walk is meant to measure. Leave it at 25 until the continuous walk shows the lag:
a few tests pin the 25, and the report numbers were made with it.

## 3. Adding new survey files

1. **Put the new CSV in `floor7-inputs/`.** Name it like the others: `wifi_survey_` then the
   date and time, then `.csv` (for example `wifi_survey_20261020_101500.csv`). The scripts read
   every file with that pattern. Give each file a different time in its name: the last six
   digits identify the phone/session in the reports.
2. **Run the AP script:**
   ```
   node scripts/build-floor7-aps.mjs
   ```
3. **If it stops with "Survey names missing from the name table: ...",** that is the list of
   names someone typed that the table does not know. Open
   `floor7-inputs/survey_name_to_plan_spot.csv` and add one row per name:
   | column | what to put |
   |---|---|
   | `raw_name` | the name exactly as typed in the survey (capitals and spaces too) |
   | `place_id` | the plan's id for that place (`r701`, `labC`, `lobbyA`, ... see `places` in `floor7_plan.json`), or `between:r701,r702` for a spot between two rooms, or `DROP` for a name that is not a real place |
   | `plan_name`, `corridor`, `distance_m`, `plan_x`, `plan_y` | copy them from an existing row for the same place (a test checks that the coordinates match the plan) |
   | `confidence` | `estimated`, `guess`, or `hold` (leave this scan out until someone confirms where it was) |
   | `note` | anything useful |

   Run the script again until it prints the summary.
4. **Re-stamp the inputs.** Because the table and the files are now different, refresh the
   checksum list that guards the inputs (PowerShell, from `floor7-inputs`):
   ```
   cd floor7-inputs
   Get-ChildItem -File | Where-Object { $_.Name -notin 'SHA256SUMS', '.gitattributes' } | Sort-Object Name | ForEach-Object { "$((Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower()) *$($_.Name)" } | Set-Content -Encoding ascii SHA256SUMS
   cd ..
   ```
5. **Rebuild the report:** `node scripts/floor7-leave-one-out.mjs`. It rewrites
   `floor7-reports/leave_one_scan_out.md`.
6. **Run the tests:** `npm test`. A few tests deliberately pin today's numbers (the file and
   scan counts, 38 radios, 19 resting on a guess, 4 single-spot radios, 76 afternoon scans,
   the session sizes, the walk-report row counts). With new data they will fail, and each
   failure names the number to change. That is the cue to read the new report, not just to
   change the number.
7. **Moving one access point by hand:** put it in `src/data/floor7ApsOverrides.json`, keyed by
   the radio (its first five bytes), either at a place or at coordinates, then run step 2:
   ```
   { "54:f0:b1:3e:5b": { "place": "labC" }, "48:b4:c3:72:0e": { "x": 37, "y": 11.75 } }
   ```
   It shows in the overlay with a blue diamond.

Two things that are tied to the current data and stay as they are: the Lab F rule (scans named
"Computing Lab F" from point 69 of file `170507` on were really Lab E) applies only to that
file, and the two "Staff Room" scans stay on hold until someone confirms they were taken in
the corridor (change their `confidence` in the table from `hold` to `estimated` to use them).
