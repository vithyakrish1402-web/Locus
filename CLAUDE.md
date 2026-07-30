# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

The actual application lives entirely inside **`SRM-Locator-main/`**. The repo root only contains a stray `package.json`/`capacitor.config.json` left over from an earlier layout — there is no `index.html` or `src/` at the root, so nothing there is buildable. Always `cd SRM-Locator-main` (or target paths under it) before running any command.

```
SRM-Locator-main/
├── backend/server.js       # Express + Socket.IO server (real-time squad/location relay + Gemini proxy)
├── src/
│   ├── App.jsx              # ~145KB monolithic component: nearly all app state, UI, and logic live here
│   ├── ARCompass.jsx        # AR camera viewfinder, bearing/heading math
│   ├── LocusGuide.jsx       # Onboarding/help modal
│   ├── TacticalZone.jsx     # Geofence zone rendering
│   ├── srmDatabase.js       # SRM_MASTER_DATABASE — static campus building coordinates
│   ├── firebase.js          # Firebase SDK init (Auth + Firestore)
│   └── main.jsx             # Entry point
├── android/                 # Capacitor-generated native Android project
└── LOCUS_SYSTEM_ARCHITECTURE.md  # Detailed system/protocol spec — read this for deep context
```

**`LOCUS_SYSTEM_ARCHITECTURE.md`** documents the intended architecture, AI oracle integration, and full WebSocket protocol schema in detail. It is mostly accurate but has drifted in places (e.g. `HexGridOverlay.js` and the geofence painter it describes were deleted — see `git log`). Treat it as a good map, not ground truth; verify against actual source when specifics matter.

## Commands

Run all commands from `SRM-Locator-main/`:

```bash
npm run dev        # start Vite dev server (frontend only)
npm run server     # start backend (Express + Socket.IO), loads .env via --env-file
npm run dev:all     # frontend + backend + localtunnel concurrently
npm run build       # production build (outputs to dist/)
npx cap sync         # sync web build into the Capacitor Android project
```

There is no test suite and no lint script wired into `package.json` (ESLint config exists at `eslint.config.js`; run it directly with `npx eslint .` if needed).

The backend requires a `.env` file in `SRM-Locator-main/` with `GEMINI_API_KEY` set (used by the `/api/oracle` proxy endpoint). There's no `.env.example` committed.

## Architecture

**Frontend**: React 19 + Vite 7 + Tailwind v4. `App.jsx` is a single large component holding almost all state (auth, map, squad/telemetry, AR targeting, geofencing, AI oracle chat, UI modals) — when making changes, expect to work within this file rather than finding separate feature modules. Maps are rendered via `google-map-react` (primary, dark-styled) with Leaflet as a fallback engine.

**Backend**: `backend/server.js` is a single-file Express + Socket.IO server with no persistence layer — all squad/room/location state lives in in-memory objects (`activeSquads`, `users`, `locationCache`) and is lost on restart. It also proxies AI queries to Gemini (`POST /api/oracle`) so the API key never reaches the client. The frontend picks the backend URL via `VITE_BACKEND_URL`, falling back to `http://localhost:5000` on localhost or the deployed Render URL otherwise (`App.jsx:32`).

**Real-time protocol**: Squad coordination (join/approve/kick, live location broadcast, waypoints, geofence alerts, "signal lost" dead-man's-switch on disconnect) all flows over Socket.IO events between `App.jsx` and `backend/server.js`. When touching either side of a socket event, grep the other file for the matching event name — the full event catalogue is documented in section 4 of `LOCUS_SYSTEM_ARCHITECTURE.md`.

**Firebase**: Used client-side only, for Auth (email/password — no OAuth redirect flow, deliberately, to stay stable inside the Capacitor WebView) and Firestore (tactical zone persistence). Config in `src/firebase.js` is a public client config, not a secret.

**Mobile**: Wrapped via Capacitor (`android/` is the generated native project). After any frontend change intended for the mobile build, run `npm run build` then `npx cap sync`.
