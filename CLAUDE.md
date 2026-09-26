# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

The actual application lives entirely inside **`SRM-Locator-main/`**. The repo root only contains a stray `package.json`/`capacitor.config.json` left over from an earlier layout — there is no `index.html` or `src/` at the root, so nothing there is buildable. Always `cd SRM-Locator-main` (or target paths under it) before running any command.

```
SRM-Locator-main/
├── backend/server.js       # Express + Socket.IO server (real-time squad/location relay)
├── src/
│   ├── App.jsx              # ~145KB monolithic component: nearly all app state, UI, and logic live here
│   ├── ARCompass.jsx        # AR camera viewfinder, bearing/heading math
│   ├── LocusGuide.jsx       # Onboarding/help modal
│   ├── utils/               # Pure helpers: geoMath, precognition (GPS Kalman filter), squadCode, ghostProjection, markerStatus
│   ├── srmDatabase.js       # SRM_MASTER_DATABASE — static campus building coordinates
│   ├── firebase.js          # Firebase SDK init (Auth + Firestore)
│   └── main.jsx             # Entry point
├── android/                 # Capacitor-generated native Android project
└── LOCUS_SYSTEM_ARCHITECTURE.md  # Detailed system/protocol spec — read this for deep context
```

**`LOCUS_SYSTEM_ARCHITECTURE.md`** documents the intended architecture, AI oracle integration, and full WebSocket protocol schema in detail. It is mostly accurate but has drifted in places (e.g. `HexGridOverlay.js` and the geofence painter it describes were deleted — see `git log`). It also still describes a `/api/oracle` Gemini proxy and SYS_ORACLE AI chat that were deliberately removed (commit `3152689`, to avoid ongoing Gemini API billing) — there is no AI chat feature in the app anymore. Treat it as a good map, not ground truth; verify against actual source when specifics matter.

## Commands

Run all commands from `SRM-Locator-main/`:

```bash
npm run dev        # start Vite dev server (frontend only)
npm run server     # start backend (Express + Socket.IO)
npm run dev:all     # frontend + backend + localtunnel concurrently
npm run build       # production build (outputs to dist/)
npx cap sync         # sync web build into the Capacitor Android project
npm test            # run the Vitest suite once (tests/)
npm run test:watch  # Vitest in watch mode

npm run release -- 1.2.0          # cut a full-APK release (Phase 1 updater)
npm run release:bundle -- 1.1.2   # ship a JS-only live update (Phase 2 updater)
npm run release:verify            # check a published release the way a device would

npm run device-check:wifi         # prove the wifi_aps Firestore read on a USB-connected phone
```

`device-check:wifi` needs one phone on adb running a signed-in *debug* LOCUS. It builds in Vite's `device-check` mode, the only build that contains `src/devtools/` (the `MODE` check in `main.jsx` compiles it out of every other build, releases included). It then cold-starts the app three times, reads each run's report from logcat, and reinstalls the normal debug build (`--keep` skips that). It refuses to run if the phone is on a downloaded live-update bundle: capgo only resets to an APK's built-in JS when `versionCode` changes, and an in-place debug install keeps it.

Both release commands need the `gh` CLI authenticated; `npm run release` also needs the
signing keystore configured in `android/local.properties`. See **`UPDATER.md`** — it is the
reference for the whole update system, including the one-time keystore setup and the
real-device verification steps.

Tests use Vitest and live in `tests/`, in three kinds:
- **Unit tests** (`*.test.js`) cover the pure helpers in `src/utils/` and `backend/`.
- **End-to-end tests** (`*.e2e.test.js`) run the real `backend/server.js` in a child process on a free port and drive it with real Socket.IO clients (`tests/helpers/e2eServer.js`). Nothing is mocked.
- **UI tests** (`*.test.jsx`, jsdom) render the real `App.jsx` against a fake socket.

For a bug fix, show the new test failing against the unfixed code, then break each key behaviour one at a time and confirm a test catches it.

There is no lint script wired into `package.json` (ESLint config exists at `eslint.config.js`; run it directly with `npx eslint .` if needed).

The backend does not currently require any `.env` variables — the `GEMINI_API_KEY`-backed `/api/oracle` proxy it once used was deliberately removed (see the architecture-doc note above). `npm run server` still loads `.env` via `--env-file` if one exists, but nothing in the server reads from it today.

## Architecture

**Frontend**: React 19 + Vite 7 + Tailwind v4. `App.jsx` is a single large component holding almost all state (auth, map, squad/telemetry, AR targeting, UI modals) — when making changes, expect to work within this file rather than finding separate feature modules. Maps are rendered via `google-map-react` (primary, dark-styled) with Leaflet as a fallback engine.

**Backend**: `backend/server.js` is a single-file Express + Socket.IO server with no persistence layer — all squad/room/location state lives in in-memory objects (`activeSquads`, `users`, `locationCache`) and is lost on restart. The frontend picks the backend URL via `VITE_BACKEND_URL`, falling back to `http://localhost:5000` on localhost or the deployed Render URL (`https://locus-1-896t.onrender.com`) otherwise (`App.jsx:77`). Render auto-deploys `main` but reports nothing to GitHub. To confirm a server change is live, probe its behaviour with a scripted socket.io client against the Render URL.

**Real-time protocol**: Squad coordination (join/approve/kick, live location broadcast, waypoints, geofence alerts, "signal lost" dead-man's-switch on disconnect) all flows over Socket.IO events between `App.jsx` and `backend/server.js`. When touching either side of a socket event, grep the other file for the matching event name — the full event catalogue is documented in section 4 of `LOCUS_SYSTEM_ARCHITECTURE.md`.

**Squad membership and command** (server side in `backend/server.js` `request-join` and `backend/squadRoster.js`):
- **People, not connections.** People are recognised by Firebase uid, never by socket id, because every mobile reconnect mints a new socket id. `knownUids` is the approved-member list. Only an approval adds to it, and only leave, vote-out or block removes it. A disconnect never touches it.
- **Two identities.** `commanderUid` (read through `commanderOf()`) is the squad's own Commander. `ownerId`/`ownerUid` is whoever holds command right now, which may be a stand-in.
- **Commander away.** While the Commander's socket is gone, only an approved member can take command. A stranger's request is held in `squad.pending`, never admitted and never dropped. It is handed to a connected approved member promoted to stand in (`promoted-to-owner`), or waits for whoever takes command next. That promotion also happens when the Commander's socket drops with requests already waiting on it.
- **Commander back.** The Commander gets the squad back whenever they return, however long they were away. The stand-in is sent `demoted-to-member`, and the client drops its Commander controls and join queue.
- **Deliberate exits.** Only a deliberate exit (`leave-squad`, a vote-out) hands `commanderUid` on. A stand-in cannot block the Commander.
- **Disconnects are not departures.** A raw disconnect never changes command by itself: it fires on every signal blip.
- **Dead connections look alive for a while.** Behind Render's proxy, a dead phone is only noticed at the socket.io heartbeat timeout, up to about 45 s. Until then its socket still looks live.

**Firebase**: Used client-side only, for Auth (email/password — no OAuth redirect flow, deliberately, to stay stable inside the Capacitor WebView) and Firestore. The one collection is `wifi_aps` (WiFi positioning anchors, document ID = lowercase BSSID), seeded by hand with the standalone Admin-SDK script in `tools/wifi-aps-seed/`. `src/utils/wifiPositioning.js` (WiFi Arc Stage 5) reads it once into an in-memory cache and turns recent `WifiScan` results into a position estimate. Stage 6 (`src/hooks/useWifiFusion.js`) fuses it with GPS for `update-location`, behind `WIFI_POSITIONING_ENABLED` in `src/utils/positionSource.js`. That flag is **on** since js-1.1.3, for the TECH PARK field test (the v1.1.0 shell already carries `WifiScanPlugin`); off, fusion is left out of the build and positions are GPS only. Stage 7's indoor UI (floor picker, confidence halo, and an owner-only WiFi readout of every scan) rides on it, and `SHOW_INDOOR_POSITION_TO_SQUAD`, still **off**, would add `building`/`floor` to `update-location`. It is the app's only Firestore read, and it waits for `auth.authStateReady()` because the collection is readable only when signed in. The old `tactical_zones` collection was removed with the geofence painter. There is no `firestore.rules` in the repo; rules live in the Firebase console. Config in `src/firebase.js` is a public client config, not a secret.

**Mobile**: Wrapped via Capacitor (`android/` is the generated native project). After any frontend change intended for the mobile build, run `npm run build` then `npx cap sync`. Two local native plugins are registered by hand in `MainActivity`: `LocusUpdaterPlugin` (see Updates) and `WifiScanPlugin`. `WifiScanPlugin` does fresh WiFi scans for positioning; its JS bridge and result contract are in `src/utils/wifiScan.js`. Its scan logic is a copy of the field-survey tool's (`tools/wifi-survey/`), which is a separate app that must never be wired into this build.

**Updates**: The app updates itself rather than being hand-distributed — see `UPDATER.md`. Two tiers, and which one a change belongs to is decided by one question: *does it touch `android/` or add a Capacitor plugin?*
- **Yes** → Phase 1, a full APK release (`npm run release -- <version>`). Built on a locally-defined native plugin (`android/app/src/main/java/com/locus/app/LocusUpdaterPlugin.java`, registered by hand in `MainActivity`) with no npm dependencies. A `[MANDATORY]` marker in the release body turns the update modal into a gate that pre-empts every render branch in `App.jsx`.
- **No** → Phase 2, a JS-only bundle (`npm run release:bundle -- <version>`), which swaps the web bundle inside the installed shell with no reinstall. Uses `@capgo/capacitor-updater` in manual mode. The `MIN_NATIVE` line in a `js-*` release body is the compatibility gate that keeps a bundle off a shell too old to run it — it fails closed, and `src/utils/liveUpdateManifest.js` is where that logic lives.

In both tiers the GitHub release *is* the manifest; there is no separate JSON file. Don't hand-edit `versionCode`/`versionName` or attach release assets by hand — the release scripts keep the published checksum and the binary in sync.

**Both tag series share one number line.** Number every release, `v*` or `js-*`, above everything already published in either series. A phone running its APK's own JS counts as running the APK's version. So a bundle numbered below the newest APK is silently skipped as already current (js-1.0.9 after v1.1.0 never reached a phone). And an APK numbered below the newest bundle has its JS replaced by that older bundle. Both release scripts refuse such a version (`releaseVersionConflict`). As of js-1.1.8, the next release of either series must be 1.1.9 or higher. `npm run release:verify` checks only the APK release, so check a bundle by hand: download it, compare its SHA-256, and replay `shouldApplyBundle` against the live releases list.

## Testing on a real phone

A single USB-connected phone (adb is at `%LOCALAPPDATA%/Android/Sdk/platform-tools/adb.exe`, not on PATH) plus scripted socket.io clients against the Render URL can stand in for a multi-phone squad. Drive the phone with `adb shell input tap/text` and read it with `adb exec-out screencap -p`. The rules:
- **Never toggle airplane mode or the phone's network.** The dev PC gets its internet from the phone's hotspot. Airplane mode cuts that hotspot and disconnects the scripted clients too. To take LOCUS offline, force-stop it: `adb shell am force-stop com.locus.app`.
- **The app doesn't keep its squad across a restart.** After a force-stop, rejoin from the lobby with JOIN SQUAD and the code.
- **The phone has a secure lock screen.** The owner must unlock it. Ask before changing any phone setting (e.g. `svc power stayon usb` to stop it locking mid-test), and restore the setting afterwards.
