# 🛡️ LOCUS SYSTEM ARCHITECTURE SPECIFICATION
**Tactical Campus Geofencing & AR Wayfinding Network**
*SRM Institute of Science & Technology (Kattankulathur Campus / SRM KTR)*

---

## 1. SYSTEM IDENTIFICATION & HIGH-LEVEL OVERVIEW
- **System Name:** LOCUS
- **Primary Objective:** Deliver real-time tactical spatial tracking, augmented reality wayfinding, squad telemetry synchronization, dynamic geofencing, and AI-assisted campus reconnaissance for operatives at SRM KTR.
- **Target Platforms:** Mobile Web Browsers (PWA), Native Android/iOS Shells (via Capacitor), and Desktop Web Terminals.
- **Design Aesthetic:** High-contrast cyberpunk/tactical HUD, glassmorphism (`backdrop-blur`), dark-mode palette (`#000000` base with `#EF4444` tactical red, `#10B981` emerald, `#3B82F6` blue, and `#EAB308` yellow accents), custom pixel/dot typography (`font-dot`), and real-time telemetry indicators.

---

## 2. ARCHITECTURAL STACK & INFRASTRUCTURE

### 2.1 Client Application (Frontend Layer)
- **Core Framework:** React 19 (ESM Modules, React Hooks)
- **Build System:** Vite 7 with `@vitejs/plugin-react`
- **Styling Engine:** TailwindCSS v4 with PostCSS & Autoprefixer
- **UI Animation & Gesture Engine:** Framer Motion v12 (`AnimatePresence`, touch swipe gesture handlers, spring physics)
- **Mapping & Spatial Renderers:**
  - `google-map-react` v2.2 (Google Maps JavaScript API wrapper with custom styled dark map vector layers & orbital satellite views)
  - `leaflet` v1.9 / `react-leaflet` v5 (Fallback map engine)
  - Hexagonal Grid Canvas Renderer (`HexGridOverlay.js`)
- **Iconography:** Lucide React v0.577
- **Sensors & Hardware APIs:**
  - HTML5 Geolocation API (`navigator.geolocation.watchPosition`)
  - DeviceOrientation Event API (`window.addEventListener('deviceorientation')` for magnetometer compass heading)
  - Media Devices Camera API (`navigator.mediaDevices.getUserMedia` for AR optics feed)

### 2.2 Application Server (Backend Layer)
- **Runtime & Framework:** Node.js (v20+) with Express v5
- **Real-Time Communication:** Socket.IO v4.8 (WebSockets with fallback long-polling)
- **Cross-Origin Policy:** `cors` middleware enabled for open socket handshake and API endpoints
- **Deployment Endpoint:** Render Cloud (`https://locus-1-896t.onrender.com`)

### 2.3 Cloud Services & Database Layer
- **Authentication Engine:** Firebase Auth v12 (Email/Passkey, Profile Display Names, Tactical Avatar Sync, Password Recovery via `sendPasswordResetEmail`)
- **Real-Time Cloud Database:** Firebase Firestore v12 (Geofence zone coordinate persistence, custom user waypoints, squad permissions)
- **AI Intelligence Subsystem:** Google Gemini 1.5 Flash API (`SYS_ORACLE` Neural Link)

### 2.4 Mobile Native Container
- **Cross-Platform Wrapper:** Capacitor v8 (`@capacitor/core`, `@capacitor/android`, `@capacitor/cli`)
- **Viewport Safe-Area Management:** CSS `env(safe-area-inset-top)` and `env(safe-area-inset-bottom)` for notch and home-bar clearance.

---

## 3. CORE FILE STRUCTURE & MODULE RESPONSIBILITIES

```
LOCUS/
├── backend/
│   └── server.js                # Node.js + Express + Socket.IO server engine
├── src/
│   ├── main.jsx                 # Application entry point
│   ├── App.jsx                  # Primary tactical layout, state orchestrator, HUD & modals
│   ├── ARCompass.jsx            # Augmented Reality viewfinder, bearing math, magnetometer calibration
│   ├── srmDatabase.js           # SRM_MASTER_DATABASE containing calibrated campus building coordinates
│   ├── LocusGuide.jsx           # Interactive operational manual & onboarding modal
│   ├── HexGridOverlay.js        # Canvas overlay rendering tactical hex grid on map
│   ├── firebase.js              # Firebase SDK init (Auth, Firestore, Google Provider)
│   └── index.css                # Global CSS rules, custom fonts (font-dot), custom scrollbars
├── capacitor.config.json        # Capacitor Android/iOS deployment configuration
├── vite.config.js               # Vite bundler options
└── package.json                 # Dependency manifest
```

---

## 4. WEBSOCKET COMMUNICATIONS & PROTOCOL SCHEMA

The system uses Socket.IO to broadcast real-time telemetry across squad rooms (`roomCode`).

### 4.1 Gatekeeper & Squad Access Protocol
- `request-join` (`{ roomCode, user, intent }`): Sent to create or enter a squad. `intent` says which:
  - `'create'` (INITIALIZE): founds the squad, requester becomes `OWNER`. Refused with `squad-code-taken` if a live squad already has the code, unless the requester is that squad's Commander (a retry).
  - `'join'` (CONNECT, and a member's or waiting joiner's reconnect): refused with `squad-not-found` if no live squad has the code. It never founds one.
  - none, or `'resume'`: create-or-join, the original behaviour. Every build without intents sends none; a Commander's reconnect sends `'resume'`, so a squad wiped by a server restart comes back under its code.
  - For an existing squad, a known member or the Commander is let straight back in; anyone else is recorded as pending and routed to the Commander for approval.
- `access-request` (`{ targetId, name, photo, roomCode }`): Emitted by server to Commander. The squad's open requests are re-sent to whoever takes over as Commander (a reconnect, a caretaker, a promotion).
- `cancel-join` (`{ roomCode }`): Sent by a waiting joiner on ABORT HANDSHAKE. Withdraws their request.
- `access-request-withdrawn` (`{ targetId, roomCode }`): Emitted to the Commander when a request is withdrawn, superseded (the joiner asked again, or asked another squad), or its socket disconnects, and in reply to a decision on a request that is no longer open.
- `resolve-access` (`{ targetId, roomCode, approved }`): Sent by Commander to grant or deny entrance. Only decides a request still pending on that squad.
- `access-granted` (`{ role, roomCode }`) / `access-pending` (`{ roomCode }`) / `access-denied` (`{ roomCode }`): Emitted to operative. Each names its squad; the client ignores one about any other squad.
- `squad-not-found` / `squad-code-taken` (`{ roomCode }`): A refused `request-join` (see above). `squad-not-found` is also sent to joiners still waiting on a squad when it is deleted.

### 4.2 Telemetry & Position Engine
- `update-location` (`{ roomCode, lat, lng, speed, battery, status, name, photo, heading }`): Operative position ping broadcasted every 1s-15s (based on telemetry mode).
- `users-update` (`{ [socketId]: userData }`): Broadcasted by server to all operatives inside the `roomCode`.
- `safety-ping` (`{ latitude, longitude, timestamp, batteryLevel }`): Sent to server for Last Known Location (LKL) caching.
- `member-signal-lost`: Fired by server when an operative disconnects unexpectedly, packaging trajectory vector (`lastKnownLocation`, `heading`, `speed`, `timeDelta`) for Pre-Cog tracking.

### 4.3 Tactical Targeting & Waypoints
- `publish-waypoint` (`{ roomCode, waypoint: { lat, lng, name } }`): Any squad member deploys a persistent rally point (the targeting FAB, the Commander's RALLY POINT button, or choosing a building destination). The server records who dropped it as `setBy` (their uid, or socket id without one), never taken from the payload.
- `clear-waypoint` (`roomCode`): Removes the squad's rally point. Allowed for the Commander (any rally point) and for the member who dropped it (the ✕ on the marker, or closing the route panel that published it).
- `new-waypoint` (`{ lat, lng, name, setBy }`) / `remove-waypoint`: Server broadcast to room members. Every (re)admitted member is also sent the current state, as `remove-waypoint` when there is none, so one who missed a clear while offline doesn't keep a rally point nobody else has.

### 4.4 Geofence & Emergency Alerts
- `geofence-alert` (`{ roomCode, userName, type: 'ENTER'|'EXIT', zoneName }`): Broadcasts perimeter breach alerts across the squad.
- `publish-zone` / `new-zone`: Distributes custom tactical polygon zones drawn by Commander.
- `ping-user` / `receive-ping`: Single-target member ping (sonar blip + short HUD notice), relayed only between members of the same squad. Not an SOS — see `sos-broadcast`.

### 4.5 Governance & Mutiny Protocol
- `vote-to-kick` (`{ targetId, roomCode }`): Operatives cast votes to exile rogue squad members.
- `mutiny-status` (`{ targetId, votes, required }`): Broadcasts live vote progress.
- `exiled`: Emitted to targeted user when majority vote threshold is reached.
- `promoted-to-owner` (`{ roomCode }`): Succession when the Commander leaves the squad (or is voted out); not on a mere disconnect, which could be a signal blip.

---

## 5. HARDWARE INTEGRATIONS & AR ENGINE

### 5.1 AR Viewfinder (`ARCompass.jsx`)
- **Optics Pipeline:** Accesses device camera via `getUserMedia({ video: { facingMode: 'environment' } })`.
- **Sensory Mathematics:**
  - **Haversine Formula:** Computes precise ground distance (meters/kilometers) between operative GPS (`liveLocation`) and designated target (`arTarget`).
  - **Bearing Angle Calculation:**
    $$\theta = \text{atan2}\left(\sin(\Delta\lambda)\cdot\cos(\phi_2), \cos(\phi_1)\cdot\sin(\phi_2) - \sin(\phi_1)\cdot\cos(\phi_2)\cdot\cos(\Delta\lambda)\right)$$
  - **Relative Heading Offset:** Calculates angular offset between real-time magnetometer orientation and target direction to render dynamic target reticle and direction arrow.
- **Instrument Flight Rules (IFR) Fallback:** If camera access is denied or operative is in zero-light conditions, system seamlessly transitions to HUD pitch-black mode without interrupting heading indicator or distance telemetry.
- **Figure-8 Sensor Calibration Warning:** Detects magnetic flux anomalies and alerts operative to perform standard magnetometer figure-8 calibration motion.

---

## 6. AI ORACLE INTEGRATION (`SYS_ORACLE`)

- **Model Engine:** Google Gemini 1.5 Flash API (`gemini-1.5-flash`)
- **Request Flow:** Client constructs spatial awareness payload containing:
  - Operative Online Status (`MY_STATUS`)
  - Live Squad Telemetry (`SQUAD_TELEMETRY`)
  - 3 Closest Campus Buildings (`NEAREST_BUILDINGS`) calculated via distance sorting from `SRM_MASTER_DATABASE`.
- **System Directive:**
  > "You are SYS_ORACLE, a tactical AI on the LOCUS network at SRM KTR. Keep answers strictly under 3 sentences. Use a concise, military-comms tone. Provide spatial awareness when asked."
- **Backend Oracle Endpoint:** `/api/oracle` (proxies Gemini API requests using server-side `GEMINI_API_KEY`)

---

## 7. USER INTERFACE & MOBILE UX SPECIFICATION

### 7.1 Viewport Architecture
- **Header:** Purged of redundant buttons; displays LOCUS branding + dynamic state indicator (`TACTICAL GRID` vs `ORBITAL RECON`) + Disconnect button.
- **Sidebar (Matrix / Squad View):**
  - Desktop: Fixed left column panel.
  - Mobile: Slide-up bottom sheet overlay with drag handles.
  - Swipe Navigation: Touch handlers (`onTouchStart` / `onTouchEnd`) enable horizontal swiping to toggle between MATRIX (Buildings) and SQUAD (Operatives) views, accompanied by minimalist dot indicators (`● ○` / `○ ●`).
- **Bottom HUD (Mobile):**
  - `GRID`: Toggles Dark Vector Map ↔ Satellite Recon view.
  - `SCAN`: Initiates AR Compass targeting nearest squad member or SRM HQ.
  - `SQUAD`: Opens squad management panel.

### 7.2 Two-Step Tactical Targeting Mode
- **Idle State:** Red FAB with Crosshair icon.
- **Active State:** Tapping FAB engages **Targeting Mode** (FAB turns pulsing Yellow with Cancel `X` icon, top banner displays `TARGETING MODE ACTIVE: TAP ANYWHERE ON MAP TO DEPLOY RALLY POINT`).
- **Map Click Intercept:** `handleMapClick` captures exact map tap coordinates, publishes `RALLY POINT` waypoint to server, and disengages targeting mode.

---

## 8. SECURITY, AUTHENTICATION & RECOVERY PROTOCOLS

- **Authentication Method:** Email / Passkey authentication via Firebase Auth (`signInWithEmailAndPassword`, `createUserWithEmailAndPassword`).
- **Mobile WebView Compatibility:** Direct Email/Passkey login enforces session stability in Capacitor WebViews, avoiding session wipe crashes associated with OAuth redirects inside native shells.
- **Dynamic Avatar Generation:** New accounts automatically generate a tactical bot avatar seed using DiceBear API (`https://api.dicebear.com/7.x/bottts/svg?seed=${username}`).
- **Key Recovery:** `sendPasswordResetEmail(auth, email)` dispatches encrypted password reset link to user's registered email with custom error mapping (`auth/user-not-found`, `auth/too-many-requests`).

---

## 9. AUTO-UPDATE SYSTEM

LOCUS is distributed as a sideloaded APK rather than through Google Play. The application therefore ships its own update mechanism, in two tiers. In both tiers the GitHub Release **is** the update manifest — there is no separate manifest file, and no client change is required per release.

- **Phase 1 (Native Full-APK):** Replaces the entire APK. Carries any change — native permissions, Capacitor plugins, manifest edits, icons. Tag series `v1.2.0`, asset `locus-latest.apk`, cut via `npm run release -- <version>`. No dependencies.
- **Phase 2 (JS-Only Bundle):** Replaces the web bundle inside the installed native shell. Carries JS, UI and CSS only. Tag series `js-1.2.1`, asset `locus-bundle.zip`, cut via `npm run release:bundle -- <version>`. One dependency (`@capgo/capacitor-updater`).

Tier selection is determined by a single condition: any change touching `android/` or adding a Capacitor plugin requires Phase 1.

### 9.1 Module Responsibilities

```
LOCUS/
├── android/app/src/main/java/com/locus/app/
│   ├── LocusUpdaterPlugin.java   # Native: streamed download, SHA-256, FileProvider install intent
│   └── MainActivity.java         # Registers LocusUpdaterPlugin (local plugin, not auto-discovered)
├── src/
│   ├── utils/
│   │   ├── updateManifest.js     # Phase 1 release-body parsing + semver comparison (pure)
│   │   ├── locusUpdater.js       # registerPlugin bridge to LocusUpdater, rejecting web stub
│   │   ├── liveUpdateManifest.js # Phase 2 parsing, bundle selection, MIN_NATIVE gate (pure)
│   │   └── liveUpdater.js        # CapacitorUpdater bridge, notifyAppReady
│   ├── hooks/
│   │   ├── useAppUpdate.js       # Phase 1 policy: throttle, check, permission flow, download
│   │   └── useLiveUpdate.js      # Phase 2 policy: throttle, compatibility gate, stage bundle
│   └── components/
│       ├── UpdateModal.jsx       # HUD update modal and mandatory-update gate
│       └── LiveUpdateToast.jsx   # Bundle-staged restart prompt
├── scripts/
│   ├── release.mjs               # Phase 1: bump, build, sign, tag, publish
│   ├── release-bundle.mjs        # Phase 2: build, zip, publish to the js-* tag series
│   ├── verify-release.mjs        # Post-publish verification of either tier
│   └── lib/zip.mjs               # Dependency-free ZIP writer (spec-correct entry names)
└── UPDATER.md                    # Operator reference: keystore setup, release and device procedures
```

### 9.2 Phase 1 — Native Full-APK Updater

- **`LocusUpdaterPlugin.java`:** Capacitor plugin registered as `LocusUpdater`. Streams the APK into `cacheDir/updates`, computing SHA-256 concurrently with the write so verification costs no second pass. Emits throttled `downloadProgress` events. Exposes install-permission status, a deep link to Android's per-app consent screen, and the install trigger.
- **`updateManifest.js`:** Parses the GitHub `releases/latest` payload. Extracts version from `tag_name`, download URL from the `locus-latest.apk` asset, and `SHA256:` / `[MANDATORY]` markers from the release body. Pure; no network or Capacitor dependency.
- **`useAppUpdate.js`:** Owns all policy — cold-start throttle, version comparison, permission sequencing, download orchestration and error mapping. The native layer holds no policy.
- **`UpdateModal.jsx`:** HUD-styled modal. Renders version transition, release notes, package size and download progress. Under `[MANDATORY]` it becomes a full-viewport gate with no dismissal path.
- **`release.mjs`:** Single-command release. Refuses a dirty tree, a reused tag, or a non-newer version; bumps `versionCode`/`versionName`, builds, syncs Capacitor, assembles a signed release APK, computes the SHA-256, and publishes the tagged GitHub Release with the checksum written into the body.

**Release Flow**

```bash
npm run release -- 1.1.0     # bump -> build -> sign -> tag -> publish
npm run release:verify       # verify the PUBLISHED artifact, not the local build
```

`verify-release.mjs` re-downloads the published asset and re-checks it using the same parsing modules the client runs: release parses, checksum matches the published body, APK `versionName` matches the tag, and the signature verifies with its certificate digest printed for comparison against prior releases.

**Device Flow**

1. Check on cold start, throttled to once per process (module-scope flag), plus a manual trigger in `LocusGuide.jsx`. No periodic background polling.
2. Compare the release version against the installed version via `App.getInfo()`.
3. Parse the release body. Any unparseable field aborts the check.
4. Present the HUD modal — `UPDATE NOW` / `LATER`; `LATER` is not rendered when `[MANDATORY]` is set.
5. Query install permission. If ungranted, present an in-app consent explanation, deep-link to Android's "install unknown apps" screen, and auto-resume the download on app resume once granted.
6. Stream the download to `cacheDir/updates`, computing SHA-256 during transfer.
7. Compare against the published checksum. On mismatch, purge the file and surface a visible integrity error.
8. Validate that the install path resolves inside the app's own cache directory.
9. Hand off via `FileProvider` URI + `ACTION_VIEW` to the Android system installer.
10. Android performs its own signature check against the currently-installed application.

**Failure Semantics**

Every failure mode resolves to either "no update" or a visible abort. No path produces a silent bad install.

- Unparseable `tag_name` → no update
- Missing `SHA256:` line → release rejected, install never offered
- Missing `locus-latest.apk` asset → release rejected
- Checksum mismatch → download purged, visible integrity error, no installer invocation
- Install path outside `cacheDir/updates` → rejected by the native layer

**Signing Constraint**

Android refuses to install an update whose signing certificate differs from the installed application. Every release must therefore be signed with the same keystore, permanently. If that keystore is lost, a resigned APK is rejected as an update by every device already running a build signed with the prior key; recovery requires every user to uninstall and reinstall by hand — precisely the distribution step this system exists to eliminate. Keystore generation, backup and restore-verification procedures are specified in `UPDATER.md`.

### 9.3 Phase 2 — JS-Only Live Updates

`@capgo/capacitor-updater` in manual mode (`autoUpdate: "off"`) is the **sole dependency in the update system**, and the only exception to the project's otherwise dependency-free approach. It is required because swapping the web bundle inside a running native shell has no native equivalent that can be invoked from JavaScript; the alternative is reimplementing that bridge from scratch. The plugin performs the unzip-and-swap only. Manifest fetching, version selection and the compatibility gate remain in application code.

**Release Flow**

```bash
npm run release:bundle -- 1.0.1        # build -> zip -> publish to the js-* series
npm run release:verify -- --bundle     # verify the published bundle
```

Bundles are published to GitHub Releases under a `js-*` tag series, kept separate from the native `v*` series so the two never collide. The archive is produced by `lib/zip.mjs`, a dependency-free writer that emits `index.html` at the archive root with forward-slash entry names. The Render backend is deliberately excluded from the update-check path; bundles are served from GitHub, so backend availability cannot stall or block an update check.

**Manifest Fields**

Carried in the release body alongside the `locus-bundle.zip` asset:

```
SHA256: <64 hex>        # verified natively before the bundle is activated
MIN_NATIVE: <version>   # oldest native shell permitted to run this bundle
```

**Device Flow**

1. `notifyAppReady()` on launch, disarming the plugin's rollback timer. A bundle that fails to reach this call is reverted to the previous bundle on next launch.
2. Check on cold start, throttled once per process, matching Phase 1.
3. List releases, retain `js-*` tags, and select the **highest version** rather than the most recently created.
4. Evaluate `MIN_NATIVE` against the installed native version. The gate fails closed: an unreadable version on either side blocks the swap.
5. If the installed shell is below `MIN_NATIVE`, refuse the bundle and defer to Phase 1. A JS bundle cannot add a native permission or plugin, so a bundle requiring a capability the shell lacks is never applied.
6. Download and verify, then stage the bundle.
7. Present a restart prompt. `set()` reloads the WebView immediately, so activation is deferred to explicit user action rather than performed mid-session.

`resetWhenUpdate` is enabled, so a Phase 1 install discards downloaded bundles and lands on the JS compiled into that APK.

### 9.4 Phase Failure-Visibility Asymmetry

The two tiers fail with different visibility, and their verification procedures are structured differently as a direct consequence:

- **Phase 1 failures are visible.** A corrupt download, a mis-signed APK or a rejected install surfaces through an OS-level dialog or an explicit in-app integrity error. The operator sees the failure.
- **Phase 2 failures are silent.** No operating-system dialog exists for a bundle swap. A bundle that is incompatible, malformed or non-booting produces no notification — the failure mode is a white screen or a silent rollback on next launch.

This asymmetry is why Phase 1 verification leads with a deliberately corrupted checksum (confirming the abort path fires) while Phase 2 verification requires a successful swap to be demonstrated **before** the compatibility gate is tested — a Phase 2 refusal is indistinguishable from a check that never ran, so the pipeline must be proven working first. The procedures are intentionally not symmetric and should not be normalised into matching shapes.

---

## 10. DATABASE SCHEMA (SRM MASTER DATABASE)

The system relies on calibrated GPS center points for all major SRM KTR campus sectors in `srmDatabase.js`:
- **Categories:** `ACADEMIC`, `ENGINEERING`, `MEDICAL`, `RESIDENTIAL`, `HUB`
- **Data Structure:**
  ```javascript
  {
    id: Number,
    name: String (UPPERCASE),
    category: String,
    lat: Number (Float64),
    lng: Number (Float64),
    info: String
  }
  ```
- **Examples:**
  - `UNIVERSITY BUILDING` (12.823650, 80.042450)
  - `TECH PARK` (12.824650, 80.046550)
  - `SRM GLOBAL HOSPITALS` (12.821200, 80.045100)
  - `T.P. GANESAN AUDITORIUM` (12.824900, 80.045100)

---

## 11. BUILD & DEPLOYMENT PIPELINE

### 1. Web Local Development:
```bash
npm run dev
```

### 2. Backend Server Execution:
```bash
npm run server
```

### 3. Full Stack Concurrent Execution:
```bash
npm run dev:all
```

### 4. Production Web Build & Capacitor Android Sync:
```bash
npm run build
npx cap sync
```

---
*DOCUMENT END // SYS_ORACLE ARCHITECTURE ARCHIVE VERIFIED*
