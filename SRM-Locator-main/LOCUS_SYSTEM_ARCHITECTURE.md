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
- `request-join` (`{ roomCode, user }`): Sent by operative attempting to enter a squad. If room does not exist, operative becomes `OWNER`. If room exists, request is routed to Commander for approval.
- `access-request` (`{ targetId, name, photo, roomCode }`): Emitted by server to Commander.
- `resolve-access` (`{ targetId, roomCode, approved }`): Sent by Commander to grant or deny entrance.
- `access-granted` / `access-denied`: Emitted to operative upon Commander decision.

### 4.2 Telemetry & Position Engine
- `update-location` (`{ roomCode, lat, lng, speed, battery, status, name, photo, heading }`): Operative position ping broadcasted every 1s-15s (based on telemetry mode).
- `users-update` (`{ [socketId]: userData }`): Broadcasted by server to all operatives inside the `roomCode`.
- `safety-ping` (`{ latitude, longitude, timestamp, batteryLevel }`): Sent to server for Last Known Location (LKL) caching.
- `member-signal-lost`: Fired by server when an operative disconnects unexpectedly, packaging trajectory vector (`lastKnownLocation`, `heading`, `speed`, `timeDelta`) for Pre-Cog tracking.

### 4.3 Tactical Targeting & Waypoints
- `publish-waypoint` (`{ roomCode, waypoint: { lat, lng, name } }`): Commander/Operative deploys a persistent rally point.
- `clear-waypoint` (`roomCode`): Removes active rally point for the squad.
- `new-waypoint` / `remove-waypoint`: Server broadcast to room members.

### 4.4 Geofence & Emergency Alerts
- `geofence-alert` (`{ roomCode, userName, type: 'ENTER'|'EXIT', zoneName }`): Broadcasts perimeter breach alerts across the squad.
- `publish-zone` / `new-zone`: Distributes custom tactical polygon zones drawn by Commander.
- `ping-user` / `receive-ping`: Haptic/visual ping trigger sent between squad members.

### 4.5 Governance & Mutiny Protocol
- `vote-to-kick` (`{ targetId, roomCode }`): Operatives cast votes to exile rogue squad members.
- `mutiny-status` (`{ targetId, votes, required }`): Broadcasts live vote progress.
- `exiled`: Emitted to targeted user when majority vote threshold is reached.
- `promoted-to-owner`: Automatic succession transfer if Commander disconnects.

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
- **Direct Client Endpoint:** `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${VITE_GEMINI_API_KEY}`

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

## 9. DATABASE SCHEMA (SRM MASTER DATABASE)

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

## 10. BUILD & DEPLOYMENT PIPELINE

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
