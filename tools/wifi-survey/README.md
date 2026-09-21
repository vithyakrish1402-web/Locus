# WiFi Survey (LOCUS WiFi Arc, Stage 1)

A throwaway field tool. Walk to a spot, tap **LOG POINT**, and it records the GPS fix plus
every WiFi access point visible there. The CSV it produces is the input for Stage 3
(building `wifi_aps`). This tool is not part of that pipeline, and it is **not part of LOCUS**.

## Why it can't end up in a LOCUS release

This is a separate app, not a screen or flag inside LOCUS:

- **Separate project.** It lives outside `SRM-Locator-main/`, which is the only directory
  LOCUS's build, `npx cap sync`, tests, lint and `scripts/release*.mjs` read. LOCUS's Gradle
  build only includes the modules listed in `SRM-Locator-main/android/settings.gradle`, and
  none of them point here.
- **Separate identity.** `applicationId` is `com.locus.wifisurvey`, not `com.locus.app`. It
  installs as its own app beside LOCUS and can never replace or update it.
- **Never released.** Debug-signed only. It has no release signing, no version bumps and no
  GitHub releases. LOCUS's updater only installs APKs from LOCUS's own releases, and those
  are checksum-verified.
- LOCUS itself doesn't gain `ACCESS_WIFI_STATE`, `CHANGE_WIFI_STATE` or
  `@capacitor/geolocation` from any of this.

## Build and install

```bash
npm install
npm run apk
```

`npm run apk` builds the web layer, runs `cap sync`, runs `gradlew assembleDebug`, and copies
the result to `wifi-survey-debug.apk` in this folder. It runs Gradle on Android Studio's
bundled JDK 21, because the Capacitor template's Gradle 8.14 can't run on the system JDK 25.
Set `SURVEY_JAVA_HOME` to use a different JDK.

Get the APK onto the phone however is easiest: `adb install -r wifi-survey-debug.apk`, or
copy the file over and tap it (you'll need to allow installs from that app once). The
Gradle project needs `android/local.properties` with `sdk.dir`; it's gitignored, like LOCUS's.

## In the field

1. First launch asks for location. Choose **While using the app** and keep **Precise** on.
   Android only returns WiFi scan results to apps with precise location.
2. Keep the phone's **Location** switch on. It's separate from the permission: with it off,
   Android returns no scan results and no GPS, even to apps with permission. The app
   shows these as two different red cards, each with a button to its own fix.
3. Set **where you are** above the button. **Building** is one of the 24 campus buildings,
   "Other", or outdoors. **Floor** runs B1, G, 1-15. Both stay set until you change them. **Spot** is
   free text for this one point ("corridor by lift", "outside room 305") and clears after each tap.
4. At each point, stand still and tap **LOG POINT**. A fresh WiFi scan (4-7 s) and a GPS
   window run together. GPS keeps the most accurate fix and stops as soon as one is within
   ±10 m. Otherwise it waits up to 15 s and takes the best one (indoors that's typically ±15-30 m).
   The card shows what it's waiting for. A green card means the point was written; the
   strongest APs for it appear below.
5. **Share log** sends a timestamped copy of the CSV through the share sheet (Gmail to
   yourself, Drive, Quick Share). No computer needed.

### How many points, and where

Four points is a trial, not a survey. Stage 3 places each access point at the point
where it was heard strongest, so an AP's position can only be as good as how close you
passed to it. Rough guide:

- **Outdoors:** every 10-15 m along the paths between buildings, plus every building
  entrance. GPS is good here (±5-10 m), so it does the placing.
- **Indoors:** every 10-15 m along each corridor, on **every floor** you want covered,
  plus stairwells and lift lobbies. GPS is poor indoors, so the building, floor and spot tag
  is the ground truth. Always set it inside.
- Expect a few hundred points for good campus coverage. A single building floor is
  typically 5-15 points.
- Log everything the scan sees. Filtering happens in Stage 3: phone hotspots and personal
  room routers move around and shouldn't anchor positions, but deciding which SSIDs are
  SRM infrastructure is easier with all the data in hand.

The log file survives app restarts, and `point_id` keeps counting up from the highest ID
already in the file.

### "Stale scan. Nothing logged."

Android lets an app start **4 WiFi scans per 2 minutes**. Past that, it refuses the scan and
`getScanResults()` quietly returns the previous results. The tool never logs those. It
shows how old the cached results were and when to retry. The "Android scan limit" row
tracks it. This limits scans, not points: there is no cap on how many points you log.

At survey density (a point every 10-15 m) you *will* hit it, since it averages out to 2
points a minute. **Turn it off for the real survey:** Settings > Developer options >
**Wi-Fi scan throttling** > off. The app reads that setting, and the row changes to "Off, no limit".

Even in a fresh scan, Android can leave a few entries in its cache from an earlier scan.
Every AP carries its own "last seen" timestamp, and any entry seen before you tapped is left
out of that point. The green card says how many were dropped.

## The CSV

```
point_id,timestamp,lat,lng,accuracy_m,bssid,ssid,rssi,frequency_mhz,building,floor,spot
1,2026-09-21T10:15:23.915Z,12.8231000,80.0446000,6.2,a4:2b:b0:11:22:01,SRMIST,-53,2437,TECH PARK,4,"corridor, near lift"
```

One row per access point per point, so Stage 3's "strongest RSSI wins per BSSID" is a plain
group-by. `timestamp` is UTC, taken when the scan completed; every row of a point shares it. BSSIDs are
lowercase. Hidden networks have an empty `ssid`. SSIDs containing commas, quotes or
newlines are quoted per RFC 4180. A point with zero APs writes nothing: with no rows, its
GPS fix would have nowhere to go.

- `accuracy_m` is the accuracy of the best fix from the GPS window.
- `building` is spelled exactly as in `SRM_MASTER_DATABASE` (`src/campusBuildings.js` is a
  snapshot of those names), so Stage 3 can join it to that database's coordinates and
  footprints. It can also be `OTHER` (named in `spot`) or empty, meaning outdoors.
- `floor` is an integer: 0 is ground, -1 is basement. It's empty when unset or outdoors.
- `spot` is free text.

If the columns ever change again, the app refuses to append to a log from an older
layout instead of mixing two headers in one file.

## Working on it

- `npm test` runs the Vitest unit tests for the pure logic in `src/`: CSV format, stale and
  throttle messages, and blocker states.
- `npm run dev` runs the screen in a desktop browser against `src/simulator.js`, which fakes
  the plugin and GPS. Force a state with `?sim=` set to `stale`, `throttled`, `timeout`,
  `empty`, `prompt`, `denied`, `approximate`, `locoff`, `wifioff` or `poorgps` (indoor-like
  GPS that never reaches ±10 m). On the phone the simulator is never used.
- The native side is `android/app/src/main/java/com/locus/wifisurvey/WifiSurveyPlugin.java`,
  registered by hand in `MainActivity`. It follows the same pattern as LOCUS's
  `LocusUpdaterPlugin`.
