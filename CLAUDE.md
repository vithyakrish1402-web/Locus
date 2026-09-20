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

npm run release -- 1.1.0          # cut a full-APK release (Phase 1 updater)
npm run release:bundle -- 1.0.1   # ship a JS-only live update (Phase 2 updater)
npm run release:verify            # check a published release the way a device would
```

Both release commands need the `gh` CLI authenticated; `npm run release` also needs the
signing keystore configured in `android/local.properties`. See **`UPDATER.md`** — it is the
reference for the whole update system, including the one-time keystore setup and the
real-device verification steps.

Tests use Vitest and live in `tests/` (geoMath, precognition, squadCode, markerStatus, serverLogic); they cover the pure helpers in `src/utils/` and server logic, not the UI. There is no lint script wired into `package.json` (ESLint config exists at `eslint.config.js`; run it directly with `npx eslint .` if needed).

The backend does not currently require any `.env` variables — the `GEMINI_API_KEY`-backed `/api/oracle` proxy it once used was deliberately removed (see the architecture-doc note above). `npm run server` still loads `.env` via `--env-file` if one exists, but nothing in the server reads from it today.

## Architecture

**Frontend**: React 19 + Vite 7 + Tailwind v4. `App.jsx` is a single large component holding almost all state (auth, map, squad/telemetry, AR targeting, geofencing, AI oracle chat, UI modals) — when making changes, expect to work within this file rather than finding separate feature modules. Maps are rendered via `google-map-react` (primary, dark-styled) with Leaflet as a fallback engine.

**Backend**: `backend/server.js` is a single-file Express + Socket.IO server with no persistence layer — all squad/room/location state lives in in-memory objects (`activeSquads`, `users`, `locationCache`) and is lost on restart. It also proxies AI queries to Gemini (`POST /api/oracle`) so the API key never reaches the client. The frontend picks the backend URL via `VITE_BACKEND_URL`, falling back to `http://localhost:5000` on localhost or the deployed Render URL otherwise (`App.jsx:52`).

**Real-time protocol**: Squad coordination (join/approve/kick, live location broadcast, waypoints, geofence alerts, "signal lost" dead-man's-switch on disconnect) all flows over Socket.IO events between `App.jsx` and `backend/server.js`. When touching either side of a socket event, grep the other file for the matching event name — the full event catalogue is documented in section 4 of `LOCUS_SYSTEM_ARCHITECTURE.md`.

**Firebase**: Used client-side only, for Auth (email/password — no OAuth redirect flow, deliberately, to stay stable inside the Capacitor WebView) and Firestore (tactical zone persistence). Config in `src/firebase.js` is a public client config, not a secret.

**Mobile**: Wrapped via Capacitor (`android/` is the generated native project). After any frontend change intended for the mobile build, run `npm run build` then `npx cap sync`.

**Updates**: The app updates itself rather than being hand-distributed — see `UPDATER.md`. Two tiers, and which one a change belongs to is decided by one question: *does it touch `android/` or add a Capacitor plugin?*
- **Yes** → Phase 1, a full APK release (`npm run release -- <version>`). Built on a locally-defined native plugin (`android/app/src/main/java/com/locus/app/LocusUpdaterPlugin.java`, registered by hand in `MainActivity`) with no npm dependencies. A `[MANDATORY]` marker in the release body turns the update modal into a gate that pre-empts every render branch in `App.jsx`.
- **No** → Phase 2, a JS-only bundle (`npm run release:bundle -- <version>`), which swaps the web bundle inside the installed shell with no reinstall. Uses `@capgo/capacitor-updater` in manual mode. The `MIN_NATIVE` line in a `js-*` release body is the compatibility gate that keeps a bundle off a shell too old to run it — it fails closed, and `src/utils/liveUpdateManifest.js` is where that logic lives.

In both tiers the GitHub release *is* the manifest; there is no separate JSON file. Don't hand-edit `versionCode`/`versionName` or attach release assets by hand — the release scripts keep the published checksum and the binary in sync.
