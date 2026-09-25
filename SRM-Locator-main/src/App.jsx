import { io } from "socket.io-client";
import { Capacitor } from '@capacitor/core';
import React, { useState, useEffect, useRef, useMemo, useCallback, Suspense } from 'react';
// `motion` is used throughout via <motion.div>/<motion.nav> JSX member expressions.
// This project's eslint config has no eslint-plugin-react (only react-hooks/react-refresh),
// so core no-unused-vars can't see through JSXMemberExpression tag names — false positive.
// eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence, useDragControls, useReducedMotion } from 'framer-motion';
import GoogleMapReact from 'google-map-react';
import {
  MapPin, Users, Search, Settings, Navigation, ShieldCheck,
  Building2, Sparkles, MessageSquare, Send, Loader2,
  BrainCircuit, UserCheck, Ban, LogOut, LockKeyhole, Eye, EyeOff, ArrowRight, X,
  Wifi, WifiOff, Bluetooth, Radio, LocateFixed, Waypoints, Activity,
  Target, Sliders, Volume2, VolumeX, Map, Battery, Zap, Bell, ShieldAlert, Terminal, Route, Crosshair, Trash2, Scan, RefreshCw, Globe, Layers
} from 'lucide-react';
// ... your other imports (React, framer-motion, lucide-react, etc.)


// 👇 ADD THIS LINE RIGHT HERE
import LocusGuide from './LocusGuide';
import ARCompass from './ARCompass';
import { SRM_MASTER_DATABASE } from './srmDatabase';
import { useDeviceHeading } from './hooks/useDeviceHeading';
import { useLiveHeading } from './hooks/useLiveHeading';
import { useGhostProjectionLines } from './hooks/useGhostProjectionLines';
import { useWaypointNavigationLine } from './hooks/useWaypointNavigationLine';
import { useWalkingRoute } from './hooks/useWalkingRoute';
import LiveLocationMarker, { NAVIGATING_SPEED_MPS } from './LiveLocationMarker';
import GhostMemberMarker from './GhostMemberMarker';
import WaypointMarker from './components/WaypointMarker';
import BuildingMarker from './components/BuildingMarker';
import SosTrigger from './components/SosTrigger';
import SosOverlay from './components/SosOverlay';
import UpdateModal from './components/UpdateModal';
import LiveUpdateToast from './components/LiveUpdateToast';
import BottomTabBar from './components/BottomTabBar';
import CommsFeed from './components/CommsFeed';
import { CodeTiles, CodeInput } from './components/SquadCode';
import SquadMemberCard from './components/SquadMemberCard';
import { sortByDistance } from './utils/direction';
import { notify } from './utils/notify';
import { useIncomingSos } from './hooks/useIncomingSos';
import { useAppUpdate } from './hooks/useAppUpdate';
import { useLiveUpdate } from './hooks/useLiveUpdate';
import { useBackButtonGuard } from './hooks/useBackButtonGuard';
import { useWifiFusion } from './hooks/useWifiFusion';
import { useIndoorView } from './hooks/useIndoorView';
import { WIFI_POSITIONING_ENABLED, SHOW_INDOOR_POSITION_TO_SQUAD } from './utils/positionSource';
import { isOnOtherFloor, memberFloorTag } from './utils/indoorView';
import { ConfidenceHalo, FloorTag } from './components/IndoorMarkers';
import FloorPicker from './components/FloorPicker';
import WifiReadout from './components/WifiReadout';
import { useIsMobile } from './hooks/useIsMobile';
import { haptic } from './utils/haptics';
import { shouldDismissSheet, SHEET_SPRING, PANEL_SPRING, modalBackdrop, modalCard } from './utils/motion';
import { deriveGhostMembers, GHOST_FADE_MS } from './utils/ghostProjection';
import { generateRandomSquadCode } from './utils/squadCode';
import { PrecognitionFilter } from './utils/precognition';
import { formatTacticalDistanceBracketed as calculateDistance } from './utils/geoMath';

// Leaflet (+ react-leaflet) is a real chunk of weight that's only needed if
// Google Maps fails to load — code-split it so the common path never pays
// for it.
const TacticalLeafletMap = React.lazy(() => import('./components/TacticalLeafletMap'));
// --- ADDED: FIREBASE AUTH ---
import { auth, googleProvider } from './firebase';
import {
  signInWithPopup,
  onAuthStateChanged,
  signOut,
  signInWithEmailAndPassword,       // <-- Required for standard Login
  createUserWithEmailAndPassword,
  updateProfile,    // <-- Required for new Registration
  sendPasswordResetEmail
} from 'firebase/auth';

// Capacitor's Android/iOS WebView serves the bundled app from "https://localhost" by
// default, which is indistinguishable from a real local dev server by hostname alone.
// Without this check, the native app would try to hit a "backend" on the phone itself
// and never reach the real server at all. Capacitor.isNativePlatform() is the only
// reliable way to tell "actually running inside the app" apart from "actually on localhost".
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL
  || (!Capacitor.isNativePlatform() && window.location.hostname === 'localhost'
    ? 'http://localhost:5000'
    : 'https://locus-1-896t.onrender.com');

const socket = io(BACKEND_URL, {
  transports: ['websocket'],
  upgrade: false
});

// Baked in at Vite build time from .env's VITE_GOOGLE_MAPS_API_KEY (gitignored) —
// never hardcode this. The Capacitor/Android build reads the same key separately from
// android/local.properties (see AndroidManifest.xml's MAPS_API_KEY meta-data placeholder).
const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

if (!GOOGLE_MAPS_API_KEY) {
  // Say this out loud. Without a key Google would still "work" — it just renders a
  // watermarked "For development purposes only" map — which looks like an app bug
  // rather than a missing build secret. The app uses the keyless Leaflet engine
  // instead; this line explains why the map looks different from the Google one.
  console.warn(
    '[SYS_MAP] No VITE_GOOGLE_MAPS_API_KEY set — using the keyless Leaflet/OSM engine. ' +
    'To use Google Maps, put a billing-enabled Maps JavaScript API key in SRM-Locator-main/.env (see .env.example).'
  );
}

const SRM_KTR_COORDS = { lat: 12.8237, lng: 80.0444 };

// --- COMMANDER TELEMETRY SYNC ---
// How long SYNC_TELEMETRY waits for the server before saying it got no answer.
const TELEMETRY_SYNC_TIMEOUT_MS = 8000;
// What the server's refusals ('request-telemetry' in backend/server.js) mean to the Commander.
const TELEMETRY_SYNC_REFUSALS = {
  'not-owner': 'ONLY THE SQUAD COMMANDER CAN SYNC TELEMETRY.',
  'not-in-squad': 'THE SERVER HAS NO RECORD OF THIS SQUAD FOR THIS DEVICE. DISCONNECT AND REJOIN IT.',
};
// A telemetry value that is a real number, or null (never something toFixed() throws on).
// The square glass buttons down the map's right edge (recenter, locate, satellite, settings).
const MAP_CONTROL = 'p-3 bg-black/70 backdrop-blur-md border border-white/15 text-white shadow-[0_8px_24px_rgba(0,0,0,0.5)] hover:bg-white/10 hover:border-white/30';
const finiteOrNull = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
// A member's battery for the telemetry matrix: the first real reading of the heartbeat's
// `batteryLevel` ("77%") or update-location's `battery` (77). With neither there is no
// reading, and it is grey, not the green of a healthy battery: a member with no heartbeat
// yet, and the server's own 'Unknown' placeholder (which also used to win over a real
// `battery` number), both showed a green UNKNOWN.
const batteryReading = (cacheData) => {
  for (const raw of [cacheData?.batteryLevel, cacheData?.battery]) {
    const percent = typeof raw === 'number' ? raw : parseInt(raw, 10);
    if (Number.isFinite(percent)) {
      return { text: `${percent}%`, color: percent < 20 ? 'text-red-500' : 'text-emerald-500' };
    }
  }
  return { text: 'UNKNOWN', color: 'text-zinc-500' };
};

// --- MAP STYLE / OPTION CONSTANTS ---
// Deliberately module-scope: google-map-react shallow-compares the `options` prop,
// so these must keep a stable identity across renders. Rebuilding them inside the
// component made every render look like an options change and triggered a full
// map.setOptions() restyle each time.
const BASE_MAP_OPTIONS = {
  zoomControl: false, mapTypeControl: false, fullscreenControl: false, streetViewControl: false,
  mapTypeId: 'roadmap',
  tilt: 0,
  gestureHandling: 'greedy', // single-finger drag pans immediately — no "use two fingers" cooperative-mode fight
};

const SATELLITE_MAP_OPTIONS = {
  zoomControl: false, mapTypeControl: false, fullscreenControl: false, streetViewControl: false,
  mapTypeId: 'hybrid', // This triggers the real satellite imagery
  tilt: 0,
  gestureHandling: 'greedy',
  styles: [], // Clear custom styles so the photos show up
};

// Standard Cyberpunk Dark Theme
const TACTICAL_MAP_STYLES = [
  { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
  { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#d59563" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#263c3f" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#38414e" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#212a37" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#17263c" }] }
];

// Ultra-Minimal Stealth Theme (Pitch black, no POI icons, dark grey roads)
const STEALTH_MAP_STYLES = [
  { elementType: "geometry", stylers: [{ color: "#000000" }] },
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#333333" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#000000" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry.fill", stylers: [{ color: "#0a0a0a" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#111111" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#000000" }] }
];

// --- THE NEW AUTH TERMINAL (Replaces CinematicLanding) ---
// Shown while Firebase restores the saved session on a cold start. It used to be a single
// line of plain text; now a radar ring sweeps around it so the wait reads as work in
// progress, in the same visual language as the rest of the app. Reduced motion: no sweep.
const BootScreen = () => (
  <div className="h-screen bg-black text-white flex flex-col justify-center items-center gap-8 bg-dots" role="status" aria-live="polite">
    <div className="relative w-28 h-28" aria-hidden="true">
      <div className="absolute inset-0 rounded-full border border-white/15" />
      <div className="absolute inset-5 rounded-full border border-red-500/30" />
      <div className="absolute inset-[3.25rem] rounded-full bg-red-500 shadow-[0_0_14px_rgba(239,68,68,0.9)]" />
      <div className="absolute inset-0 rounded-full locus-radar-sweep" />
    </div>
    <div className="font-dot text-xs tracking-[0.3em] text-zinc-300">INITIALIZING_SECURE_LINK...</div>
  </div>
);

const AuthTerminal = ({
  email, setEmail, password, setPassword, showPassword, setShowPassword, executeAuthDirective, loginMethod, username, setUsername, latency
}) => {
  const [isRegistering, setIsRegistering] = useState(false);

  // --- 🔑 FORGOT PASSWORD / KEY RECOVERY HANDLER ---
  const handleForgotPassword = async () => {
    if (!email || !email.trim()) {
      notify.warning("[SYS_ERROR] ID // EMAIL IS REQUIRED FOR KEY RECOVERY.");
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email.trim());
      notify.success(`[RECOVERY_DISPATCHED] RESET SIGNAL TRANSMITTED TO ${email.trim().toUpperCase()}. CHECK YOUR INBOX.`);
    } catch (error) {
      console.error("Password Reset Error:", error.code);
      let errorMessage = `[SYS_FAILURE] ${error.message}`;
      switch (error.code) {
        case 'auth/user-not-found': errorMessage = "[ACCESS_DENIED] NO OPERATIVE FOUND WITH THIS EMAIL."; break;
        case 'auth/invalid-email': errorMessage = "[SYS_ERROR] MALFORMED ID // EMAIL SYNTAX."; break;
        case 'auth/too-many-requests': errorMessage = "[SEC_LOCKOUT] TOO MANY REQUESTS. STAND BY BEFORE RETRYING."; break;
      }
      notify.error(errorMessage);
    }
  };

  // Dynamic Ping Color Logic
  const getPingColor = (ping) => {
    if (!ping) return 'bg-zinc-500';
    if (ping < 80) return 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]';
    if (ping < 150) return 'bg-yellow-500 shadow-[0_0_8px_rgba(234,179,8,0.6)]';
    return 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)] animate-pulse';
  };

  return (
    <div className="relative w-full h-screen bg-black text-white font-inter selection:bg-red-500/30 flex items-center justify-center overflow-hidden bg-dots px-4">

      {/* 📡 RESTORED PING HUD 📡 */}
      <div className="absolute right-4 sm:right-8 z-50 flex items-center gap-3 font-dot text-xs tracking-widest text-zinc-400" style={{ top: 'max(1.5rem, calc(env(safe-area-inset-top) + 0.75rem))' }}>
        <span className="uppercase">SYS_PING</span>
        <div className="flex items-center gap-2 bg-zinc-900/50 border border-white/10 px-3 py-1">
          <div className={`w-2 h-2 rounded-full ${getPingColor(latency)}`} />
          <span className={latency > 150 ? 'text-red-500' : 'text-white'}>
            {latency ? `${latency}MS` : 'CALCULATING...'}
          </span>
        </div>
      </div>

      {/* Subtle background radar */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-20">
        <div className="w-[80vw] h-[80vw] max-w-3xl max-h-3xl border border-white/10 rounded-full flex flex-col items-center justify-center animate-[spin_60s_linear_infinite]">
          <div className="w-1/2 h-1/2 border border-red-500/20 rounded-full animate-[spin_30s_linear_infinite_reverse]" />
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.95, filter: 'blur(10px)' }}
        animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="w-full max-w-md p-7 sm:p-10 border border-white/20 bg-black relative pointer-events-auto z-10 shadow-[0_0_50px_rgba(255,255,255,0.05)]"
      >
        <div className="absolute top-0 left-0 w-2 h-2 bg-white" />
        <div className="absolute top-0 right-0 w-2 h-2 bg-white" />
        <div className="absolute bottom-0 left-0 w-2 h-2 bg-white" />
        <div className="absolute bottom-0 right-0 w-2 h-2 bg-white" />

        <div className="mb-10 text-left border-b border-white/20 pb-6 flex items-start justify-between">
          <div>
            <h2 className="text-3xl font-dot uppercase tracking-widest mb-2">Auth_Node</h2>
            <p className="text-red-500 font-dot text-xs">
              {isRegistering ? 'CREATING CREDENTIALS...' : 'AWAITING CREDENTIALS...'}
            </p>
          </div>
          <Waypoints size={32} className="text-zinc-600" />
        </div>

        <form onSubmit={(e) => { e.preventDefault(); executeAuthDirective('email', isRegistering); }} className="space-y-6 relative z-50">

          <AnimatePresence>
            {isRegistering && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-2 overflow-hidden"
              >
                <label className="text-xs font-dot text-white tracking-widest uppercase">CODENAME // Username</label>
                <input
                  type="text"
                  placeholder="E.G. GHOST_01"
                  className="w-full px-4 py-3 bg-black border border-white/30 focus:border-red-500 focus:outline-none transition-colors placeholder:text-zinc-700 font-inter text-sm text-white uppercase"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toUpperCase())}
                  maxLength={15}
                />
              </motion.div>
            )}
          </AnimatePresence>

          <div className="space-y-2">
            <label className="text-xs font-dot text-white tracking-widest uppercase">ID // Email</label>
            <input
              type="email"
              placeholder="you@srmist.edu.in"
              className="w-full px-4 py-3 bg-black border border-white/30 focus:border-red-500 focus:outline-none transition-colors placeholder:text-zinc-700 font-inter text-sm"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-dot text-white tracking-widest uppercase">KEY // Passkey</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                className="w-full px-4 py-3 bg-black border border-white/30 focus:border-red-500 focus:outline-none transition-colors placeholder:text-zinc-700 font-inter text-sm"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white transition-colors"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {!isRegistering && (
            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={handleForgotPassword}
                className="text-[10px] font-dot text-zinc-500 hover:text-red-400 uppercase tracking-widest transition-colors border-b border-transparent hover:border-red-400 pb-0.5"
              >
                [ FORGOT KEY? RECOVER ACCESS ]
              </button>
            </div>
          )}

          <button
            type="submit"
            className={`w-full py-4 mt-4 font-dot uppercase tracking-widest border transition-all flex justify-center items-center gap-2 ${isRegistering
              ? 'bg-red-500 text-white border-red-500 hover:bg-red-600 shadow-[0_0_15px_rgba(239,68,68,0.3)]'
              : 'bg-white text-black border-white hover:bg-red-500 hover:text-white hover:border-red-500'
              }`}
          >
            {isRegistering ? 'REQUEST_ACCESS' : 'INITIALIZE_LINK'} <ArrowRight size={16} />
          </button>
        </form>

        <div className="mt-6 flex justify-center relative z-50">
          <button
            type="button"
            onClick={() => setIsRegistering(!isRegistering)}
            className="text-[10px] font-dot text-zinc-500 hover:text-white uppercase tracking-widest transition-colors border-b border-transparent hover:border-white pb-1"
          >
            {isRegistering ? '[ ABORT // RETRIEVE EXISTING ID ]' : '[ NO CLEARANCE? REGISTER NEW ID ]'}
          </button>
        </div>

        {/* TACTICAL BYPASS: Google Auth Disabled for Mobile WebViews. Enforcing Email/Passkey only. */}
        {/*
        <div className="flex items-center gap-4 my-8 relative z-50">
          <div className="h-[1px] bg-white/20 flex-1"></div>
          <span className="text-[10px] font-dot text-zinc-500 uppercase">OR EXT_AUTH</span>
          <div className="h-[1px] bg-white/20 flex-1"></div>
        </div>

        <button
          onClick={() => executeAuthDirective('google')}
          className="w-full py-4 border border-white/30 hover:border-white transition-all font-dot uppercase text-xs flex items-center justify-center gap-3 bg-black text-white relative z-50"
        >
          <div className="w-4 h-4 border border-white flex items-center justify-center">
            <span className="text-[10px] leading-none">G</span>
          </div>
          CONTINUE VIA GOOGLE
        </button>
        */}
      </motion.div>

      {/* Auth Overlay Modal */}
      <AnimatePresence>
        {loginMethod && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[100] bg-black/90 backdrop-blur-md border-[8px] border-white flex flex-col items-center justify-center p-6 pointer-events-auto"
          >
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
              className="w-24 h-24 border-2 border-white/20 border-t-red-500 rounded-full mb-8 relative"
            >
              <div className="absolute inset-2 border border-white/10 rounded-full" />
            </motion.div>
            <h2 className="text-3xl font-dot uppercase tracking-widest text-white mb-2 blink">LINKING...</h2>
            <p className="text-red-500 font-dot text-sm uppercase">ESTABLISHING SECURE CONNECTION</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const App = () => {
  const [isSatellite, setIsSatellite] = useState(false);
  const [latency, setLatency] = useState(0);
  const [username, setUsername] = useState('');
  // --- MOBILE VIEW STATE ---
  // Controls which panel is active on mobile bottom HUD: 'grid' | 'matrix' | 'squad' | 'cmd'
  const [mobileView, setMobileView] = useState('grid');
  // Phone layout and the squad/matrix sheet (see the Sidebar Panel below).
  const isMobile = useIsMobile();
  const reduceMotion = useReducedMotion();
  const sheetOpen = mobileView === 'matrix' || mobileView === 'squad';
  const sheetDragControls = useDragControls();
  const sheetRef = useRef(null);
  const sheetDraggedRef = useRef(false);
  // --- TACTICAL WAYPOINT STATE ---
  const [isDroppingWaypoint, setIsDroppingWaypoint] = useState(false);
  const [activeWaypoint, setActiveWaypoint] = useState(null);
  // Squad-wide SOS beacons this client hasn't acknowledged yet: a queue, one overlay
  // on screen at a time (see useIncomingSos). Live beacons arrive as 'sos-received';
  // ones missed while offline/reconnecting are replayed after requestSosSync().
  const {
    current: incomingSos,
    pendingCount: pendingSosCount,
    acknowledge: acknowledgeSos,
    requestSync: requestSosSync,
  } = useIncomingSos(socket);
  // --- IN-APP UPDATER (full-APK self-update; see src/hooks/useAppUpdate.js) ---
  // Checks GitHub Releases once per cold start. Held here rather than in a leaf
  // component because the mandatory-update gate has to be able to pre-empt every
  // render branch below, including the auth screen, and because the Back-button
  // guard is a single app-wide listener.
  const appUpdate = useAppUpdate();
  // JS-only live updates (Phase 2). Independent of appUpdate above: this swaps the web
  // bundle inside the installed shell, never the APK. Its MIN_NATIVE gate is what keeps
  // a bundle off a shell too old to run it — see src/utils/liveUpdateManifest.js.
  const liveUpdate = useLiveUpdate();
  // While an SOS is up — or a mandatory update is gating the app — Android's Back
  // button/gesture does nothing (ACKNOWLEDGE / UPDATE NOW is the only way out);
  // otherwise it behaves normally. See useBackButtonGuard.
  useBackButtonGuard(Boolean(incomingSos) || appUpdate.mandatory);
  const [arTarget, setArTarget] = useState(null);
  // --- TARGETING MODE (Two-step Rally Point) ---
  const [isTargetingMode, setIsTargetingMode] = useState(false);
  // --- SYS_CONFIG STATE ---
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showAdminSettings, setShowAdminSettings] = useState(false);
  const [hasSeenGuide, setHasSeenGuide] = useState(false);
  const [sysConfig, setSysConfig] = useState({
    audio: true,
    theme: 'tactical', // 'tactical' | 'stealth'
    polling: 'standard' // 'eco' | 'standard' | 'max'
  });

  const toggleConfig = (key, value) => {
    setSysConfig(prev => ({ ...prev, [key]: value }));
  };
  // --- COMMANDER TELEMETRY STATE ---
  const [showTelemetryModal, setShowTelemetryModal] = useState(false);
  const [rawTelemetryData, setRawTelemetryData] = useState(null);
  // SYNC_TELEMETRY's own state: 'idle' | 'pending' | 'error', with the reason on error. The
  // button used to be a bare emit, so when no answer came it simply did nothing.
  const [telemetrySync, setTelemetrySync] = useState({ status: 'idle', message: null });
  // The sync attempt still waiting to be settled (by its telemetry, its acknowledgement or
  // its timeout, whichever comes first), or null.
  const pendingSyncRef = useRef(null);

  // Calculates exactly how stale a node's GPS signal is
  const getSignalFreshness = (isoString) => {
    if (!isoString) return { text: "NO_SIGNAL", color: "text-red-500" };
    const seconds = Math.floor((new Date() - new Date(isoString)) / 1000);
    if (seconds < 10) return { text: "OPTIMAL (< 10s)", color: "text-emerald-500" };
    if (seconds < 60) return { text: `GOOD (${seconds}s ago)`, color: "text-blue-400" };
    if (seconds < 300) return { text: `WARN (${Math.floor(seconds / 60)}m ago)`, color: "text-yellow-500" };
    return { text: `STALE (> 5m)`, color: "text-red-500 animate-pulse" };
  };
  // --- PRECOGNITION TRACKERS ---
  const localPrecognition = useRef(new PrecognitionFilter());
  const squadPrecognition = useRef({}); // Tracks separate Kalman math for every squad member
  const memberSeenRef = useRef({}); // id -> { server: lastSeen, local: when this phone saw it change }

  const [zoneAlerts, setZoneAlerts] = useState([]); // <-- Tracks active perimeter breaches
  const [offlineNodes, setOfflineNodes] = useState({}); // <-- NEW: Tracks dead signals
  const [signalLostAlerts, setSignalLostAlerts] = useState([]); // one-time auto-dismissing banners
  const ghostFadeTimersRef = useRef({}); // targetId -> timeout, guards against double-scheduling a fade-out
  // Own stable identity, readable from socket callbacks that only subscribe once. Socket
  // ids change on every reconnect; this doesn't, so it's what "is this me?" is answered with.
  const myUidRef = useRef(null);

  // Shared 1Hz clock so every ghost's elapsed-time tag / projection decay
  // recomputes together instead of each running its own interval.
  const [ghostClockTick, setGhostClockTick] = useState(() => Date.now());
  const hasGhosts = Object.keys(offlineNodes).length > 0;
  useEffect(() => {
    if (!hasGhosts) return;
    const id = setInterval(() => setGhostClockTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasGhosts]);

  const ghostMembers = useMemo(
    () => deriveGhostMembers(offlineNodes, ghostClockTick),
    [offlineNodes, ghostClockTick]
  );

  const [buildingIntel, setBuildingIntel] = useState('');

  // --- ADDED: ROUTING STATE ---
  const [routeStart, setRouteStart] = useState(null);
  const [routeEnd, setRouteEnd] = useState(null);
  const [routeData, setRouteData] = useState(null);

  // --- MODIFIED: FIREBASE AUTH STATE ---
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  // --- ADMIN PATH RECORDER STATE ---
  const ADMIN_EMAIL = "vithyakrish1402@gmail.com"; // 🚨 REPLACE WITH YOUR EXACT GOOGLE LOGIN EMAIL
  const isAdmin = user?.email === ADMIN_EMAIL;

  // --- GREEN LIGHT PROTOCOL: Map readiness gate ---
  const [isMapReady, setIsMapReady] = useState(false);
  // --- MAP ENGINE FALLBACK: switch to the Leaflet map if Google's never loads ---
  // Seeded true when no Maps API key is configured. Loading the Google Maps JS API
  // without a key doesn't fail outright — it silently renders a degraded map plastered
  // with "For development purposes only", and still fires onGoogleApiLoaded, so the
  // 8s watchdog below never trips and the watermarked map just stays on screen.
  // The Leaflet engine uses CARTO + Esri tiles, which need no key and carry no
  // watermark, so with no key it is strictly the better engine — use it immediately
  // rather than rendering a broken-looking Google map.
  const [mapEngineFailed, setMapEngineFailed] = useState(!GOOGLE_MAPS_API_KEY);

  const [isRecordingPath, setIsRecordingPath] = useState(false);
  const [recordedCoords, setRecordedCoords] = useState([]);
  const [liveSecretRoutes, setLiveSecretRoutes] = useState({
    "Tech Park_Java Green": {
      distance: "450 M", eta: "4 MINS",
      path: [{ lat: 12.825020, lng: 80.045323 }, { lat: 12.824500, lng: 80.044900 }, { lat: 12.823900, lng: 80.044600 }, { lat: 12.823348, lng: 80.044489 }]
    }
  });
  const recordingPolylineRef = useRef(null);

  const [loginMethod, setLoginMethod] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [activeTab, setActiveTab] = useState('buildings');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState(null);

  const [users, setUsers] = useState([]);
  const [liveLocation, setLiveLocation] = useState(null);
  // Raw m/s from geolocation's coords.speed, tracked separately from the km/h value
  // broadcast over the wire — drives this device's own LiveLocationMarker isNavigating state.
  const [liveSpeed, setLiveSpeed] = useState(0);
  const [telemetryMode, setTelemetryMode] = useState('ACTIVE');
  // Set on any geolocation error, cleared the moment a real fix comes through, so a
  // friend testing this actually finds out they're invisible to the squad instead of just
  // seeing no marker with no explanation. 'denied' when permission was refused, 'no-fix'
  // for anything else (a timeout indoors, no position available): the banner used to say
  // ACCESS DENIED for both, which sent people hunting for a permission that was granted.
  const [locationError, setLocationError] = useState(null);
  const onGeolocationError = (err) => setLocationError(err?.code === 1 ? 'denied' : 'no-fix');

  const [squadCode, setSquadCode] = useState('');
  const [squadMode, setSquadMode] = useState('create'); // 'create' or 'join'
  const [hasJoinedSquad, setHasJoinedSquad] = useState(false);
  // Why the lobby is showing again, when the server turned a request down (no live squad
  // under the code, the code already taken, the squad gone). Cleared by the next action.
  const [lobbyNotice, setLobbyNotice] = useState(null);

  // --- MAP ENGINE FALLBACK WATCHDOG ---
  // Armed only once the map screen is actually about to render (past auth +
  // squad-join) — arming it at app boot meant the 8s clock usually expired
  // during login/registration, before <GoogleMapReact> ever got a chance to
  // mount, so it fell back to Leaflet on every real session regardless of
  // whether Google Maps would've loaded fine.
  useEffect(() => {
    // mapEngineFailed short-circuits the no-API-key case: Leaflet is already the
    // active engine, so there is no Google map left to wait on.
    if (!user || !hasJoinedSquad || isMapReady || mapEngineFailed) return;
    const timeoutId = setTimeout(() => {
      if (!isMapReady) {
        console.warn('[SYS_MAP] Google Maps did not initialize in time — falling back to Leaflet.');
        setMapEngineFailed(true);
      }
    }, 8000);
    return () => clearTimeout(timeoutId);
  }, [user, hasJoinedSquad, isMapReady, mapEngineFailed]);

  // Keep a code ready on the CREATE screen: on first load, on switching to CREATE, and on
  // coming back to the lobby after leaving (which clears the code). This used to be keyed
  // on squadMode alone, so leaving a squad you had created, which clears the code but
  // doesn't change the mode, left the screen on "GENERATING..." with INITIALIZE doing
  // nothing. Re-running when the code changes is harmless: it only fills an empty one.
  useEffect(() => {
    if (squadMode === 'create' && !squadCode) {
      setSquadCode(generateRandomSquadCode());
    }
  }, [squadMode, squadCode]);
  // --- SQUAD GATEKEEPER STATES ---
  const [accessStatus, setAccessStatus] = useState(null);
  const [squadRole, setSquadRole] = useState(null);
  const [pendingRequests, setPendingRequests] = useState([]);
  const liveLocationRef = useRef(null);
  // Shared with ARCompass.jsx (src/hooks/useDeviceHeading.js) so both the AR
  // targeting view and this device's own map marker read the same compass value.
  // `heading` is throttled for rendering; `headingRef` always holds the newest raw
  // bearing. The GPS-tracking effect below intentionally does NOT list `heading` as
  // a dependency (that would tear down and re-register the geolocation watch on
  // every compass tick), so it reads the ref instead and still emits a current value.
  const { heading, headingRef, hasReading: hasHeadingReading, requestHeadingPermission } = useDeviceHeading();
  // Mirrors telemetryMode in a ref so setInterval and watchPosition callbacks
  // always read the current value — they close over the ref, not the stale state.
  const telemetryModeRef = useRef('ACTIVE');
  // WiFi Arc Stage 6: every update-location payload takes its lat/lng/positionSource from
  // positionFor(gps). Off by default (src/utils/positionSource.js), and then it is always
  // the GPS fix with positionSource 'gps'. The Kalman filter and safety-ping stay on GPS.
  // Stable identity, so listing it in the telemetry effect's dependencies below never
  // re-runs that effect.
  //
  // Stage 7: `indoor` is the valid indoor reading behind it (null with the flag off). While
  // there is one, your own dot is drawn at the WiFi position - the one your squad is being
  // sent - with a confidence halo, and the floor picker appears. indoorView is the picker's
  // purely local state: nothing in it reaches positionFor.
  const wifiActive = Boolean(user && hasJoinedSquad && accessStatus === 'granted');
  const { positionFor, indoor, lastCycle } = useWifiFusion(wifiActive);
  const indoorView = useIndoorView(WIFI_POSITIONING_ENABLED ? indoor : null);
  // Where your own dot goes. With an indoor reading it is shown only on your real floor's
  // tab: browsing another floor, you aren't on it.
  const selfIndoor = WIFI_POSITIONING_ENABLED && indoor ? indoor : null;
  const selfMarkerAt = selfIndoor ? { lat: selfIndoor.lat, lng: selfIndoor.lng } : liveLocation;
  const showSelfMarker = Boolean(selfMarkerAt) && !(selfIndoor && indoorView?.browsing);

  // Start listening for compass heading as soon as we're signed in — on Android
  // this needs no user gesture. On iOS 13+ this call is a silent no-op (that
  // platform requires the permission request to originate from a click handler,
  // which ARCompass's own "GRANT_ACCESS" button still provides separately).
  useEffect(() => {
    if (user) requestHeadingPermission();
  }, [user, requestHeadingPermission]);

  // Own stable identity, mirrored into a ref so the socket listeners below — which
  // subscribe once and close over their scope — always compare against the current value.
  useEffect(() => {
    myUidRef.current = user?.uid || null;
  }, [user]);

  const handleJoinSquad = (e) => {
    // Prevent the page from refreshing if this is inside a form
    if (e && e.preventDefault) e.preventDefault();

    // Don't do anything if the input is empty
    if (!squadCode || !squadCode.trim()) return;

    const targetRoom = squadCode.trim().toUpperCase();

    // 1. Send the knock to the server FIRST
    socket.emit('request-join', {
      roomCode: targetRoom,
      user: { name: user.displayName, photo: user.photoURL, uid: user.uid },
      // Which of the two this is. The server used to have to guess, and guessed "create if
      // missing, join if present" for both: a JOIN for a code whose squad wasn't live yet
      // (its creator hadn't tapped INITIALIZE) made the joiner its Commander, and a CREATE
      // under a live code queued the creator for a stranger's approval.
      intent: squadMode === 'create' ? 'create' : 'join',
    });

    setLobbyNotice(null);
    setHasJoinedSquad(true);

    if (squadMode === 'create') {
      // 🚀 INSTANT CLEARANCE FOR SQUAD CREATORS (0ms delay) — you can't need your
      // own approval to enter a squad you're creating.
      setAccessStatus('granted');
      setSquadRole('OWNER');
    } else {
      // Explicitly (re)set to 'pending' rather than leaving whatever accessStatus
      // already held. Without this, a user who was ever 'granted' before — e.g.
      // the owner of their own squad a moment ago — kept that stale value straight
      // through handleLeaveSquad (which didn't reset it either, fixed below), so
      // the very next join, to a squad they'd never actually been let into, showed
      // the full map immediately: the waiting-room gate below checks
      // `accessStatus !== 'granted'`, which was already false before the server
      // had said anything at all.
      setAccessStatus('pending');
      // No client-side auto-grant timeout here anymore. There used to be one
      // ("fallback if network or server response is delayed") that flipped
      // accessStatus to 'granted' after 4s no matter what — which is exactly the
      // bug this comment is describing, just on a delay instead of instant: it
      // let a joiner in whether or not the Commander had actually approved them,
      // as long as they'd waited long enough. Approval-gating is a real feature
      // here, not cosmetic, so a slow Commander should mean a slow join, not a
      // silent bypass.
    }
  };

  // SYNC_TELEMETRY / FORCE_SYNC. Always ends visibly: the matrix opens, or the button says
  // what went wrong and offers a retry. It used to be a bare emit: no timeout, and the
  // server said nothing when it wouldn't answer, so a tap could simply do nothing.
  //  - Offline, it says so at once rather than queueing the request: socket.io would
  //    replay it on the new connection ahead of the rejoin, where it is refused anyway.
  //  - The server acknowledges with { ok } or { ok: false, reason }; a server that
  //    predates that sends only the telemetry, which settles the attempt by itself.
  const requestTelemetrySync = useCallback(() => {
    if (!socket.connected) {
      pendingSyncRef.current = null;
      setTelemetrySync({ status: 'error', message: 'NOT CONNECTED TO THE SERVER. RECONNECTING — TRY AGAIN IN A MOMENT.' });
      return;
    }
    const attempt = {};
    pendingSyncRef.current = attempt;
    setTelemetrySync({ status: 'pending', message: null });
    socket.timeout(TELEMETRY_SYNC_TIMEOUT_MS).emit('request-telemetry', squadCode, (err, reply) => {
      if (pendingSyncRef.current !== attempt) return; // already settled by the telemetry itself
      pendingSyncRef.current = null;
      if (err) {
        setTelemetrySync({ status: 'error', message: 'NO RESPONSE FROM THE SERVER. CHECK YOUR CONNECTION AND TRY AGAIN.' });
      } else if (reply?.ok) {
        setTelemetrySync({ status: 'idle', message: null });
      } else {
        setTelemetrySync({ status: 'error', message: TELEMETRY_SYNC_REFUSALS[reply?.reason] || 'THE SERVER REFUSED THE SYNC.' });
      }
    });
  }, [squadCode]);

  // The matrix's footer has always said it refreshes every 5 seconds; nothing did.
  useEffect(() => {
    if (!showTelemetryModal) return;
    const id = setInterval(() => {
      if (!pendingSyncRef.current) requestTelemetrySync();
    }, 5000);
    return () => clearInterval(id);
  }, [showTelemetryModal, requestTelemetrySync]);

  // Out of the squad: the matrix, and any sync still in flight, belong to the squad left.
  // (The matrix used to stay open and reappear, with the old squad's data, in the next.)
  useEffect(() => {
    if (hasJoinedSquad) return;
    pendingSyncRef.current = null;
    setTelemetrySync({ status: 'idle', message: null });
    setShowTelemetryModal(false);
  }, [hasJoinedSquad]);

  // --- 📡 NETWORK LATENCY TRACKER ---
  useEffect(() => {
    if (!hasJoinedSquad) return;

    // Send a ping every 2 seconds
    const pingInterval = setInterval(() => {
      socket.emit('check-ping', Date.now());
    }, 2000);

    // Listen for the bounce and calculate the round trip time
    socket.on('pong-bounce', (serverTimestamp) => {
      const rtt = Date.now() - serverTimestamp;
      setLatency(rtt);
    });

    return () => {
      clearInterval(pingInterval);
      socket.off('pong-bounce');
    };
  }, [hasJoinedSquad]);
  // --- 🌐 GEOFENCE PERIMETER LISTENER ---
  useEffect(() => {
    socket.on('geofence-alert', (alertData) => {
      const newAlert = {
        id: Date.now(),
        ...alertData
      };

      // Add the alert to the HUD
      setZoneAlerts(prev => [...prev, newAlert]);

      // Optional: Play a subtle notification sound here if you have one

      // Auto-remove the alert from the screen after 6 seconds
      setTimeout(() => {
        setZoneAlerts(prev => prev.filter(a => a.id !== newAlert.id));
      }, 6000);
    });

    return () => socket.off('geofence-alert');
  }, []);
  // --- 🚨 UPDATED: THE DEAD MAN'S SWITCH INTERCEPTOR ---
  useEffect(() => {
    socket.on('member-signal-lost', (emergencyData) => {
      const { targetId, uid, name, photo, lastKnownLocation, timeDelta } = emergencyData;

      if (typeof playSonarPing === 'function') {
        playSonarPing();
      }

      // Match on uid as well as socket id. The socket that died may already have been
      // superseded by the same person's newer one, in which case filtering by targetId
      // alone removes nobody and leaves the roster carrying a node the server has dropped.
      setUsers(prev => prev.filter(u => u.id !== targetId && !(uid && u.uid === uid)));

      // Store the raw last-known fix, undisturbed — GhostMemberMarker/
      // deriveGhostMembers re-projects from this every clock tick (up to the
      // decay cap) rather than baking in a single one-shot guess here.
      setOfflineNodes(prev => ({
        ...prev,
        [targetId]: {
          id: targetId,
          // Who this ghost actually is, independent of the socket that just died — this is
          // what lets it be retired when they come back on a different socket id.
          uid: uid || null,
          name,
          photo,
          lat: lastKnownLocation.latitude,
          lng: lastKnownLocation.longitude,
          heading: lastKnownLocation.heading || 0,
          speedKmh: lastKnownLocation.speed || 0,
          battery: lastKnownLocation.batteryLevel,
          timeDelta: timeDelta || 0,
          receivedAt: Date.now(),
        }
      }));

      // One-time auto-dismissing banner — replaces the old blocking alert(),
      // which froze the whole UI thread until someone clicked OK.
      const alertId = `signal-lost-${targetId}-${Date.now()}`;
      setSignalLostAlerts(prev => [...prev, { id: alertId, name }]);
      setTimeout(() => {
        setSignalLostAlerts(prev => prev.filter(a => a.id !== alertId));
      }, 6000);
    });

    return () => {
      socket.off('member-signal-lost');
    };
  }, []);
  // --- 📊 ADDITION 3: TELEMETRY DATA RECEIVER ---
  // --- TACTICAL TELEMETRY DATA RECEIVER ---
  useEffect(() => {
    socket.on('telemetry-sync-complete', (data) => {
      console.log("📊 [SYS_SYNC] Raw Telemetry Matrix Acquired:", data);
      // The telemetry settles the sync on its own: a server that predates acknowledgements
      // sends only this, and the timeout that follows must not then report a failure.
      pendingSyncRef.current = null;
      setTelemetrySync({ status: 'idle', message: null });
      setRawTelemetryData(data);
      setShowTelemetryModal(true); // Pop the Commander's Dashboard
    });
    return () => socket.off('telemetry-sync-complete');
  }, []);
  // --- 💀 ADDITION: MUTINY LISTENER ---
  useEffect(() => {
    socket.on('exiled', ({ reason } = {}) => {
      // 1. Tell them why (a comms-feed notice; this used to be a blocking alert())
      if (reason === 'blocked') notify.error('The Squad Commander has blocked you from this channel.', { title: 'SYS_BANNED' });
      else notify.error('You have been exiled from the squad by majority vote.', { title: 'SYS_MUTINY' });

      // 2. Trigger your existing leave function to wipe local state and return to the join screen
      handleLeaveSquad();
    });

    // Optional: Listen for active mutiny votes against people to show a warning
    socket.on('mutiny-status', ({ targetId, votes, required }) => {
      console.log(`[MUTINY DETECTED] Node ${targetId} has ${votes}/${required} votes for exile.`);
    });

    return () => {
      socket.off('exiled');
      socket.off('mutiny-status');
    };
    // Mount-once listener registration; handleLeaveSquad is read at call time
    // via closure, not meant to retrigger this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // --- FIREBASE AUTH LISTENER ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
      if (currentUser) {
        setLoginMethod(null);
      }
    });
    return () => unsubscribe();
  }, []);


  // --- 🔔 SYS_NOTIFY: REQUEST OS PERMISSIONS ---
  useEffect(() => {
    if (user && 'Notification' in window) {
      if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
        Notification.requestPermission().then(permission => {
          if (permission === 'granted') {
            console.log("✅ [SYS_NOTIFY] OS Notification link established.");
          }
        });
      }
    }
  }, [user]);

  // Helper function to fire OS-level alerts
  const triggerSystemNotification = (title, body) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      // Fires a native notification to the phone/desktop OS
      new Notification(title, {
        body: body,
        icon: '/vite.svg', // You can replace this with your own LOCUS logo later
        vibrate: [200, 100, 200, 100, 200], // SOS vibration pattern for Android
        tag: 'locus-alert',
        requireInteraction: true // Forces the user to click it to dismiss
      });
    }
  };
  // 1. Listen for real-time network updates from the server
  useEffect(() => {
    if (!hasJoinedSquad) return;

    socket.on('new-waypoint', (waypointData) => {
      console.log(`[SYS_NET] New Rally Point acquired:`, waypointData);
      setActiveWaypoint(waypointData);
      triggerSystemNotification("🎯 RALLY POINT DESIGNATED", "New tactical coordinates uploaded to map.");
    });

    socket.on('remove-waypoint', () => {
      console.log(`[SYS_NET] Rally Point cleared.`);
      setActiveWaypoint(null);
    });

    socket.on('users-update', (activeUsers) => {
      // When each member was last heard from, on THIS phone's clock: the moment their
      // server-side lastSeen changed. Using the server's timestamp directly would carry any
      // clock difference between the two into every "12s AGO" on the roster. Done here,
      // outside the updater below, which has to stay pure.
      const seenNow = Date.now();
      Object.entries(activeUsers ?? {}).forEach(([id, data]) => {
        if (!Number.isFinite(data?.lastSeen)) return;
        const known = memberSeenRef.current[id];
        if (!known || known.server !== data.lastSeen) memberSeenRef.current[id] = { server: data.lastSeen, local: seenNow };
      });

      // Pure: builds the new roster and nothing else. Reconciling ghosts against it used
      // to happen inline here, from inside the setUsers updater — but an updater has to be
      // a pure function of the previous state (React is free to call it more than once),
      // and firing another setState from within it also re-ran the Kalman filter below on
      // the same coordinate. That reconciliation now lives in its own effect, keyed off
      // the roster this produces.
      setUsers(() => {
        const formattedUsers = [];
        Object.entries(activeUsers).forEach(([id, data]) => {
          // Skip self, wrong room, and GHOST nodes (server still sends them so others
          // can see their last position, but we hide them from our own map/list).
          //
          // Self is matched on socket id *and* on uid: a reconnect mints a new socket id,
          // so for as long as the server still has the old one on file, `id === socket.id`
          // alone left this client looking at a stale copy of itself listed as a squad
          // member. Matching on uid (never on name, which isn't unique and isn't identity)
          // catches that without touching anyone else.
          if (id === socket.id) return;
          if (data.uid && myUidRef.current && data.uid === myUidRef.current) return;
          if (data.roomCode !== squadCode) return;
          if (data.status === 'GHOST') return;

          // A member with no fix yet (indoors, location permission denied, just approved)
          // is still a member: they belong on the roster, just not on the map. Dropping
          // them outright here is what made them vanish from both views at once.
          const hasFix = Boolean(data.lat && data.lng);

          // Run Kalman smoothing on every incoming coordinate
          let smoothed = null;
          if (hasFix) {
            if (!squadPrecognition.current[id]) {
              squadPrecognition.current[id] = new PrecognitionFilter();
            }
            smoothed = squadPrecognition.current[id].filter(data.lat, data.lng);
          }

          formattedUsers.push({
            id,
            uid: data.uid || null,
            name: data.name || 'Squad Node',
            photo: data.photo,
            role: data.role || 'Campus Node',
            hasFix,
            lat: hasFix ? smoothed.lat : null,
            lng: hasFix ? smoothed.lng : null,
            speed: data.speed || 0,
            heading: data.heading || 0,
            battery: data.battery || 0,
            status: data.status || 'ACTIVE',
            lastSeen: memberSeenRef.current[id]?.local ?? null,
            // WiFi Arc Stage 7: the member's building + floor, when their latest update
            // carried them (they are left out, never null, when they didn't). Absent here
            // too in that case, so their floor chip and pill go as soon as they leave
            // coverage, while the GPS-based direction finder carries on untouched.
            ...(SHOW_INDOOR_POSITION_TO_SQUAD && typeof data.building === 'string' && Number.isInteger(data.floor)
              ? { building: data.building, floor: data.floor }
              : {}),
          });
        });
        return formattedUsers;
      });
    });

    // A squadmate pinged this member: "look at me / check in", not an emergency. It used
    // to be worded as an SOS and end in a blocking alert(), which froze the whole app
    // (klaxon, sockets, map) until dismissed. Now a sonar blip plus a short notice in the
    // HUD; the OS notification only when the app isn't in view to show that notice.
    socket.on('receive-ping', ({ senderName } = {}) => {
      const name = (senderName || 'A squad member').toUpperCase();
      playSonarPing();

      if (document.hidden) {
        triggerSystemNotification('📡 PING', `${name} is pinging you.`);
      }

      const notice = { id: `ping-${Date.now()}-${Math.random()}`, type: 'PING', userName: name };
      setZoneAlerts(prev => [...prev, notice]);
      setTimeout(() => {
        setZoneAlerts(prev => prev.filter(a => a.id !== notice.id));
      }, 6000);
    });
    socket.on('new-custom-route', ({ key, data }) => {
      setLiveSecretRoutes(prev => ({ ...prev, [key]: data }));
    });

    // Squad-wide SOS ('sos-received') is NOT handled here — useIncomingSos owns that
    // listener (see the hook call near the top of App). Kept separate from
    // 'receive-ping' above, the single-target member ping: conflating the two
    // made an actual emergency look like a routine ping-check. SosOverlay is the
    // entire UI response, and owns its own klaxon and vibrate() once mounted. A
    // native OS Notification would still be the only way to catch an SOS while the
    // app is backgrounded/screen-off, since in-app audio and vibrate need the app
    // running; that tradeoff is intentional, not an oversight.

    return () => {
      socket.off('users-update');
      socket.off('receive-ping');
      socket.off('new-custom-route');
      socket.off('new-waypoint');
      socket.off('remove-waypoint');
      setUsers([]);
      // The squad's Rally Point goes with it. It used to stay on the map after leaving,
      // and ride along into the next squad, which had no record of it.
      setActiveWaypoint(null);
    };
  }, [hasJoinedSquad, squadCode]);

  // --- GHOST RECONCILIATION (the other half of the dead man's switch) ---
  //
  // A ghost is filed against the socket id that went dark. On mobile the same person is
  // usually back seconds later on a brand-new socket id, so matching the returning node to
  // its ghost by socket id never matched — the ghost stayed for the rest of the session.
  // And since ghosts render after live members in both map engines, that stale grey
  // "SIGNAL LOST" pin sat directly on top of the member's live marker a few metres away:
  // the member was on the map, just buried under a ghost of themselves.
  //
  // Matching on uid — the stable identity the server now sends with both 'users-update'
  // and 'member-signal-lost' — retires the ghost as soon as its owner is live again, on
  // whatever socket they came back on. This is the same fade-out that was previously
  // inlined in the users-update handler, not a second removal path: 'member-signal-lost'
  // still solely owns creating ghosts, this solely owns retiring them.
  useEffect(() => {
    const liveIds = new Set(users.map(u => u.id));
    const liveUids = new Set(users.map(u => u.uid).filter(Boolean));
    // Own ghost too: this client can be ghosted by its own earlier socket, and it will
    // never appear in `users` (self is filtered out of the roster).
    if (myUidRef.current) liveUids.add(myUidRef.current);

    Object.values(offlineNodes).forEach(ghost => {
      const isBack = liveIds.has(ghost.id) || (ghost.uid && liveUids.has(ghost.uid));
      if (!isBack || ghost.fading || ghostFadeTimersRef.current[ghost.id]) return;

      // Fade out rather than snapping away, so a reconnect reads as a recovery instead of
      // a marker blinking out of existence.
      setOfflineNodes(prev => (prev[ghost.id] ? { ...prev, [ghost.id]: { ...prev[ghost.id], fading: true } } : prev));
      ghostFadeTimersRef.current[ghost.id] = setTimeout(() => {
        setOfflineNodes(prev => {
          const next = { ...prev };
          delete next[ghost.id];
          return next;
        });
        delete ghostFadeTimersRef.current[ghost.id];
      }, GHOST_FADE_MS);
    });
  }, [users, offlineNodes]);

  // Retire the per-member Kalman filter of anyone off the roster. Keyed by socket id, so
  // without this every reconnect strands the departed socket's filter for the session.
  useEffect(() => {
    const liveIds = new Set(users.map(u => u.id));
    Object.keys(squadPrecognition.current).forEach(id => {
      if (!liveIds.has(id)) delete squadPrecognition.current[id];
    });
  }, [users]);

  // Everything a squad session leaves on this client, cleared on the way back to the
  // lobby: by leaving, by logging out, or when the server turns the request down.
  // `nextCode` is what the lobby's code box shows next. The Commander's queue goes too: it
  // used to survive leaving, and GRANT on an old request then answered for whatever squad
  // the Commander was in by then.
  const endSquadSession = useCallback((nextCode = '') => {
    setHasJoinedSquad(false);
    setSquadCode(nextCode);
    setUsers([]);
    setOfflineNodes({});
    // Cancel in-flight ghost fade-outs so a stray one can't fire after the squad's gone.
    Object.values(ghostFadeTimersRef.current).forEach(clearTimeout);
    ghostFadeTimersRef.current = {};
    setAccessStatus(null);
    setSquadRole(null);
    setPendingRequests([]);
  }, []);

  // --- GATEKEEPER PROTOCOL LISTENERS ---
  // --- GATEKEEPER PROTOCOL LISTENERS (FIXED & RECONNECT SAFE) ---
  useEffect(() => {
    // The squad this client is in, or asking to join. Replies name the squad they're about,
    // and one about any other squad is stale (a request given up on, a squad left): it used
    // to be acted on anyway, so an approval from an abandoned squad flipped the role in the
    // current one, and a stale denial threw the user out of it. Replies with no roomCode
    // come from a server that predates it, and are taken as they always were.
    const currentRoom = squadCode.trim().toUpperCase();
    const isAboutThisSquad = (payload) =>
      hasJoinedSquad && (!payload?.roomCode || payload.roomCode === currentRoom);

    // Back to the lobby with the reason on screen. The code stays in the box, so a JOIN
    // can be retried as it is; a CREATE whose code was taken gets a fresh one instead.
    const returnToLobby = (notice, nextCode = squadCode) => {
      socket.emit('leave-squad');
      endSquadSession(nextCode);
      setLobbyNotice(notice);
    };

    socket.on('access-granted', (payload) => {
      if (!isAboutThisSquad(payload)) return;
      setAccessStatus('granted');
      setSquadRole(payload?.role);
      // Now (back) in the squad's room: catch up on any SOS fired while this client
      // was offline, reconnecting or awaiting approval. Asked for here, not pushed by
      // the server right after 'access-granted', which could arrive before this
      // client has finished re-rendering and be dropped on the floor.
      requestSosSync();
    });

    socket.on('access-pending', (payload) => {
      if (isAboutThisSquad(payload)) setAccessStatus('pending');
    });

    socket.on('access-denied', (payload) => {
      if (!isAboutThisSquad(payload)) return;
      setAccessStatus('denied');
      setHasJoinedSquad(false);
      notify.error("[SYS_REJECTED] The Squad Commander denied your entry.");
    });

    // A JOIN for a code no live squad has. Answered this way rather than by founding a new
    // squad with the joiner as its Commander. Also sent when the squad is deleted while
    // this client is still waiting to be let in, or after a reconnect finds it gone.
    socket.on('squad-not-found', (payload) => {
      if (!isAboutThisSquad(payload)) return;
      returnToLobby(accessStatus === 'granted'
        ? `SQUAD ${currentRoom} NO LONGER EXISTS ON THE SERVER.`
        : `NO ACTIVE SQUAD WITH CODE ${currentRoom}. CHECK THE CODE, OR ASK YOUR COMMANDER TO INITIALIZE IT FIRST.`);
    });

    // A CREATE under a code a live squad already has. Answered this way rather than by
    // queueing the creator for that stranger squad's approval.
    socket.on('squad-code-taken', (payload) => {
      if (!isAboutThisSquad(payload)) return;
      returnToLobby(
        `CODE ${currentRoom} IS ALREADY IN USE BY ANOTHER SQUAD. A NEW CODE HAS BEEN GENERATED: SHARE THIS ONE INSTEAD.`,
        generateRandomSquadCode()
      );
    });

    // One entry per request: the server re-sends a squad's queue to whoever takes over as
    // its Commander (a reconnect, a promotion), which must not stack duplicates.
    socket.on('access-request', (requestData) => {
      if (!isAboutThisSquad(requestData)) return;
      setPendingRequests(prev => [...prev.filter(p => p.targetId !== requestData.targetId), requestData]);
    });

    // The joiner aborted, asked another squad, or dropped off: nothing left to approve.
    socket.on('access-request-withdrawn', (payload) => {
      setPendingRequests(prev => prev.filter(p => p.targetId !== payload?.targetId));
    });

    socket.on('promoted-to-owner', (payload) => {
      if (isAboutThisSquad(payload)) setSquadRole('OWNER');
    });

    // This client stood in as Commander, and the Commander is back. The server no longer
    // takes Commander decisions from here, so neither may the screen: the join queue goes
    // to the Commander, and the controls with the role (see the effect on squadRole).
    socket.on('demoted-to-member', (payload) => {
      if (!isAboutThisSquad(payload)) return;
      setSquadRole('MEMBER');
      setPendingRequests([]);
      notify.info('[SYS] THE SQUAD COMMANDER IS BACK. YOU ARE A SQUAD MEMBER AGAIN.');
    });

    const onConnect = () => {
      console.log("[SYS_SOCKET] Reconnected to network mainframe.");
      if (hasJoinedSquad && squadCode && user) {
        socket.emit('request-join', {
          roomCode: squadCode,
          user: { name: user.displayName, photo: user.photoURL, uid: user.uid },
          // A Commander resumes their squad, which re-creates it under its code if the
          // server lost it (a restart wipes every squad). Anyone else only ever re-joins —
          // a member, or a joiner still waiting — and must never found a squad of their own.
          intent: accessStatus === 'granted' && squadRole === 'OWNER' ? 'resume' : 'join',
        });
      }
    };

    socket.on('connect', onConnect);

    return () => {
      socket.off('access-granted');
      socket.off('access-pending');
      socket.off('access-denied');
      socket.off('squad-not-found');
      socket.off('squad-code-taken');
      socket.off('access-request');
      socket.off('access-request-withdrawn');
      socket.off('promoted-to-owner');
      socket.off('demoted-to-member');
      socket.off('connect', onConnect);
    };
  }, [hasJoinedSquad, squadCode, user, requestSosSync, accessStatus, squadRole, endSquadSession]);

  /// 2. Broadcast your live GPS data to the network
  // 2. Broadcast your live GPS data to the network
  useEffect(() => {
    if (!user || !hasJoinedSquad || accessStatus !== 'granted') return;

    // --- ⏱️ DYNAMIC POLLING TRANSLATOR ---
    const getPollingMs = () => {
      switch (sysConfig.polling) {
        case 'eco': return 15000;     // 15 seconds
        case 'max': return 1000;      // 1 second
        case 'standard':
        default: return 5000;         // 5 seconds
      }
    };

    const currentPollingRate = getPollingMs();
    console.log(`[SYS_CONFIG] Telemetry polling initialized at ${currentPollingRate}ms`);

    // --- 🚀 FORCE INITIAL GPS LOCK ---
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        const smoothed = localPrecognition.current.filter(latitude, longitude);
        setLiveLocation({ lat: smoothed.lat, lng: smoothed.lng });
        liveLocationRef.current = { lat: smoothed.lat, lng: smoothed.lng };
        setLocationError(null);

        socket.emit('update-location', {
          name: user.displayName, photo: user.photoURL,
          ...positionFor(smoothed),
          speed: 0, battery: 100,
          status: telemetryModeRef.current,
          roomCode: squadCode,
          heading: headingRef.current,
        });
      },
      (err) => {
        console.log('[SYS] Initial GPS lock delayed:', err.message);
        onGeolocationError(err);
      },
      { enableHighAccuracy: true }
    );

    // --- 📡 DYNAMIC HEARTBEAT ---
    const heartbeatInterval = setInterval(async () => {
      const currentLoc = liveLocationRef.current;
      if (!currentLoc) return;

      let currentBattery = 100;
      try {
        if ('getBattery' in navigator) {
          const battery = await navigator.getBattery();
          currentBattery = Math.round(battery.level * 100);
        }
      } catch {
        // getBattery() is unsupported in Firefox/Safari and can reject (permission,
        // insecure context) even in Chrome — fall back to the 100 default silently.
      }

      socket.emit('safety-ping', {
        latitude: currentLoc.lat, longitude: currentLoc.lng,
        timestamp: new Date().toISOString(), batteryLevel: `${currentBattery}%`,
      });

      if (telemetryModeRef.current !== 'GHOST') {
        socket.emit('update-location', {
          name: user.displayName, photo: user.photoURL,
          ...positionFor(currentLoc),
          speed: 0, battery: currentBattery,
          status: telemetryModeRef.current,
          roomCode: squadCode,
          heading: headingRef.current,
        });
      }
    }, currentPollingRate); // <-- WIRED HERE

    // --- 🟢 LIVE GPS TRACKING ---
    const watchId = navigator.geolocation.watchPosition(
      async (position) => {
        const { latitude, longitude, speed } = position.coords;
        const smoothed = localPrecognition.current.filter(latitude, longitude);

        setLiveLocation({ lat: smoothed.lat, lng: smoothed.lng });
        liveLocationRef.current = { lat: smoothed.lat, lng: smoothed.lng };
        setLiveSpeed(speed || 0);
        setLocationError(null);

        let batteryLevel = 100;
        try {
          if ('getBattery' in navigator) {
            const battery = await navigator.getBattery();
            batteryLevel = Math.round(battery.level * 100);
          }
        } catch {
        // getBattery() is unsupported in Firefox/Safari and can reject (permission,
        // insecure context) even in Chrome — fall back to the 100 default silently.
      }

        if (telemetryModeRef.current === 'FROZEN') return;

        // NOTE: watchPosition still fires on physical movement. If you want strict ECO mode
        // to override movement-based updates, you'd need to clear this watch and rely purely on the interval.
        socket.emit('update-location', {
          name: user.displayName, photo: user.photoURL,
          ...positionFor(smoothed),
          speed: speed ? Math.round(speed * 3.6) : 0,
          battery: batteryLevel,
          status: telemetryModeRef.current,
          roomCode: squadCode,
          heading: headingRef.current,
        });
      },
      (error) => {
        console.error('🚨 [SYS_ERROR] Geolocation lost:', error.message);
        onGeolocationError(error);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: currentPollingRate } // <-- AND WIRED HERE
    );

    return () => {
      clearInterval(heartbeatInterval);
      navigator.geolocation.clearWatch(watchId);
    };
    // headingRef is a ref (stable identity, never triggers a re-run) — listed only
    // to satisfy exhaustive-deps now that it comes from useDeviceHeading rather
    // than a local useRef the lint rule can recognise on its own.
  }, [user, hasJoinedSquad, squadCode, accessStatus, sysConfig.polling, headingRef, positionFor]); // <-- CRITICAL: ADDED TO DEPENDENCIES
  // --- ⚡ INSTANT MODE OVERRIDE ---
  // Fires the moment a telemetry button is clicked so the server gets the new
  // status immediately, without waiting for the next watchPosition tick.
  // Intentionally keyed only on telemetryMode — user/hasJoinedSquad/squadCode are
  // read for their current value at fire time, not meant to retrigger this effect
  // (the heartbeat/watchPosition effect above already re-broadcasts on those changes).
  useEffect(() => {
    const currentLoc = liveLocationRef.current;
    if (!currentLoc || !user || !hasJoinedSquad) return;

    socket.emit('update-location', {
      name: user.displayName, photo: user.photoURL,
      ...positionFor(currentLoc),
      speed: 0, battery: 100,
      status: telemetryMode, // use state here — this effect re-runs when it changes
      roomCode: squadCode,
      heading: headingRef.current,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [telemetryMode]);

  // --- CYBERPUNK SONAR AUDIO ENGINE ---
  const playSonarPing = () => {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();

      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.1);

      gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    } catch {
      console.log("Audio not supported.");
    }
  };

  useEffect(() => {
    clearRoute();
  }, [activeTab]);

  const [blockedUserIds, setBlockedUserIds] = useState([]);
  const [showRequestsModal, setShowRequestsModal] = useState(false);
  const [modalTab, setModalTab] = useState('requests');

  // Commander-only screens close when the role goes: a stand-in handing the squad back
  // to its returning Commander could otherwise be left looking at the join queue, or the
  // telemetry matrix, with every action on them refused.
  useEffect(() => {
    if (squadRole === 'OWNER') return;
    setShowRequestsModal(false);
    setShowTelemetryModal(false);
  }, [squadRole]);

  const [mapProps, setMapProps] = useState({ center: SRM_KTR_COORDS, zoom: 17 });
  const mapRef = useRef(null);

  // Tracks the map's actual on-screen zoom (pinch/scroll), separately from
  // mapProps.zoom which is only the value WE last programmatically set (e.g.
  // handleFocus jumping to zoom 19) — LiveLocationMarker's near/far state
  // needs the real thing, not just our own last command.
  const [currentZoom, setCurrentZoom] = useState(mapProps.zoom);

  // --- 🚨 TACTICAL MAP OVERRIDE: FORCE 2D TOP-DOWN ---
  // Moved here so mapProps and mapRef are declared before this runs
  useEffect(() => {
    if (mapRef.current) {
      mapRef.current.setTilt(0);
    }
  }, [isSatellite, mapProps.zoom]);

  // aiLoading is still used by the building-intel "QUERY_DATA" panel below
  // (generateBuildingInsights) — that's static local data, not an API call.
  const [aiLoading, setAiLoading] = useState(false);

  // --- 🔐 THE MASTER AUTH ENGINE ---
  const executeAuthDirective = async (method, isRegistering = false) => {
    setLoginMethod(method);

    try {
      if (method === 'google') {
        // 🌐 OAUTH OVERRIDE
        await signInWithPopup(auth, googleProvider);
      }
      else if (method === 'email') {
        // ✉️ SECURE ENCRYPTED CHANNEL
        if (!email || !password) {
          notify.warning("[SYS_ERROR] ID AND KEY ARE REQUIRED FOR LINK.");
          setLoginMethod(null);
          return;
        }

        if (isRegistering) {
          // 1. Enforce Username Requirement
          if (!username.trim()) {
            notify.warning("[SYS_ERROR] CODENAME REQUIRED FOR NEW RECRUITS.");
            setLoginMethod(null);
            return;
          }

          // 2. Create the Node in the Mainframe
          const userCredential = await createUserWithEmailAndPassword(auth, email, password);

          // 3. Generate a unique Tactical Bot Avatar based on their username
          const generatedAvatar = `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(username)}&backgroundColor=000000`;

          // 4. Attach the data to their Firebase Profile
          await updateProfile(userCredential.user, {
            displayName: username.toUpperCase(),
            photoURL: generatedAvatar
          });

          // 5. Force React to recognize the newly attached data immediately
          setUser({ ...userCredential.user, displayName: username.toUpperCase(), photoURL: generatedAvatar });

        } else {
          // VERIFY EXISTING CREDENTIALS
          await signInWithEmailAndPassword(auth, email, password);
        }
      }
    } catch (error) {
      console.error("Auth Terminal Error:", error.code);

      let errorMessage = `[SYS_FAILURE] ${error.message}`;
      switch (error.code) {
        case 'auth/invalid-credential': errorMessage = "[ACCESS_DENIED] CREDENTIALS REJECTED. CHECK ID AND KEY."; break;
        case 'auth/email-already-in-use': errorMessage = "[SYS_WARN] THIS ID ALREADY EXISTS IN THE MATRIX. INITIATE LOGIN INSTEAD."; break;
        case 'auth/weak-password': errorMessage = "[SEC_VIOLATION] KEY ENCRYPTION TOO WEAK. MINIMUM 6 CHARACTERS REQUIRED."; break;
        case 'auth/invalid-email': errorMessage = "[SYS_ERROR] MALFORMED ID SYNTAX."; break;
      }
      notify.error(errorMessage);
      setLoginMethod(null);
    }
  };

  // --- 🚨 KILL SWITCH LOGOUT HANDLER ---
  const handleLogout = () => {
    socket.emit('leave-squad');
    endSquadSession();
    setLiveLocation(null);
    signOut(auth);
    setLocationError(null);
  };

  // endSquadSession also resets accessStatus: without that, a stale 'granted' (e.g. from
  // owning the squad just left) survives into the next join attempt — see
  // handleJoinSquad's comment.
  const handleLeaveSquad = () => {
    socket.emit('leave-squad');
    endSquadSession();
  };

  const sendPing = (targetId) => {
    socket.emit('ping-user', {
      targetId: targetId,
      senderName: user ? user.displayName : "Ghost_Node"
    });

    playSonarPing();
    console.log(`>> Signal transmitted to Node: ${targetId}`);
  };

  const generateBuildingInsights = async (building) => {
    setAiLoading(true);
    setBuildingIntel(''); // Clear previous building info only

    setTimeout(() => {
      setBuildingIntel(building.tacticalIntel || "[SYS_WARN] No tactical intel available.");
      setAiLoading(false);
    }, 600);
  };

  const toggleBlock = (userId) => {
    setBlockedUserIds(prev => {
      if (prev.includes(userId)) return prev.filter(id => id !== userId);
      // Tell the server too — this actually removes them from the squad and bans
      // their account from rejoining, not just hiding them on this screen.
      if (squadRole === 'OWNER') {
        socket.emit('block-user', { roomCode: squadCode, targetId: userId });
      }
      return [...prev, userId];
    });
  };

  const handleFocus = (coords, item) => {
    setMapProps({ center: coords, zoom: 19 });
    setBuildingIntel(''); // <--- THIS ENSURES OLD DATA VANISHES WHEN YOU CLICK A NEW PIN
    if (item) setSelectedItem(item);
  };

  // --- 🚨 MODIFIED: INTERCEPTS CLICKS FOR ADMIN RECORDER ---
  const handleMapClick = ({ lat, lng }) => {
    // 0. TARGETING MODE RALLY POINT (Mobile two-step)
    if (isTargetingMode) {
      const waypoint = { lat, lng, name: "RALLY POINT" };
      setActiveWaypoint(waypoint);
      if (squadCode) {
        socket.emit('publish-waypoint', { roomCode: squadCode, waypoint });
      }
      setIsTargetingMode(false);
      return;
    }

    // 1. COMMANDER RALLY POINT OVERRIDE (the squad panel's RALLY POINT button). Shown to
    // every Commander, so it isn't gated on isAdmin here: it was, so for any Commander but
    // the admin account the button switched to "SELECT MAP..." and the tap did nothing.
    if (isDroppingWaypoint) {
      const waypoint = { lat, lng, name: "RALLY POINT" };
      setActiveWaypoint(waypoint);
      socket.emit('publish-waypoint', { roomCode: squadCode, waypoint });
      setIsDroppingWaypoint(false);
      return;
    }

    // 1. If Admin is recording a path, save the coordinate and draw it
    if (isAdmin && isRecordingPath) {
      const newCoords = [...recordedCoords, { lat, lng }];
      setRecordedCoords(newCoords);

      if (!recordingPolylineRef.current) {
        recordingPolylineRef.current = new window.google.maps.Polyline({
          path: newCoords, strokeColor: '#eab308', // Yellow for recording
          strokeOpacity: 1.0, strokeWeight: 4, map: mapRef.current
        });
      } else {
        recordingPolylineRef.current.setPath(newCoords);
      }
      return; // Stop normal click behavior
    }
  };

  // --- TACTICAL ROUTING ENGINE ---
  // Finalizing a destination here also designates it as the squad's shared
  // rally point (publish-waypoint) — SELECT_WAYPOINT previously only ever
  // updated this client's own local route HUD, so no marker ever reached
  // anyone else in the squad.
  const publishSquadWaypoint = (destination) => {
    const waypoint = { lat: destination.lat, lng: destination.lng, name: destination.name };
    setActiveWaypoint(waypoint);
    if (squadCode) {
      socket.emit('publish-waypoint', { roomCode: squadCode, waypoint });
    }
  };

  const handleWaypointSelect = (targetCoords) => {
    if (!routeStart) {
      if (liveLocation) {
        setRouteStart({ name: "MY_LOCATION", ...liveLocation });
        setRouteEnd(targetCoords);
        calculateActualRoute({ name: "MY_LOCATION", ...liveLocation }, targetCoords);
        publishSquadWaypoint(targetCoords);
      } else {
        setRouteStart(targetCoords);
      }
      setSelectedItem(null);
    } else if (!routeEnd && targetCoords.id !== routeStart.id) {
      setRouteEnd(targetCoords);
      setSelectedItem(null);
      calculateActualRoute(routeStart, targetCoords);
      publishSquadWaypoint(targetCoords);
    }
  };

  // --- WAYPOINT DISTANCE ENGINE ---
  // Deliberately draws no line/route on the map — the destination building is
  // highlighted on its own marker dot instead. This also means it doesn't
  // depend on Google's Directions API/DirectionsRenderer, so it works
  // identically on the Google engine and the Leaflet fallback.
  const calculateActualRoute = (start, end) => {
    // 1. Prefer a hand-recorded secret shortcut's curated distance/ETA if one exists
    const routeKey = `${start.name}_${end.name}`;
    const reverseRouteKey = `${end.name}_${start.name}`;
    const secretData = liveSecretRoutes[routeKey] || liveSecretRoutes[reverseRouteKey];
    if (secretData && start.name !== "MY_LOCATION") {
      setRouteData({
        distance: { text: secretData.distance },
        duration: { text: secretData.eta }
      });
      return;
    }

    // 2. Straight-line (Haversine) distance + an assumed walking pace
    const R = 6371e3;
    const rad = Math.PI / 180;
    const phi1 = start.lat * rad, phi2 = end.lat * rad;
    const deltaPhi = (end.lat - start.lat) * rad;
    const deltaLambda = (end.lng - start.lng) * rad;
    const a = Math.sin(deltaPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
    const meters = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const WALKING_SPEED_MPS = 1.4; // ~5 km/h
    const minutes = Math.max(1, Math.round(meters / WALKING_SPEED_MPS / 60));

    setRouteData({
      distance: { text: meters > 1000 ? `${(meters / 1000).toFixed(2)} KM` : `${Math.round(meters)} M` },
      duration: { text: `${minutes} MIN${minutes === 1 ? '' : 'S'}` }
    });
  };

  // Also fired automatically on every sidebar tab switch (see the effect
  // below) — must stay a plain local reset, not touch the squad's shared
  // waypoint, or just swiping between MATRIX/SQUAD would clear everyone's
  // rally point.
  const clearRoute = () => {
    setRouteStart(null);
    setRouteEnd(null);
    setRouteData(null);
  };

  // The tracking panel's own close (X) button, specifically — asks the server
  // to clear the squad's shared waypoint too (mirroring the Commander's
  // dedicated CLEAR button exactly: same emit, same server-side owner-only
  // check), rather than optimistically clearing activeWaypoint here and
  // risking this viewer's map disagreeing with everyone else's about whether
  // the rally point still exists.
  const closeWaypointTrackingPanel = () => {
    clearRoute();
    if (activeWaypoint) socket.emit('clear-waypoint', squadCode);
  };


  const blockedUsers = users.filter(u => blockedUserIds.includes(u.id));

  // --- LIVE LOCATION MARKER STATE ---
  // Movement alone (no waypoint needed) already counts as "navigating" —
  // drop the speed clause here if that should require an explicit waypoint instead.
  const isNavigating = Boolean(activeWaypoint) || liveSpeed > NAVIGATING_SPEED_MPS;
  const liveHeading = useLiveHeading({
    lat: liveLocation?.lat,
    lng: liveLocation?.lng,
    speedMps: liveSpeed,
    compassHeading: heading,
  });

  // Native Google Maps polylines for each dark member's projection vector —
  // no-ops when the Leaflet fallback is active (mapRef only holds a Google
  // map instance) or before the map's finished mounting. TacticalLeafletMap
  // renders the Leaflet-engine equivalent itself, declaratively.
  useGhostProjectionLines(!mapEngineFailed && isMapReady ? mapRef.current : null, ghostMembers);

  // Live walking route to the active squad waypoint — real routed path from
  // Google Directions (or OSRM on the Leaflet fallback) when available,
  // throttled so it isn't recomputed on every GPS tick, straight-line "best
  // effort" fallback otherwise. Single source of truth consumed by both the
  // Google engine's imperative Polyline below and TacticalLeafletMap's
  // declarative one, so there's only one throttling clock, not two.
  const walkingRoute = useWalkingRoute({
    engine: mapEngineFailed ? 'leaflet' : 'google',
    liveLocation,
    activeWaypoint,
  });

  // Live navigation line from the operative's own position to the active
  // squad waypoint — same "no-op on Leaflet/before mount" gating as above.
  useWaypointNavigationLine(
    !mapEngineFailed && isMapReady ? mapRef.current : null,
    walkingRoute?.path,
    walkingRoute?.isRealRoute,
    '#EF4444'
  );

  // The ACTIVE_WAYPOINT_TRACKING panel prefers the real route's distance/
  // duration once one exists for this exact destination — a path around
  // buildings is often meaningfully longer than crow-flies, so the ETA is
  // only actually honest once it's real. Falls back to routeData's haversine
  // number otherwise (also what still drives building-to-building personal
  // routing, which never touches activeWaypoint at all).
  // Who may clear the Rally Point, mirroring the server's rule (clear-waypoint in
  // backend/server.js): the Commander, any of them; a member, the one they dropped. It was
  // the Commander alone, while any member can drop one.
  const canClearWaypoint = squadRole === 'OWNER'
    || Boolean(activeWaypoint?.setBy && activeWaypoint.setBy === (user?.uid || socket.id));

  // The route panel opened by choosing a destination is what published that Rally Point,
  // and it tracks it: when the Rally Point is cleared (by anyone), the panel closes with it
  // rather than staying up, still pointing the way to a Rally Point that no longer exists.
  const trackedWaypointRef = useRef(null);
  useEffect(() => {
    const tracked = trackedWaypointRef.current;
    trackedWaypointRef.current = activeWaypoint;
    if (tracked && !activeWaypoint && routeEnd?.lat === tracked.lat && routeEnd?.lng === tracked.lng) {
      setRouteStart(null);
      setRouteEnd(null);
      setRouteData(null);
    }
  }, [activeWaypoint, routeEnd]);

  const isTrackingSquadWaypoint = Boolean(
    routeEnd && activeWaypoint && routeEnd.lat === activeWaypoint.lat && routeEnd.lng === activeWaypoint.lng
  );
  const displayedRouteData = (isTrackingSquadWaypoint && walkingRoute) || routeData;

  // --- TACTICAL MAP RENDERING ENGINE ---
  // Memoised on exactly the inputs that can change the map's configuration.
  // google-map-react shallow-compares this prop, so returning a fresh object (or a
  // freshly-built `styles` array) on every render made it call map.setOptions() —
  // a full restyle — on every render, which is what made the map flicker and feel
  // unresponsive to drags while the compass was ticking.
  const mapOptions = useMemo(() => ({
    ...(isSatellite ? SATELLITE_MAP_OPTIONS : BASE_MAP_OPTIONS),
    ...(isSatellite ? {} : { styles: sysConfig.theme === 'stealth' ? STEALTH_MAP_STYLES : TACTICAL_MAP_STYLES }),
    // Google renders its own clickable POI icons (hospitals, colleges, etc.)
    // straight onto the map tiles. Tapping one pops up Google's native white
    // InfoWindow on top of this app's own custom SYS_NODE panel — two
    // competing overlays stacked with clashing borders. This app already has
    // its own complete building database + marker/panel system, so Google's
    // built-in POI layer is pure UI collision here, not a needed feature.
    clickableIcons: false,
    draggableCursor: (isAdmin && isRecordingPath) ? 'crosshair' : 'grab',
  }), [isSatellite, sysConfig.theme, isAdmin, isRecordingPath]);

  // Incoming SOS (stays up until acknowledged). Built once here because two branches
  // render it: the map below, and the mandatory-update gate. It used to live only in
  // the map branch, so an SOS arriving while the gate was up was queued but never drawn
  // and its klaxon never sounded — even though the z-order (10002 over the gate's
  // 10000) already said a distress beacon outranks a version bump.
  const sosOverlay = incomingSos && (
    <SosOverlay
      // Keyed by beacon so moving to the next queued SOS (or a re-trigger from the
      // same sender) remounts it: fresh klaxon, vibration and focus for each alert.
      key={incomingSos.id}
      senderName={incomingSos.senderName}
      lat={incomingSos.lat}
      lng={incomingSos.lng}
      ageMs={incomingSos.ageMs}
      pendingCount={pendingSosCount}
      onAcknowledge={acknowledgeSos}
    />
  );

  // A [MANDATORY] release pre-empts every branch below — auth, squad join, the map —
  // but not an incoming SOS, which draws over it. Returned before authLoading so a
  // required update still lands on a cold boot that has no network for Firebase, which
  // is exactly when a broken build gets stuck.
  if (appUpdate.mandatory) {
    return (
      <>
        <UpdateModal update={appUpdate} />
        {sosOverlay}
      </>
    );
  }

  // Optional updates: overlays rendered alongside whichever screen is up. Both are `fixed`,
  // so they compose with any branch without restructuring the tree. The JS-only strip is
  // here too: it used to be rendered by the map screen alone, so a phone in the lobby, on
  // sign-in or on the guide never saw a downloaded, verified bundle offered to it - and the
  // lobby is the best moment to restart, with no squad session to interrupt.
  const updateOverlay = (
    <>
      <UpdateModal update={appUpdate} />
      <LiveUpdateToast
        live={liveUpdate}
        aboveTabBar={hasJoinedSquad}
        // On a phone the strip steps aside while a panel occupies its spot: the squad sheet,
        // or a building's card (which now sits at the strip's height, above SOS).
        hidden={hasJoinedSquad && isMobile && (sheetOpen || Boolean(selectedItem && activeTab === 'buildings'))}
      />
      {/* Non-blocking notices (src/utils/notify.js) - what window.alert() used to be. */}
      <CommsFeed />
    </>
  );

  if (authLoading) return (
    <>
      {updateOverlay}
      <BootScreen />
    </>
  );

  if (!user) {
    if (!hasSeenGuide) {
      return (
        <>
          {updateOverlay}
          <LocusGuide
            onInitialize={() => setHasSeenGuide(true)}
            onCheckForUpdates={() => appUpdate.check({ manual: true })}
            updateStatus={appUpdate.status}
            updateSupported={appUpdate.supported}
            installedVersion={appUpdate.installedVersion}
          />
        </>
      );
    }
    return (
      <>
      {updateOverlay}
      <AuthTerminal
        email={email}
        setEmail={setEmail}
        password={password}
        setPassword={setPassword}
        username={username}
        setUsername={setUsername}
        showPassword={showPassword}
        setShowPassword={setShowPassword}
        executeAuthDirective={executeAuthDirective}
        loginMethod={loginMethod}
        latency={latency}
      />
      </>
    );
  }

  if (user && !hasJoinedSquad) {
    return (
      <div className="h-screen w-full bg-black flex flex-col items-center justify-center text-white p-6 bg-dots">
        {updateOverlay}
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md p-8 md:p-10 border border-white/20 bg-black relative shadow-[0_0_50px_rgba(255,0,0,0.1)] text-center pointer-events-auto"
        >
          <div className="absolute top-0 left-0 w-2 h-2 bg-white" />
          <div className="absolute top-0 right-0 w-2 h-2 bg-white" />
          <div className="absolute bottom-0 left-0 w-2 h-2 bg-white" />
          <div className="absolute bottom-0 right-0 w-2 h-2 bg-white" />

          <ShieldCheck size={44} className="text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-dot uppercase tracking-widest mb-1">SECURE_CHANNEL</h2>
          <p className="text-zinc-500 font-dot text-[10px] uppercase mb-6 tracking-widest">
            {squadMode === 'create' ? 'INITIALIZE NEW SQUAD PROTOCOL' : 'JOIN EXISTING OPERATIVE NETWORK'}
          </p>

          {/* Mode Switcher Tabs */}
          <div className="flex border border-white/20 mb-6 font-dot text-xs uppercase tracking-widest">
            <button
              onClick={() => {
                setSquadMode('create');
                setSquadCode(generateRandomSquadCode());
                setLobbyNotice(null);
              }}
              className={`flex-1 py-3 transition-colors ${squadMode === 'create' ? 'bg-white text-black font-bold' : 'text-zinc-500 hover:text-white'}`}
            >
              CREATE SQUAD
            </button>
            <button
              onClick={() => {
                setSquadMode('join');
                setSquadCode('');
                setLobbyNotice(null);
              }}
              className={`flex-1 py-3 transition-colors border-l border-white/20 ${squadMode === 'join' ? 'bg-white text-black font-bold' : 'text-zinc-500 hover:text-white'}`}
            >
              JOIN SQUAD
            </button>
          </div>

          {lobbyNotice && (
            <p role="alert" className="mb-6 p-3 border border-red-500/50 bg-red-500/10 text-left font-dot text-[10px] text-red-400 uppercase tracking-widest leading-relaxed">
              {lobbyNotice}
            </p>
          )}

          {squadMode === 'create' ? (
            <div className="space-y-6">
              <div className="p-4 border border-red-500/40 bg-red-500/5 relative">
                <p className="text-[10px] font-dot text-zinc-400 uppercase tracking-widest mb-2">GENERATED SQUAD DESIGNATOR</p>
                {/* Six tiles that decrypt into place, tap-to-copy and share (SquadCode.jsx).
                    The caption always asked people to share the code; now they can. */}
                <CodeTiles code={squadCode} />
                <div className="mt-3 flex items-center justify-center gap-2">
                  <p className="text-[9px] font-dot text-zinc-500 uppercase tracking-widest">
                    Share this code with your team to grant entry clearance.
                  </p>
                  <button
                    type="button"
                    onClick={() => { setSquadCode(generateRandomSquadCode()); setLobbyNotice(null); }}
                    className="p-1.5 border border-red-500/30 text-red-400 hover:bg-red-500 hover:text-white shrink-0"
                    title="Generate New Code"
                  >
                    <RefreshCw size={12} />
                  </button>
                </div>
              </div>

              <button
                onClick={handleJoinSquad}
                className="w-full py-4 bg-red-500 text-white font-dot uppercase tracking-[0.2em] text-xs hover:bg-red-600 shadow-[0_0_20px_rgba(239,68,68,0.4)] transition-all flex items-center justify-center gap-2"
              >
                INITIALIZE SQUAD <ArrowRight size={16} />
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="space-y-2 text-left">
                <p className="text-[10px] font-dot text-zinc-400 uppercase tracking-widest">ENTER SQUAD CODE (ALPHANUMERIC ONLY)</p>
                {/* Tiles over one real input (SquadCode.jsx): keyboard, paste and autofill as
                    normal, and Enter now connects (it used to do nothing). */}
                <CodeInput
                  value={squadCode}
                  onChange={(code) => { setSquadCode(code); setLobbyNotice(null); }}
                  onSubmit={handleJoinSquad}
                />
              </div>

              <button
                onClick={handleJoinSquad}
                disabled={!squadCode.trim()}
                className="w-full py-4 bg-white text-black font-dot uppercase tracking-[0.2em] text-xs hover:bg-red-500 hover:text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                CONNECT TO SQUAD <ArrowRight size={16} />
              </button>
            </div>
          )}
        </motion.div>
      </div>
    );
  }

  return (
    <div className="h-screen w-full bg-black flex overflow-hidden text-white font-inter selection:bg-red-500/30 bg-dots">

      {/* Blocky Header Panel — PURGED: Only Logo + Logout remain */}
      <motion.nav
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.5 }}
        className="absolute top-0 left-0 z-[1000] w-full px-6 bg-black/95 backdrop-blur-md border-b border-white/20 flex items-center justify-between pointer-events-auto"
        style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' , paddingBottom: '0.75rem' }}
      >
        <div className="flex items-center gap-4">
          <div className="p-2 border border-white text-white">
            <Navigation className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-dot tracking-widest uppercase text-xl">LOCUS</h1>
            <p className="font-dot text-[8px] text-zinc-600 uppercase tracking-[0.3em] -mt-0.5">{isSatellite ? 'ORBITAL RECON' : 'TACTICAL GRID'}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Desktop-only profile badge */}
          <div className="hidden md:flex items-center gap-3 px-4 py-2 border border-white/20 bg-black font-dot text-xs uppercase tracking-widest">
            {user.photoURL ? (
              <img src={user.photoURL} className="w-6 h-6 rounded-full border border-white/50" alt="profile" />
            ) : (
              <div className="w-2 h-2 bg-red-500"></div>
            )}
            {user.displayName || "GUEST_NODE"}
          </div>
          {/* Desktop-only: Admin Settings */}
          {isAdmin && (
            <button
              onClick={() => setShowAdminSettings(true)}
              className="hidden md:flex p-2 border border-yellow-500/60 text-yellow-500 hover:bg-yellow-500 hover:text-black transition-colors shadow-[0_0_10px_rgba(234,179,8,0.2)]"
              title="Admin Settings"
            >
              <ShieldAlert size={18} />
            </button>
          )}
          {/* Desktop-only: SYS_CONFIG */}
          <button
            onClick={() => setShowSettingsModal(true)}
            className="hidden md:flex p-2 border border-white/20 hover:bg-white hover:text-black transition-colors"
            title="System Configuration"
          >
            <Sliders size={18} />
          </button>
          {/* Logout — visible on all screens */}
          <button
            onClick={handleLogout}
            className="p-2 border border-white/20 hover:bg-red-500 hover:text-white hover:border-red-500 transition-colors"
            title="Disconnect"
          >
            <LogOut size={18} />
          </button>
        </div>
      </motion.nav>

      {/* --- ACTIVE ROUTE HUD --- */}
      <AnimatePresence>
        {(routeStart || routeData) && (
          <motion.div
            initial={{ y: -50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -50, opacity: 0 }}
            className="absolute top-24 left-1/2 -translate-x-1/2 z-[850] md:z-[1000] w-[90%] max-w-md bg-black border border-red-500 pointer-events-auto shadow-[0_0_30px_rgba(239,68,68,0.2)]"
          >
            <div className="p-4 flex flex-col gap-2 relative">
              <button onClick={closeWaypointTrackingPanel} className="absolute top-2 right-2 text-zinc-500 hover:text-white">
                <X size={16} />
              </button>

              <div className="flex items-center gap-2 text-red-500 font-dot text-xs uppercase tracking-widest">
                <Waypoints size={14} className="animate-pulse" />
                ACTIVE_WAYPOINT_TRACKING
              </div>

              <div className="flex justify-between items-end mt-2">
                <div className="flex flex-col font-dot text-sm text-white uppercase tracking-widest">
                  <span>{routeStart?.name || "AWAITING_START"}</span>
                  <span className="text-zinc-600">↓</span>
                  <span>{routeEnd?.name || "AWAITING_TARGET"}</span>
                </div>

                {displayedRouteData && (
                  <div className="text-right flex flex-col">
                    <span className="text-2xl font-dot text-red-500 leading-none">{displayedRouteData.distance.text}</span>
                    <span className="text-[10px] font-dot text-zinc-400 uppercase tracking-widest">ETA: {displayedRouteData.duration.text}</span>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sidebar Panel — visible on desktop always; on a phone, a sheet that is open when
          mobileView is 'matrix' or 'squad' and can be dragged down by its handle strip. */}
      <motion.div
        initial={false}
        animate={{ y: isMobile ? (sheetOpen ? 0 : '100%') : 0, x: 0, opacity: 1 }}
        transition={reduceMotion ? { duration: 0 } : SHEET_SPRING}
        drag={isMobile ? 'y' : false}
        dragListener={false}
        dragControls={sheetDragControls}
        dragConstraints={{ top: 0, bottom: 0 }}
        // Follows the finger almost 1:1 downwards, and rubber-bands upwards: the sheet is
        // already fully open, so pulling it higher resists instead of moving.
        dragElastic={{ top: 0.06, bottom: 0.95 }}
        dragMomentum={false}
        onDragStart={() => { sheetDraggedRef.current = true; }}
        onDragEnd={(_event, info) => {
          // Decide from where the throw is GOING, not where the finger let go: project the
          // release velocity forward (Apple's scroll-deceleration projection), so a short
          // quick flick closes the sheet and a slow long drag that stops early doesn't.
          const height = sheetRef.current?.offsetHeight || window.innerHeight;
          if (shouldDismissSheet(info.offset.y, info.velocity.y, height)) {
            haptic('snap');
            setMobileView('grid');
          }
        }}
        ref={sheetRef}
        className={`${
          isMobile
            ? 'fixed inset-x-0 bottom-16 z-[900] flex flex-col bg-black/95 backdrop-blur-lg pointer-events-auto border-t border-white/10 shadow-[0_-24px_48px_rgba(0,0,0,0.6)]'
            : 'hidden md:flex w-80 bg-black border-r border-red-900/50 fixed z-[900] flex-col pointer-events-auto top-20 left-6 bottom-6 h-auto'
        }`}
        // Starts under the header instead of behind it (it used to start at the very top, so
        // its handle and MATRIX/SQUAD indicator were hidden under the header).
        style={isMobile ? { top: 'calc(max(1rem, env(safe-area-inset-top)) + 3.2rem)' } : undefined}
        onTouchStart={(e) => { e.currentTarget._touchStartX = e.touches[0].clientX; }}
        onTouchEnd={(e) => {
          const startX = e.currentTarget._touchStartX;
          const endX = e.changedTouches[0].clientX;
          const diff = startX - endX;
          if (diff > 60) {
            // Swiped LEFT → go to Squad
            setActiveTab('users'); setSelectedItem(null);
            if (isMobile) setMobileView('squad');
          } else if (diff < -60) {
            // Swiped RIGHT → go to Matrix
            setActiveTab('buildings'); setSelectedItem(null);
            if (isMobile) setMobileView('matrix');
          }
        }}
      >
        {/* Mobile drag strip: the handle and the MATRIX/SQUAD indicator. Pressing anywhere
            here starts the drag; a plain tap still closes the sheet, as the handle did. */}
        <div
          className="md:hidden shrink-0 cursor-grab active:cursor-grabbing touch-none select-none"
          data-no-ping
          onPointerDown={(e) => { sheetDraggedRef.current = false; sheetDragControls.start(e); }}
          // A drag that snapped back still ends in a click; only a real tap closes.
          onClick={() => { if (!sheetDraggedRef.current) setMobileView('grid'); }}
        >
        <div className="w-12 h-1.5 bg-white/30 rounded-full mx-auto mt-3 mb-1" />

        {/* Gesture Dot Indicators (mobile) + Desktop Tabs */}
        <div className="md:hidden flex items-center justify-center gap-3 py-3">
          <div className={`w-2 h-2 rounded-full transition-all duration-300 ${activeTab === 'buildings' ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)] scale-125' : 'bg-zinc-700'}`} />
          <span className="font-dot text-[9px] text-zinc-500 uppercase tracking-widest">{activeTab === 'buildings' ? 'MATRIX' : 'SQUAD'}</span>
          <div className={`w-2 h-2 rounded-full transition-all duration-300 ${activeTab === 'users' ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)] scale-125' : 'bg-zinc-700'}`} />
        </div>
        </div>

        {/* Desktop Tabs (hidden on mobile) */}
        <div className="hidden md:flex border-b border-white/20">
          <button
            onClick={() => { setActiveTab('buildings'); setSelectedItem(null); }}
            className={`flex-1 py-4 flex items-center justify-center gap-2 font-dot text-sm uppercase tracking-widest transition-colors ${activeTab === 'buildings' ? 'bg-white text-black' : 'text-zinc-500 hover:text-white hover:bg-white/5'
              }`}
          >
            <Building2 size={16} /> MATRIX
          </button>
          <button
            onClick={() => { setActiveTab('users'); setSelectedItem(null); }}
            className={`flex-1 py-4 flex items-center justify-center gap-2 font-dot text-sm uppercase tracking-widest transition-colors border-l border-white/20 ${activeTab === 'users' ? 'bg-white text-black' : 'text-zinc-500 hover:text-white hover:bg-white/5'
              }`}
          >
            <Users size={16} /> SQUAD
          </button>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-white/20 bg-black">

          {/* --- ONLY THE COMMANDER SEES THESE BUTTONS --- */}
          {activeTab === 'users' && squadRole === 'OWNER' && (
            <div className="flex flex-col gap-2 mb-4">
              <button onClick={() => setShowRequestsModal(true)} className="w-full px-4 py-3 border border-red-500 text-sm font-dot uppercase tracking-widest flex items-center justify-between hover:bg-red-500 hover:text-white transition-colors text-red-500">
                <div className="flex items-center gap-2"><ShieldCheck size={18} /> NODE_ACCESS</div>
                {pendingRequests.length > 0 && <span className="px-2 py-0.5 bg-red-500 text-white text-xs">{pendingRequests.length}</span>}
              </button>

              {/* --- NEW: TELEMETRY SYNC BUTTON --- */}
              {/* Always answers the tap: SYNCING while it waits, then the matrix, or what went
                  wrong and a retry (see requestTelemetrySync). */}
              <button
                onClick={requestTelemetrySync}
                disabled={telemetrySync.status === 'pending'}
                className={`w-full px-4 py-3 border text-sm font-dot uppercase tracking-widest flex items-center justify-center gap-2 transition-colors disabled:cursor-wait disabled:opacity-70 ${telemetrySync.status === 'error'
                  ? 'border-red-500 text-red-500 hover:bg-red-500 hover:text-white'
                  : 'border-yellow-500 text-yellow-500 hover:bg-yellow-500 hover:text-black shadow-[0_0_15px_rgba(234,179,8,0.2)]'}`}
              >
                {telemetrySync.status === 'pending' ? (
                  <><Loader2 size={18} className="animate-spin" /> SYNCING...</>
                ) : telemetrySync.status === 'error' ? (
                  <><RefreshCw size={18} /> RETRY SYNC</>
                ) : (
                  <><Activity size={18} /> SYNC_TELEMETRY</>
                )}
              </button>
              {telemetrySync.status === 'error' && (
                <p role="alert" className="px-3 py-2 border border-red-500/50 bg-red-500/10 font-dot text-[10px] text-red-400 uppercase tracking-widest leading-relaxed">
                  {telemetrySync.message}
                </p>
              )}

              <div className="flex gap-2 w-full">
                <button
                  onClick={() => setIsDroppingWaypoint(!isDroppingWaypoint)}
                  className={`flex-1 px-2 py-3 border text-[10px] font-dot uppercase tracking-widest flex items-center justify-center gap-1 transition-colors ${isDroppingWaypoint ? 'bg-red-500 text-white border-red-500 shadow-[0_0_15px_rgba(239,68,68,0.4)]' : 'border-red-500 text-red-500 hover:bg-red-500 hover:text-white'}`}
                >
                  <Crosshair size={14} /> {isDroppingWaypoint ? 'SELECT MAP...' : 'RALLY POINT'}
                </button>
                {activeWaypoint && (
                  <button
                    onClick={() => socket.emit('clear-waypoint', squadCode)}
                    className="flex-1 px-2 py-3 border border-zinc-500 text-[10px] font-dot uppercase tracking-widest flex items-center justify-center gap-1 hover:bg-zinc-800 transition-colors text-zinc-400"
                  >
                    <Trash2 size={14} /> CLEAR
                  </button>
                )}
              </div>
            </div>
          )}

          {activeTab === 'users' && (
            <div className="mb-4 flex items-center justify-between border border-red-500/30 bg-red-500/5 p-3">
              <div className="flex flex-col">
                {/* --- UPGRADED: DISPLAYS YOUR EXACT ROLE IN THE HUD --- */}
                <span className="text-[10px] text-zinc-500 font-dot uppercase tracking-widest">
                  ACTIVE_CHANNEL // <span className={squadRole === 'OWNER' ? 'text-yellow-500' : 'text-blue-400'}>{squadRole || 'MEMBER'}</span>
                </span>
                <span className="font-dot text-sm text-red-500 tracking-widest">{squadCode}</span>
              </div>
              <button
                onClick={handleLeaveSquad}
                className="text-[10px] border border-red-500 text-red-500 hover:bg-red-500 hover:text-white px-3 py-2 transition-colors font-dot uppercase tracking-widest"
              >
                DISCONNECT
              </button>
            </div>
          )}

          {/* --- NEW: TELEMETRY CONTROL PANEL --- */}
          {activeTab === 'users' && (
            <div className="mb-4 flex flex-col gap-2 border border-white/20 p-2 bg-black">
              <span className="text-[10px] font-dot uppercase tracking-widest text-zinc-500 text-center">TELEMETRY_CONTROL</span>
              <div className="flex gap-2">
                <button
                  onClick={() => { telemetryModeRef.current = 'ACTIVE'; setTelemetryMode('ACTIVE'); }}
                  className={`flex-1 py-2 font-dot text-[10px] tracking-widest border flex flex-col items-center gap-1 transition-colors ${telemetryMode === 'ACTIVE' ? 'bg-emerald-500/20 border-emerald-500 text-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)]' : 'border-white/10 text-zinc-600 hover:border-white/30'}`}
                >
                  <Activity size={14} /> ACTIVE
                </button>
                <button
                  onClick={() => { telemetryModeRef.current = 'FROZEN'; setTelemetryMode('FROZEN'); }}
                  className={`flex-1 py-2 font-dot text-[10px] tracking-widest border flex flex-col items-center gap-1 transition-colors ${telemetryMode === 'FROZEN' ? 'bg-blue-500/20 border-blue-500 text-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.3)]' : 'border-white/10 text-zinc-600 hover:border-white/30'}`}
                >
                  <LocateFixed size={14} /> FROZEN
                </button>
                <button
                  onClick={() => { telemetryModeRef.current = 'GHOST'; setTelemetryMode('GHOST'); }}
                  className={`flex-1 py-2 font-dot text-[10px] tracking-widest border flex flex-col items-center gap-1 transition-colors ${telemetryMode === 'GHOST' ? 'bg-zinc-800 border-zinc-500 text-zinc-300 shadow-[0_0_10px_rgba(113,113,122,0.3)]' : 'border-white/10 text-zinc-600 hover:border-white/30'}`}
                >
                  <EyeOff size={14} /> GHOST
                </button>
              </div>
            </div>
          )}
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-white" size={16} />
            <input
              type="text"
              placeholder={activeTab === 'buildings' ? "SEARCH_MATRIX..." : "SEARCH_SQUAD..."}
              className="w-full bg-transparent border border-white/30 py-3 pl-12 pr-4 text-xs font-dot uppercase focus:outline-none focus:border-white transition-colors placeholder:text-zinc-600"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
        {/* List Content */}
        {/* pb-28 on a phone: room to scroll the last rows clear of the floating SOS and targeting buttons, which used to cover them. */}
        <div className="flex-1 overflow-y-auto p-4 pb-28 md:pb-4 space-y-4 custom-scrollbar bg-black">
          <AnimatePresence mode="popLayout">
            {activeTab === 'buildings' ? (
              SRM_MASTER_DATABASE.filter(b => b.name.toLowerCase().includes(searchQuery.toLowerCase())).map(building => (
                <motion.div
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  key={building.id}
                  className="p-4 mb-2 bg-gray-900 border border-gray-800 rounded-lg active:bg-gray-800 transition-colors relative group hover:border-white/40 cursor-pointer"
                  onClick={() => handleFocus({ lat: building.lat, lng: building.lng }, building)}
                >
                  <div className="absolute top-0 left-0 w-2 h-2 bg-white/20" />
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex flex-col">
                      <span className="inline-block border border-red-500 text-red-500 font-dot text-[10px] uppercase tracking-widest px-2 py-0.5 mb-2 w-max">
                        {building.category}
                      </span>
                      <h4 className="font-dot text-sm uppercase tracking-widest text-white leading-none mb-1">
                        {building.name}
                      </h4>

                      {/* --- 📡 LIVE DISTANCE TRACKER RESTORED --- */}
                      {liveLocation && (
                        <span className="text-[10px] text-emerald-400 font-dot uppercase tracking-widest mt-1 flex items-center gap-1">
                          <Activity size={10} className="animate-pulse" />
                          {calculateDistance(liveLocation.lat, liveLocation.lng, building.lat, building.lng)} AWAY
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] font-dot text-zinc-500 uppercase tracking-widest">[{building.id}]</span>
                  </div>
                  <p className="font-inter text-xs text-zinc-400 mb-4 leading-relaxed">{building.info}</p>
                  <div className="flex gap-2 w-full">
                    <button
                      onClick={(e) => { e.stopPropagation(); setArTarget({ lat: building.lat, lng: building.lng, name: building.name }); }}
                      className="w-12 flex-shrink-0 flex items-center justify-center border border-white/30 hover:border-red-500 hover:text-red-500 transition-colors text-white"
                      title="AR Tracking"
                    >
                      <Crosshair size={14} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleWaypointSelect(building); }}
                      className="w-full py-3 border border-white/30 hover:border-white hover:bg-white hover:text-black font-dot text-xs uppercase tracking-widest transition-colors text-white"
                    >
                      SELECT_WAYPOINT
                    </button>
                  </div>
                </motion.div>
              ))
            ) : (
              // A flat array, not a <> fragment. AnimatePresence mode="popLayout" wraps
              // each direct child in a ref-bearing element to measure it, and a Fragment
              // cannot take a ref — React logged "Invalid prop `ref` supplied to
              // React.Fragment" for every row on every re-render (485 in one session).
              // An array of keyed children is what AnimatePresence wants anyway.
              [
                /* Persistent per-row ghost badge — independent of the transient
                    top-of-screen banner, so anyone opening the Squad panel later
                   still sees who's dark, not just whoever was looking when it fired. */
                ...ghostMembers.map(ghost => (
                  <motion.div
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    key={`ghost-row-${ghost.id}`}
                    onClick={() => handleFocus(ghost.position, null)}
                    className="p-4 mb-2 bg-gray-900 border border-dashed border-zinc-600 rounded-lg active:bg-gray-800 transition-colors relative group hover:border-zinc-400 cursor-pointer opacity-80"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 flex items-center justify-center font-dot text-sm border border-dashed border-zinc-600 text-zinc-400 overflow-hidden shrink-0">
                          {ghost.photo ? <img src={ghost.photo} className="w-full h-full object-cover grayscale" alt="" /> : ghost.name.charAt(0)}
                        </div>
                        <div className="flex flex-col">
                          <h4 className="font-dot text-sm uppercase tracking-widest text-zinc-300 leading-none mb-1">{ghost.name}</h4>
                          <div className="flex items-center gap-2">
                            <span className="text-[9px] font-dot uppercase tracking-widest px-1.5 py-0.5 border border-dashed border-zinc-500 text-zinc-400">
                              {ghost.phase === 'expired' ? 'LAST KNOWN' : 'SIGNAL LOST'}
                            </span>
                            <span className="text-[10px] font-dot text-zinc-500 uppercase tracking-widest">{ghost.elapsedLabel} AGO</span>
                          </div>
                        </div>
                      </div>
                      <WifiOff size={16} className="text-zinc-500 shrink-0" />
                    </div>
                  </motion.div>
                )),
                // Nearest first (by straight-line distance from this phone); members with no
                // fix yet go last. See SquadMemberCard for the dial and freshness line.
                ...sortByDistance(users.filter(u => !blockedUserIds.includes(u.id)), liveLocation).map(user => (
                <motion.div
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  key={user.id}
                >
                  <SquadMemberCard
                    member={user}
                    me={liveLocation}
                    heading={heading}
                    headingLive={hasHeadingReading}
                    isOwner={squadRole === 'OWNER'}
                    onPing={sendPing}
                    onBlock={toggleBlock}
                    onAR={(m) => setArTarget({ lat: m.lat, lng: m.lng, name: m.name })}
                    onTrack={(m) => handleFocus({ lat: m.lat, lng: m.lng }, null)}
                  />
                </motion.div>
                )),
              ]
            )}
          </AnimatePresence>

        </div>
      </motion.div>

      {/* --- 1. WAITING ROOM OVERLAY --- */}
      {hasJoinedSquad && accessStatus !== 'granted' && (
        <div className="absolute inset-0 z-[1000] bg-black/90 backdrop-blur-md flex flex-col items-center justify-center pointer-events-auto p-6">
          <Loader2 className="animate-spin text-red-500 mb-6" size={40} />
          <h2 className="font-dot text-white text-2xl tracking-[0.3em] uppercase mb-2 text-center">
            {accessStatus === 'denied' ? 'ACCESS_DENIED' : 'AWAITING_CLEARANCE'}
          </h2>
          <p className="font-inter text-zinc-500 text-sm text-center max-w-xs px-6 mb-6">
            {accessStatus === 'denied'
              ? 'Handshake rejected by Commander.'
              : 'Transmitting handshake to Squad Commander. Stand by...'}
          </p>

          <button
            onClick={() => {
              // Tell the server too. It used to go on holding the request, and a Commander
              // who tapped GRANT later pulled this user into their squad, wherever they had
              // gone since (see resolve-access in backend/server.js).
              socket.emit('cancel-join', { roomCode: squadCode.trim().toUpperCase() });
              setHasJoinedSquad(false);
              setAccessStatus(null);
            }}
            className="px-6 py-3 border border-red-500/50 text-red-400 hover:bg-red-500 hover:text-white font-dot text-xs uppercase tracking-widest transition-colors flex items-center gap-2"
          >
            <X size={14} /> ABORT HANDSHAKE
          </button>
        </div>
      )}
      {/* --- 🌐 TACTICAL GEOFENCE HUD --- */}
      {/* This HUD, the banners below and the route panel all hang at top-24, which on a
          phone is right where the open SQUAD sheet (z-[900]) keeps the Commander's
          NODE_ACCESS and SYNC_TELEMETRY. They used to sit above it and take the taps meant
          for those buttons (the location banner, whenever GPS had failed, covered the top
          third of SYNC_TELEMETRY at 412 px, and all of it with a second banner up). So on a
          phone they sit under the sheet (z-[850]); on a wider screen the sheet is a side
          column and they stay on top. And they let taps through (pointer-events-none): only
          a banner's own dismiss button takes them. */}
      <div className="absolute top-24 right-6 z-[850] md:z-[1000] flex flex-col gap-2 w-72 pointer-events-none">
        <AnimatePresence>
          {zoneAlerts.map(alert => alert.type === 'PING' ? (
            <motion.div
              key={alert.id}
              role="status"
              initial={{ opacity: 0, x: 50, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 50, scale: 0.9 }}
              className="p-3 border backdrop-blur-md flex flex-col gap-1 shadow-[0_0_15px_rgba(0,0,0,0.5)] bg-zinc-900/80 border-blue-500"
            >
              <div className="flex items-center gap-2">
                <Radio size={14} className="text-blue-400" />
                <span className="text-[10px] font-dot tracking-widest uppercase text-blue-400">PING</span>
              </div>
              <p className="font-dot text-sm text-white uppercase tracking-widest leading-tight">
                <span className="text-blue-400">{alert.userName}</span> is pinging you
              </p>
            </motion.div>
          ) : (
            <motion.div
              key={alert.id}
              initial={{ opacity: 0, x: 50, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 50, scale: 0.9 }}
              className={`p-3 border backdrop-blur-md flex flex-col gap-1 shadow-[0_0_15px_rgba(0,0,0,0.5)] ${alert.type === 'ENTER'
                ? 'bg-emerald-950/80 border-emerald-500'
                : 'bg-zinc-900/80 border-zinc-500'
                }`}
            >
              <div className="flex items-center gap-2">
                <Waypoints size={14} className={alert.type === 'ENTER' ? 'text-emerald-400' : 'text-zinc-400'} />
                <span className={`text-[10px] font-dot tracking-widest uppercase ${alert.type === 'ENTER' ? 'text-emerald-500' : 'text-zinc-500'}`}>
                  PERIMETER {alert.type === 'ENTER' ? 'BREACH' : 'DEPARTURE'}
                </span>
              </div>
              <p className="font-dot text-sm text-white uppercase tracking-widest leading-tight">
                <span className="text-blue-400">{alert.userName}</span> has {alert.type === 'ENTER' ? 'entered' : 'left'} <span className="text-yellow-400">{alert.zoneName}</span>
              </p>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      {/* --- 👻 SIGNAL LOST BANNER (one-time, auto-dismissing) --- */}
      <div className="absolute top-24 left-1/2 -translate-x-1/2 z-[850] md:z-[1000] w-[90%] max-w-md pointer-events-none flex flex-col gap-2">
        <AnimatePresence>
          {/* Targeting mode. It used to be a separate fixed banner at nearly the same height
              as this stack, so it landed on top of the location banner below and hid it. */}
          {isTargetingMode && (
            <motion.div
              key="targeting-mode"
              initial={{ y: -30, opacity: 0, scale: 0.97 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: -30, opacity: 0, scale: 0.97 }}
              transition={reduceMotion ? { duration: 0 } : PANEL_SPRING}
              className="md:hidden bg-yellow-500/10 border border-yellow-500/50 backdrop-blur-xl p-3 flex items-center gap-3 pointer-events-auto"
            >
              <Target size={18} className="text-yellow-500 flex-shrink-0" />
              <div>
                <p className="font-dot text-[10px] text-yellow-500 uppercase tracking-widest leading-tight">TARGETING MODE ACTIVE</p>
                <p className="font-dot text-[9px] text-yellow-500/60 uppercase tracking-widest">TAP ANYWHERE ON MAP TO DEPLOY RALLY POINT</p>
              </div>
              <button onClick={() => setIsTargetingMode(false)} className="ml-auto text-yellow-500 hover:text-white p-1 flex-shrink-0">
                <X size={16} />
              </button>
            </motion.div>
          )}
          {/* Persistent (not auto-dismissing) — the underlying problem doesn't go away
              on its own, so this stays until either a real GPS fix clears it or the
              operative dismisses it themselves. Without this, a friend testing LOCUS
              with location denied just sees no marker anywhere, with zero indication
              of why — the exact silent failure this is meant to replace. */}
          {locationError && (
            <motion.div
              key="location-access-denied"
              initial={{ opacity: 0, y: -30, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -30, scale: 0.95 }}
              className="p-3 border border-red-500 bg-red-950/90 backdrop-blur-md flex items-center gap-2 shadow-[0_0_15px_rgba(239,68,68,0.4)]"
            >
              <ShieldAlert size={16} className="text-red-500 shrink-0" />
              <p className="font-dot text-xs text-white uppercase tracking-widest leading-tight flex-1">
                {locationError === 'denied'
                  ? '⚠ LOCATION ACCESS DENIED — SQUAD CANNOT SEE YOU'
                  : '⚠ NO GPS FIX — SQUAD CANNOT SEE YOU'}
              </p>
              <button onClick={() => setLocationError(null)} className="text-red-400 hover:text-white shrink-0 pointer-events-auto" title="Dismiss">
                <X size={14} />
              </button>
            </motion.div>
          )}
          {signalLostAlerts.map(alert => (
            <motion.div
              key={alert.id}
              initial={{ opacity: 0, y: -30, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -30, scale: 0.95 }}
              className="p-3 border border-zinc-500 bg-zinc-900/90 backdrop-blur-md flex items-center gap-2 shadow-[0_0_15px_rgba(0,0,0,0.5)]"
            >
              <WifiOff size={16} className="text-zinc-400 shrink-0" />
              <p className="font-dot text-xs text-white uppercase tracking-widest leading-tight">
                ⚠ <span className="text-zinc-300">{alert.name}</span> SIGNAL LOST — TRACKING LAST VECTOR
              </p>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      {/* FULLSCREEN MAP */}
      <div className="absolute inset-0 z-0 bg-black">
        {mapEngineFailed ? (
          <Suspense
            fallback={
              <div className="w-full h-full flex items-center justify-center font-dot text-xs uppercase tracking-widest text-zinc-500">
                LOADING_FALLBACK_GRID...
              </div>
            }
          >
            <TacticalLeafletMap
              center={mapProps.center}
              zoom={mapProps.zoom}
              onZoomChange={setCurrentZoom}
              onMapClick={handleMapClick}
              onFocus={handleFocus}
              liveLocation={showSelfMarker ? selfMarkerAt : null}
              liveIndoor={selfIndoor}
              indoorView={indoorView}
              liveIsNavigating={isNavigating}
              liveHeading={liveHeading}
              currentZoom={currentZoom}
              users={users}
              blockedUserIds={blockedUserIds}
              ghostMembers={ghostMembers}
              activeTab={activeTab}
              activeWaypoint={activeWaypoint}
              walkingRoute={walkingRoute}
              canClearWaypoint={canClearWaypoint}
              highlightBuildingId={(activeTab === 'buildings' && selectedItem?.id) || routeEnd?.id || null}
              onClearWaypoint={() => socket.emit('clear-waypoint', squadCode)}
              onArTrack={setArTarget}
              isSatellite={isSatellite}
            />
          </Suspense>
        ) : (
        <GoogleMapReact
          bootstrapURLKeys={{ key: GOOGLE_MAPS_API_KEY }}
          center={mapProps.center}
          options={mapOptions}

          onClick={handleMapClick}

          zoom={mapProps.zoom}
          onChange={({ zoom }) => setCurrentZoom(zoom)}

          yesIWantToUseGoogleMapApiInternals
          onGoogleApiLoaded={({ map }) => {
            mapRef.current = map;
            map.setTilt(0);
            // 🟢 GREEN LIGHT: Map canvas is live — safe to draw saved zones now
            setIsMapReady(true);
          }}
        >
          {showSelfMarker && (
            <div
              key="live-user"
              lat={selfMarkerAt.lat}
              lng={selfMarkerAt.lng}
              onClick={() => handleFocus(selfMarkerAt, null)}
              style={{ cursor: 'pointer' }}
            >
              {selfIndoor && <ConfidenceHalo confidence={selfIndoor.confidence} color="#10B981" />}
              <LiveLocationMarker
                zoom={currentZoom}
                isNavigating={isNavigating}
                heading={liveHeading}
                color="#10B981"
              />
            </div>
          )}
          {/* Buildings render as a single red dot marker each, not a traced outline —
              even for the subset with a verified OSM footprint, the polygon shape only
              ever matches the roof as seen from directly overhead. Real-world imagery
              here is captured off-nadir (at an angle), which displaces the visible roof
              from the ground footprint OSM actually traces, so the outline reads as
              "wrong" even when the underlying data is correct. A dot has no such
              failure mode. (TacticalLeafletMap.jsx renders the same way.) */}
          {activeTab === 'buildings' && SRM_MASTER_DATABASE.map(b => (
            <div
              key={`building-${b.id}`}
              lat={b.lat}
              lng={b.lng}
              onClick={() => handleFocus({ lat: b.lat, lng: b.lng }, b)}
              style={{ cursor: 'pointer' }}
            >
              <BuildingMarker highlighted={(activeTab === 'buildings' && selectedItem?.id === b.id) || routeEnd?.id === b.id} />
            </div>
          ))}
          {activeWaypoint && (
            <WaypointMarker
              lat={activeWaypoint.lat}
              lng={activeWaypoint.lng}
              name={activeWaypoint.name}
              onClick={() => handleFocus(activeWaypoint, null)}
              canClear={canClearWaypoint}
              onClear={() => socket.emit('clear-waypoint', squadCode)}
              onTrack={() => setArTarget({ lat: activeWaypoint.lat, lng: activeWaypoint.lng, name: activeWaypoint.name })}
            />
          )}
          {/* Same set the squad roster panel shows, minus the members who have no fix to
              plot yet — those stay listed there rather than disappearing from the app
              entirely. Nothing else narrows it: this and the roster panel render the same
              set, deliberately, so the two views cannot drift apart again.

              Deliberately NOT gated on activeTab either — squad members' live positions are
              core tactical data, not something that should vanish just because the sidebar
              happens to be showing the buildings list (which defaults to being the active
              tab on load, so this used to hide every squad member until you flipped to the
              SQUAD tab and back). */}
          {users.filter(u => !blockedUserIds.includes(u.id) && u.status !== 'GHOST' && u.hasFix).map(u => (
            <div
              key={u.id}
              lat={u.lat}
              lng={u.lng}
              onClick={() => handleFocus({ lat: u.lat, lng: u.lng }, null)}
              style={{
                cursor: 'pointer',
                animation: 'locus-member-fade-in 0.6s ease',
                // Stage 7: on another floor of the building you're viewing - dimmed, never hidden.
                ...(SHOW_INDOOR_POSITION_TO_SQUAD && isOnOtherFloor(u, indoorView) ? { opacity: 0.35 } : {}),
              }}
            >
              <LiveLocationMarker
                zoom={currentZoom}
                isNavigating={Boolean(activeWaypoint) || (u.speed / 3.6) > NAVIGATING_SPEED_MPS}
                heading={u.heading}
                color="#EF4444"
              />
              {SHOW_INDOOR_POSITION_TO_SQUAD && memberFloorTag(u) && <FloorTag text={memberFloorTag(u)} color="#EF4444" />}
            </div>
          ))}

          {/* Ghost markers always render — no activeTab gate so they show on any tab.
              Position is ghost.position (live-projected, capped, then frozen at
              lastKnownLocation once expired), not a one-shot frozen guess. */}
          {ghostMembers.map(ghost => (
            <div
              key={`ghost-${ghost.id}`}
              lat={ghost.position.lat}
              lng={ghost.position.lng}
              onClick={() => handleFocus(ghost.position, { name: `${ghost.phase === 'expired' ? 'LAST KNOWN' : 'SIGNAL LOST'}: ${ghost.name}`, info: `Last seen with ${ghost.battery ?? 0}% battery.` })}
              style={{ cursor: 'pointer', opacity: ghost.fading ? 0 : 1, transition: `opacity ${GHOST_FADE_MS}ms ease` }}
            >
              <GhostMemberMarker phase={ghost.phase} elapsedLabel={ghost.elapsedLabel} color="#A1A1AA" />
            </div>
          ))}


          {/* ... Your existing users.filter map loop stays exactly the same below this ... */}
        </GoogleMapReact>
        )}
        {/* PHASE 3: Satellite toggle pill removed — function reassigned to Bottom HUD GRID button */}
      </div>

      {/* --- ADMIN INDICATOR (Compact HUD) --- */}
      {isAdmin && isRecordingPath && (
        <div className="absolute top-24 right-6 z-[600] flex flex-col gap-2 pointer-events-auto">
          <div className="bg-black border border-yellow-500 p-4 flex flex-col gap-3 shadow-[0_0_20px_rgba(234,179,8,0.4)]">
            <div className="text-yellow-500 font-dot text-xs tracking-widest animate-pulse">RECORDING_NODES: {recordedCoords.length}</div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  const startName = prompt("Enter START Building Name (e.g., Tech Park):");
                  const endName = prompt("Enter END Building Name (e.g., Java Green):");
                  if (startName && endName && recordedCoords.length > 1) {
                    const newRouteData = { distance: "CUSTOM", eta: "TACTICAL", path: recordedCoords };
                    setLiveSecretRoutes(prev => ({ ...prev, [`${startName}_${endName}`]: newRouteData }));
                    socket.emit('publish-custom-route', { key: `${startName}_${endName}`, data: newRouteData, roomCode: squadCode });
                    setIsRecordingPath(false);
                    setRecordedCoords([]);
                    if (recordingPolylineRef.current) recordingPolylineRef.current.setMap(null);
                    recordingPolylineRef.current = null;
                    notify.success(`[SYS] Route ${startName} -> ${endName} published.`);
                  }
                }}
                className="flex-1 p-2 bg-yellow-500 text-black font-dot text-[10px] hover:bg-yellow-400 transition-colors"
              >
                PUBLISH
              </button>
              <button
                onClick={() => {
                  setIsRecordingPath(false);
                  setRecordedCoords([]);
                  if (recordingPolylineRef.current) recordingPolylineRef.current.setMap(null);
                  recordingPolylineRef.current = null;
                }}
                className="flex-1 p-2 border border-red-500 text-red-500 font-dot text-[10px] hover:bg-red-500 hover:text-white transition-colors"
              >
                ABORT
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Map Interactive Layers */}
      {/* WiFi Arc Stage 7: floor picker, only while you have an indoor reading. */}
      {WIFI_POSITIONING_ENABLED && indoorView && <FloorPicker view={indoorView} />}
      {/* Owner-only field-test readout: every scan cycle's numbers, for judging the estimates. */}
      {WIFI_POSITIONING_ENABLED && isAdmin && <WifiReadout lastCycle={lastCycle} active={wifiActive} />}

      {/* Right-side Action Column */}
      <div className="absolute right-4 top-1/3 flex flex-col gap-2.5 z-40 pointer-events-auto">

        <button
          onClick={() => handleFocus(SRM_KTR_COORDS, null)}
          className={MAP_CONTROL}
          title="Recenter Campus"
        >
          <MapPin size={20} />
        </button>

        {selfMarkerAt && (
          <button
            onClick={() => handleFocus(selfMarkerAt, null)}
            className={`${MAP_CONTROL} relative !text-red-500 !border-red-500/50 shadow-[0_0_12px_rgba(239,68,68,0.35)]`}
            title="Locate Signal"
          >
            {/* One soft radar ring, instead of the icon pulsing without end. */}
            <span className="absolute inset-0 border border-red-500/60 locus-soft-ring" aria-hidden="true" />
            <LocateFixed size={20} />
          </button>
        )}

        {/* Satellite Recon Toggle Button */}
        <button
          onClick={() => setIsSatellite(!isSatellite)}
          className={`${MAP_CONTROL} ${isSatellite ? '!bg-emerald-500/15 !text-emerald-400 !border-emerald-500/70 shadow-[0_0_15px_rgba(16,185,129,0.35)]' : ''}`}
          title={isSatellite ? "Switch to Tactical Grid" : "Switch to Satellite Recon"}
        >
          {/* The globe turns half a revolution each way as the map style flips. */}
          <motion.span className="flex" animate={{ rotate: isSatellite ? 180 : 0 }} transition={reduceMotion ? { duration: 0 } : PANEL_SPRING}>
            <Globe size={20} />
          </motion.span>
        </button>

        {/* Gear icon opens SYS_CONFIG modal */}
        <button
          onClick={() => setShowSettingsModal(true)}
          className={MAP_CONTROL}
          title="System Configuration (SYS_CONFIG)"
        >
          <Settings size={20} />
        </button>
      </div>

      {/* Selected Location Card. On a phone it sits above the floating SOS button (80 px
          tall, 80 px up, plus the safe area): it used to start at 96 px, so SOS - drawn on
          top - covered the card's first button. 11rem clears it with a gap. */}
      <AnimatePresence>
        {selectedItem && activeTab === 'buildings' && (
          <motion.div
            initial={{ opacity: 0, x: 60 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 60 }}
            transition={{ duration: 0.4 }}
            data-testid="location-card"
            className="absolute inset-x-4 bottom-[calc(11rem+env(safe-area-inset-bottom))] md:inset-x-auto md:bottom-6 md:right-6 z-[600] md:w-80 max-h-[55vh] md:max-h-none overflow-y-auto bg-black border border-white/20 pointer-events-auto flex flex-col pt-6 pb-2"
          >
            <div className="px-6 pb-4 border-b border-white/20 flex justify-between items-start">
              <div className="flex-1 pr-4">
                <span className="inline-block border border-red-500 text-red-500 font-dot text-[10px] uppercase tracking-widest px-2 py-0.5 mb-2">
                  SYS_NODE // {selectedItem.category}
                </span>
                <h2 className="text-xl font-dot uppercase tracking-widest text-white leading-tight">{selectedItem.name}</h2>
              </div>
              <button onClick={() => setSelectedItem(null)} className="p-2 border border-white/20 hover:bg-white hover:text-black transition-colors shrink-0">
                <X size={16} />
              </button>
            </div>

            <div className="p-6 pb-4">
              <p className="font-inter text-zinc-400 text-sm leading-relaxed">{selectedItem.info}</p>
            </div>


            <div className="px-6 pb-4 flex gap-3">
              {/* If no intel is loaded and we aren't fetching, show the button */}
              {!buildingIntel && !aiLoading && (
                <button
                  onClick={() => generateBuildingInsights(selectedItem)}
                  className="flex-1 py-3 border border-white/20 hover:bg-white/10 font-dot text-[10px] text-white flex items-center justify-center gap-2 transition-colors uppercase tracking-widest"
                >
                  <Sparkles size={14} className="text-red-500" /> QUERY_DATA
                </button>
              )}

              {/* If we ARE fetching, show the loader */}
              {aiLoading && (
                <div className="flex-1 py-3 border border-white/20 font-dot text-[10px] text-zinc-500 flex items-center justify-center gap-2 uppercase tracking-widest">
                  <Loader2 className="animate-spin text-red-500" size={14} /> FETCHING...
                </div>
              )}

              {/* Always show the Waypoint/Destination button */}
              <button
                onClick={() => setArTarget({ lat: selectedItem.lat, lng: selectedItem.lng, name: selectedItem.name })}
                className="flex-1 py-3 bg-black border border-white/20 text-white hover:border-red-500 hover:text-red-500 font-dot text-[10px] font-bold flex items-center justify-center gap-2 transition-colors uppercase tracking-widest"
              >
                <Crosshair size={14} /> AR_TRACK
              </button>
              <button
                onClick={() => handleWaypointSelect(selectedItem)}
                className="flex-1 py-3 bg-white text-black hover:bg-zinc-200 font-dot text-[10px] font-bold flex items-center justify-center gap-2 transition-colors uppercase tracking-widest"
              >
                <Navigation size={14} /> {routeStart && !routeEnd ? "SET_DESTINATION" : "WAYPOINT"}
              </button>
            </div>

            {buildingIntel && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="px-6 pb-6 max-h-40 overflow-y-auto custom-scrollbar">
                <div className="font-inter text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap border-l-2 border-red-500 pl-4 py-1">
                  {buildingIntel}
                </div>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* --- PRIVACY MODAL --- */}
      <AnimatePresence>
        {showRequestsModal && (
          <motion.div
            {...modalBackdrop()}
            onClick={(e) => { if (e.target === e.currentTarget) setShowRequestsModal(false); }}
            className="fixed inset-0 bg-black/90 backdrop-blur-md z-[2000] flex items-center justify-center p-4 pointer-events-auto"
          >
            <motion.div
              {...modalCard(reduceMotion)}
              className="bg-zinc-950 w-full max-w-lg border border-red-500/30 flex flex-col max-h-[85vh] overflow-hidden relative shadow-[0_0_50px_rgba(239,68,68,0.1)]"
            >
              {/* Tactical HUD Corners */}
              <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-red-500 z-10" />
              <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-red-500 z-10" />
              <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-red-500 z-10" />
              <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-red-500 z-10" />

              {/* Subtle Grid Background */}
              <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:16px_16px] pointer-events-none" />

              {/* Header */}
              <div className="p-6 border-b border-red-500/30 flex items-center justify-between bg-black/50 relative z-10">
                <div className="flex items-center gap-4">
                  <div className="border border-red-500/50 bg-red-500/10 p-2 text-red-500 shadow-[0_0_15px_rgba(239,68,68,0.2)]">
                    <ShieldCheck size={24} className="animate-pulse" />
                  </div>
                  <div>
                    <h3 className="font-dot text-xl tracking-widest text-white uppercase leading-none mb-1">SYS_ACCESS_CONTROL</h3>
                    <p className="font-dot text-[10px] text-red-500 tracking-widest uppercase">SECURE_OVERRIDE_TERMINAL</p>
                  </div>
                </div>
                <button onClick={() => setShowRequestsModal(false)} className="p-2 border border-transparent hover:border-red-500 transition-colors text-zinc-500 hover:text-red-500">
                  <X size={20} />
                </button>
              </div>

              {/* Tabs */}
              <div className="flex border-b border-red-500/20 bg-black/40 relative z-10">
                <button
                  onClick={() => setModalTab('requests')}
                  className={`flex-1 py-4 font-dot text-sm uppercase tracking-widest transition-all relative ${modalTab === 'requests' ? 'text-red-500 bg-red-500/5' : 'text-zinc-500 hover:text-white hover:bg-white/5'
                    }`}
                >
                  INBOUND {pendingRequests.length > 0 && `[${pendingRequests.length}]`}
                  {modalTab === 'requests' && <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.8)]" />}
                </button>
                <button
                  onClick={() => setModalTab('blocked')}
                  className={`flex-1 py-4 border-l border-red-500/20 font-dot text-sm uppercase tracking-widest transition-all relative ${modalTab === 'blocked' ? 'text-red-500 bg-red-500/5' : 'text-zinc-500 hover:text-white hover:bg-white/5'
                    }`}
                >
                  BLACKLIST
                  {modalTab === 'blocked' && <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.8)]" />}
                </button>
              </div>

              {/* Content Area */}
              <div className="p-6 overflow-y-auto custom-scrollbar flex-1 space-y-4 relative z-10 min-h-[300px]">
                {modalTab === 'requests' ? (
                  pendingRequests.length === 0 ? (
                    <div className="h-full py-16 flex flex-col items-center justify-center text-red-500/40 gap-6 cursor-default">
                      <div className="relative">
                        <motion.div animate={{ rotate: 360 }} transition={{ duration: 8, ease: "linear", repeat: Infinity }} className="absolute -inset-4 border border-dashed border-red-500/30 rounded-full" />
                        <ShieldCheck size={56} className="relative z-10 drop-shadow-[0_0_15px_rgba(239,68,68,0.3)]" />
                      </div>
                      <div className="text-center">
                        <p className="font-dot tracking-widest text-sm uppercase text-zinc-300">NO_PENDING_REQUESTS</p>
                        <p className="font-dot tracking-[0.2em] text-[10px] uppercase text-zinc-600 mt-2 animate-pulse">MONITORING_NETWORK_TRAFFIC...</p>
                      </div>
                    </div>
                  ) : (
                    pendingRequests.map(node => (
                      <div key={node.targetId} className="p-4 bg-black/60 border border-white/10 hover:border-red-500/50 flex flex-col gap-4 relative transition-colors shadow-lg">
                        <div className="absolute top-0 right-0 w-2 h-2 bg-red-500 animate-pulse" />

                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 border border-white/30 flex items-center justify-center font-dot text-xl text-zinc-400 overflow-hidden bg-black">
                            {node.photo ? <img src={node.photo} className="w-full h-full object-cover opacity-80" alt="" /> : node.name.charAt(0)}
                          </div>
                          <div>
                            <p className="font-dot uppercase tracking-widest text-white text-lg drop-shadow-[0_0_5px_rgba(255,255,255,0.5)]">{node.name}</p>
                            <p className="text-[10px] font-dot text-red-500 uppercase tracking-widest">REQUESTING_ACCESS // NODE_LINK</p>
                          </div>
                        </div>

                        <div className="flex gap-3 mt-2">
                          <button
                            onClick={() => {
                              // The squad the request was made to, not merely the one on screen.
                              socket.emit('resolve-access', { targetId: node.targetId, roomCode: node.roomCode || squadCode, approved: true });
                              setPendingRequests(prev => prev.filter(p => p.targetId !== node.targetId));
                            }}
                            className="flex-1 bg-white/10 text-emerald-400 border border-emerald-500/50 hover:bg-emerald-500/20 hover:border-emerald-400 py-3 font-dot text-xs uppercase tracking-widest transition-all shadow-[0_0_10px_rgba(16,185,129,0.1)] hover:shadow-[0_0_15px_rgba(16,185,129,0.3)]"
                          >
                            GRANT_ACCESS
                          </button>
                          <button
                            onClick={() => {
                              socket.emit('resolve-access', { targetId: node.targetId, roomCode: node.roomCode || squadCode, approved: false });
                              setPendingRequests(prev => prev.filter(p => p.targetId !== node.targetId));
                            }}
                            className="flex-1 bg-black text-red-500 py-3 border border-red-500/30 hover:bg-red-500/10 hover:border-red-500 font-dot text-xs uppercase tracking-widest transition-all"
                          >
                            DENY
                          </button>
                        </div>
                      </div>
                    ))
                  )
                ) : (
                  blockedUsers.length === 0 ? (
                    <div className="h-full py-16 flex flex-col items-center justify-center text-red-500/40 gap-6 cursor-default">
                      <div className="relative">
                        <motion.div animate={{ rotate: -360 }} transition={{ duration: 10, ease: "linear", repeat: Infinity }} className="absolute -inset-4 border border-dashed border-zinc-600/30 rounded-full" />
                        <Ban size={56} className="relative z-10 text-zinc-600 drop-shadow-[0_0_15px_rgba(82,82,91,0.3)]" />
                      </div>
                      <p className="font-dot tracking-widest text-sm uppercase text-zinc-400">BLACKLIST_EMPTY</p>
                    </div>
                  ) : (
                    blockedUsers.map(user => (
                      <div key={user.id} className="p-4 bg-black/60 border-l-4 border-l-red-500 border-y border-r border-white/10 flex items-center justify-between">
                        <span className="font-dot uppercase tracking-widest text-zinc-300">{user.name}</span>
                        <button onClick={() => toggleBlock(user.id)} className="border border-white/20 hover:border-white text-white hover:bg-white hover:text-black px-4 py-2 font-dot text-xs uppercase tracking-widest transition-all">
                          REVOKE
                        </button>
                      </div>
                    ))
                  )
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* --- COMMANDER'S TELEMETRY MATRIX MODAL --- */}
      <AnimatePresence>
        {showTelemetryModal && rawTelemetryData && (
          <motion.div
            {...modalBackdrop()}
            onClick={(e) => { if (e.target === e.currentTarget) setShowTelemetryModal(false); }}
            className="fixed inset-0 bg-black/95 backdrop-blur-md z-[4000] flex items-center justify-center p-4 pointer-events-auto bg-dots"
          >
            <motion.div
              {...modalCard(reduceMotion)}
              className="bg-black w-full max-w-4xl border border-yellow-500 flex flex-col h-[80vh] relative shadow-[0_0_30px_rgba(234,179,8,0.1)]"
            >
              {/* Corner Accents */}
              <div className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 border-yellow-500 -translate-x-1 -translate-y-1" />
              <div className="absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 border-yellow-500 translate-x-1 translate-y-1" />

              {/* Header */}
              <div className="p-6 border-b border-yellow-500/30 flex justify-between items-center bg-black">
                <div className="flex items-center gap-4 text-yellow-500">
                  <Activity className="w-8 h-8 animate-pulse" />
                  <div>
                    <h3 className="font-dot text-2xl tracking-widest uppercase text-white">SYS_TELEMETRY // MATRIX</h3>
                    <p className="font-dot text-[10px] tracking-widest uppercase">COMMANDER CLASSIFIED CLEARANCE</p>
                  </div>
                </div>
                <button onClick={() => setShowTelemetryModal(false)} className="p-2 border border-transparent hover:border-yellow-500 transition-colors text-zinc-500 hover:text-yellow-500">
                  <X size={24} />
                </button>
              </div>

              {/* Data Table */}
              <div className="flex-1 overflow-y-auto p-4 md:p-6 custom-scrollbar bg-black">
                <div className="w-full border border-white/20">

                  {/* Table Header Row (Hidden on Mobile, Visible on Desktop) */}
                  <div className="hidden md:grid md:grid-cols-4 bg-white/5 border-b border-white/20 p-3 font-dot text-[10px] uppercase tracking-widest text-zinc-500">
                    <div>NODE_DESIGNATION</div>
                    <div>LAST_KNOWN_COORDS</div>
                    <div>POWER_CORE</div>
                    <div>SIGNAL_INTEGRITY</div>
                  </div>

                  {/* Table Body */}
                  {users.length === 0 && (
                    <div className="p-6 font-dot text-xs uppercase tracking-widest text-zinc-500 text-center">
                      NO OTHER OPERATIVES IN THE SQUAD YET.
                    </div>
                  )}
                  {users.map(userNode => {
                    const cacheData = rawTelemetryData?.[userNode.id];
                    // Read defensively: a server that predates normalised records sends a
                    // member's raw cache entry, which has lat/lng/lastSeen/battery until their
                    // first heartbeat adds latitude/longitude/timestamp/batteryLevel. The
                    // bare `latitude.toFixed()` this used took the whole app down on one.
                    const latitude = finiteOrNull(cacheData?.latitude) ?? finiteOrNull(cacheData?.lat);
                    const longitude = finiteOrNull(cacheData?.longitude) ?? finiteOrNull(cacheData?.lng);
                    const hasPosition = latitude !== null && longitude !== null;
                    const battery = batteryReading(cacheData);
                    const freshness = getSignalFreshness(cacheData?.timestamp ?? cacheData?.lastSeen);

                    return (
                      <div key={userNode.id} className="grid grid-cols-1 md:grid-cols-4 gap-3 md:gap-0 border-b border-white/10 p-4 font-dot text-xs tracking-widest uppercase text-white hover:bg-white/5 transition-colors items-start md:items-center">

                        {/* 1. NODE NAME */}
                        <div className="flex items-center gap-3">
                          <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_10px_#10b981]" />
                          <span className="text-sm md:text-xs">{userNode.name}</span>
                        </div>

                        {/* 2. COORDINATES */}
                        <div className="text-zinc-400 font-mono text-[10px] flex md:block justify-between items-center border-t border-white/5 md:border-transparent pt-2 md:pt-0 mt-2 md:mt-0">
                          <span className="md:hidden text-zinc-600 font-dot uppercase tracking-widest">COORDS:</span>
                          <div className="text-right md:text-left">
                            {hasPosition ? (
                              <>
                                LAT: {latitude.toFixed(5)}<br />
                                LNG: {longitude.toFixed(5)}
                              </>
                            ) : "NO_CACHE_DATA"}
                          </div>
                        </div>

                        {/* 3. BATTERY */}
                        <div className={`font-bold flex md:block justify-between items-center ${battery.color}`}>
                          <span className="md:hidden text-zinc-600 font-normal text-[10px] font-dot uppercase tracking-widest">POWER:</span>
                          {battery.text}
                        </div>

                        {/* 4. SIGNAL FRESHNESS */}
                        <div className={`font-bold flex md:block justify-between items-center ${freshness.color}`}>
                          <span className="md:hidden text-zinc-600 font-normal text-[10px] font-dot uppercase tracking-widest">SIGNAL:</span>
                          {freshness.text}
                        </div>

                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Footer */}
              <div className="p-4 border-t border-yellow-500/30 flex justify-between items-center bg-black">
                {telemetrySync.status === 'error' ? (
                  <span className="font-dot text-[10px] text-red-400 uppercase tracking-widest pr-4">{telemetrySync.message}</span>
                ) : (
                  <span className="font-dot text-[10px] text-zinc-600 uppercase tracking-widest">AUTO-REFRESHING EVERY 5 SECONDS</span>
                )}
                <button
                  onClick={requestTelemetrySync}
                  disabled={telemetrySync.status === 'pending'}
                  className="px-6 py-2 border border-yellow-500 text-yellow-500 hover:bg-yellow-500 hover:text-black font-dot text-xs uppercase tracking-widest transition-colors flex items-center gap-2 shrink-0 disabled:cursor-wait disabled:opacity-70"
                >
                  {telemetrySync.status === 'pending'
                    ? <><Loader2 size={14} className="animate-spin" /> SYNCING...</>
                    : <><Activity size={14} /> FORCE_SYNC</>}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* --- SYS_CONFIG MODAL --- */}
      <AnimatePresence>
        {showSettingsModal && (
          <motion.div
            {...modalBackdrop()}
            onClick={(e) => { if (e.target === e.currentTarget) setShowSettingsModal(false); }}
            className="fixed inset-0 bg-black/95 backdrop-blur-md z-[5000] flex items-center justify-center p-4 pointer-events-auto bg-dots"
          >
            <motion.div
              {...modalCard(reduceMotion)}
              className="bg-black w-full max-w-2xl border border-white/30 flex flex-col max-h-[85vh] relative shadow-[0_0_30px_rgba(255,255,255,0.05)]"
            >
              {/* Header */}
              <div className="p-6 border-b border-white/20 flex justify-between items-center bg-black">
                <div className="flex items-center gap-4 text-white">
                  <Sliders className="w-6 h-6 text-zinc-400" />
                  <div>
                    <h3 className="font-dot text-xl tracking-widest uppercase">SYS_CONFIG</h3>
                    <p className="font-dot text-[10px] tracking-widest uppercase text-zinc-500">LOCAL CLIENT PREFERENCES</p>
                  </div>
                </div>
                <button onClick={() => setShowSettingsModal(false)} className="p-2 border border-transparent hover:border-white transition-colors text-zinc-500 hover:text-white">
                  <X size={20} />
                </button>
              </div>

              {/* Settings List */}
              <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar bg-black text-white">

                {/* Setting 1: Audio */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 border-b border-white/10 pb-2">
                    {sysConfig.audio ? <Volume2 size={16} className="text-emerald-500" /> : <VolumeX size={16} className="text-red-500" />}
                    <span className="font-dot text-xs uppercase tracking-widest text-zinc-400">SONAR_AUDIO_SIGNALS</span>
                  </div>
                  <div className="flex gap-4">
                    <button onClick={() => toggleConfig('audio', true)} className={`flex-1 py-3 font-dot text-xs uppercase tracking-widest border transition-colors ${sysConfig.audio ? 'bg-white text-black border-white' : 'bg-black text-zinc-500 border-white/20 hover:border-white/50'}`}>ENABLED</button>
                    <button onClick={() => toggleConfig('audio', false)} className={`flex-1 py-3 font-dot text-xs uppercase tracking-widest border transition-colors ${!sysConfig.audio ? 'bg-red-500/20 text-red-500 border-red-500' : 'bg-black text-zinc-500 border-white/20 hover:border-white/50'}`}>MUTED</button>
                  </div>
                </div>

                {/* Setting 2: Map Theme & Satellite Mode */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 border-b border-white/10 pb-2">
                    <Globe size={16} className="text-emerald-400" />
                    <span className="font-dot text-xs uppercase tracking-widest text-zinc-400">MAP_RENDER_MODE</span>
                  </div>
                  <div className="flex gap-4">
                    <button 
                      onClick={() => setIsSatellite(false)} 
                      className={`flex-1 py-3 font-dot text-xs uppercase tracking-widest border transition-colors ${!isSatellite ? 'bg-blue-500/20 text-blue-400 border-blue-500' : 'bg-black text-zinc-500 border-white/20 hover:border-white/50'}`}
                    >
                      TACTICAL (DARK GRID)
                    </button>
                    <button 
                      onClick={() => setIsSatellite(true)} 
                      className={`flex-1 py-3 font-dot text-xs uppercase tracking-widest border transition-colors ${isSatellite ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)]' : 'bg-black text-zinc-500 border-white/20 hover:border-white/50'}`}
                    >
                      ORBITAL (SATELLITE)
                    </button>
                  </div>
                </div>

                {/* Setting 3: Polling Rate */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 border-b border-white/10 pb-2">
                    <Zap size={16} className="text-yellow-500" />
                    <span className="font-dot text-xs uppercase tracking-widest text-zinc-400">TELEMETRY_POLLING_RATE</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <button onClick={() => toggleConfig('polling', 'eco')} className={`py-3 font-dot text-[10px] uppercase tracking-widest border flex flex-col items-center gap-1 transition-colors ${sysConfig.polling === 'eco' ? 'bg-emerald-500/20 text-emerald-500 border-emerald-500' : 'bg-black text-zinc-500 border-white/20 hover:border-white/50'}`}>
                      <Battery size={14} /> ECO (15s)
                    </button>
                    <button onClick={() => toggleConfig('polling', 'standard')} className={`py-3 font-dot text-[10px] uppercase tracking-widest border flex flex-col items-center gap-1 transition-colors ${sysConfig.polling === 'standard' ? 'bg-white/10 text-white border-white' : 'bg-black text-zinc-500 border-white/20 hover:border-white/50'}`}>
                      <Activity size={14} /> STANDARD (5s)
                    </button>
                    <button onClick={() => toggleConfig('polling', 'max')} className={`py-3 font-dot text-[10px] uppercase tracking-widest border flex flex-col items-center gap-1 transition-colors ${sysConfig.polling === 'max' ? 'bg-red-500/20 text-red-500 border-red-500' : 'bg-black text-zinc-500 border-white/20 hover:border-white/50'}`}>
                      <Zap size={14} /> MAX (1s)
                    </button>
                  </div>
                  <p className="font-inter text-[10px] text-zinc-500 leading-tight">Warning: MAX polling drains battery significantly faster. Use only during active pursuits.</p>
                </div>

              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* --- END OF MODALS --- */}

      {/* --- ADMIN_SETTINGS MODAL --- */}
      <AnimatePresence>
        {showAdminSettings && isAdmin && (
          <motion.div
            {...modalBackdrop()}
            className="fixed inset-0 bg-black/95 backdrop-blur-md z-[6000] flex items-center justify-center p-4 pointer-events-auto bg-dots"
          >
            <motion.div
              {...modalCard(reduceMotion)}
              className="bg-black w-full max-w-2xl border border-yellow-500/60 flex flex-col max-h-[88vh] relative shadow-[0_0_40px_rgba(234,179,8,0.15)]"
            >
              {/* Corner Accents */}
              <div className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 border-yellow-500" />
              <div className="absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 border-yellow-500" />
              <div className="absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2 border-yellow-500" />
              <div className="absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 border-yellow-500" />

              {/* Header */}
              <div className="p-6 border-b border-yellow-500/30 flex justify-between items-center bg-black">
                <div className="flex items-center gap-4">
                  <ShieldAlert className="w-6 h-6 text-yellow-500" />
                  <div>
                    <h3 className="font-dot text-xl tracking-widest uppercase text-yellow-500">ADMIN_OVERRIDE</h3>
                    <p className="font-dot text-[10px] tracking-widest uppercase text-zinc-500">
                      RESTRICTED ACCESS // <span className="text-yellow-500/70">{user?.email}</span>
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowAdminSettings(false)}
                  className="p-2 border border-yellow-500/30 hover:border-yellow-500 hover:text-yellow-500 transition-colors text-zinc-500"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Warning Banner */}
              <div className="flex items-center gap-3 px-6 py-3 bg-yellow-500/5 border-b border-yellow-500/20">
                <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse" />
                <span className="font-dot text-[10px] uppercase tracking-widest text-yellow-500/70">
                  CLASSIFIED // COMMANDER-LEVEL CONTROLS — ALL ACTIONS PUSH TO GLOBAL MATRIX
                </span>
              </div>

              {/* Scrollable Content */}
              <div className="flex-1 overflow-y-auto custom-scrollbar bg-black">

                {/* ─── SECTION 1: PATH RECORDER ─── */}
                <div className="p-6 border-b border-white/10">
                  <div className="flex items-center gap-3 mb-5">
                    <Route size={16} className="text-yellow-500" />
                    <span className="font-dot text-xs uppercase tracking-widest text-zinc-300">SECTION_01 // PATH_RECORDER</span>
                    <div className="flex-1 h-[1px] bg-yellow-500/20" />
                  </div>
                  <p className="font-inter text-[11px] text-zinc-500 mb-5 leading-relaxed">
                    Activate map recording mode to trace custom tactical routes between campus nodes. Click points on the map canvas, then publish to broadcast across all squad members.
                  </p>

                  {!isRecordingPath ? (
                    <button
                      onClick={() => { setIsRecordingPath(true); setShowAdminSettings(false); }}
                      className="w-full py-4 bg-black border border-yellow-500 text-yellow-500 hover:bg-yellow-500 hover:text-black font-dot text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-3 shadow-[0_0_15px_rgba(234,179,8,0.2)]"
                    >
                      <Crosshair size={16} className="animate-pulse" />
                      INITIATE_RECORD_PATH
                    </button>
                  ) : (
                    <div className="border border-yellow-500 p-4 bg-yellow-500/5">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-2 h-2 bg-yellow-500 rounded-full animate-ping" />
                        <span className="font-dot text-xs text-yellow-500 uppercase tracking-widest animate-pulse">
                          RECORDING ACTIVE — {recordedCoords.length} NODES CAPTURED
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            const startName = prompt("Enter START Building Name (e.g., Tech Park):");
                            const endName = prompt("Enter END Building Name (e.g., Java Green):");
                            if (startName && endName && recordedCoords.length > 1) {
                              const newRouteData = { distance: "CUSTOM", eta: "TACTICAL", path: recordedCoords };
                              setLiveSecretRoutes(prev => ({ ...prev, [`${startName}_${endName}`]: newRouteData }));
                              socket.emit('publish-custom-route', { key: `${startName}_${endName}`, data: newRouteData, roomCode: squadCode });
                              setIsRecordingPath(false);
                              setRecordedCoords([]);
                              if (recordingPolylineRef.current) recordingPolylineRef.current.setMap(null);
                              recordingPolylineRef.current = null;
                              notify.success(`[SYS] Route ${startName} → ${endName} published.`);
                            }
                          }}
                          className="flex-1 py-3 bg-yellow-500 text-black font-dot text-[10px] uppercase tracking-widest hover:bg-yellow-400 transition-colors flex items-center justify-center gap-2"
                        >
                          <Terminal size={12} /> PUBLISH_ROUTE
                        </button>
                        <button
                          onClick={() => {
                            setIsRecordingPath(false);
                            setRecordedCoords([]);
                            if (recordingPolylineRef.current) recordingPolylineRef.current.setMap(null);
                            recordingPolylineRef.current = null;
                          }}
                          className="flex-1 py-3 border border-red-500 text-red-500 font-dot text-[10px] uppercase tracking-widest hover:bg-red-500 hover:text-white transition-colors flex items-center justify-center gap-2"
                        >
                          <X size={12} /> ABORT
                        </button>
                      </div>
                    </div>
                  )}
                </div>

              </div>

              {/* Footer */}
              <div className="p-4 border-t border-yellow-500/20 flex justify-between items-center bg-black/80">
                <span className="font-dot text-[10px] text-zinc-600 uppercase tracking-widest">
                  COMMANDER // {user?.displayName || user?.email}
                </span>
                <button
                  onClick={() => setShowAdminSettings(false)}
                  className="px-6 py-2 border border-yellow-500/50 text-yellow-500 hover:bg-yellow-500 hover:text-black font-dot text-xs uppercase tracking-widest transition-colors"
                >
                  CLOSE_TERMINAL
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ========== MOBILE BOTTOM BAR (src/components/BottomTabBar.jsx) ========== */}
      <BottomTabBar
        activeId={mobileView === 'scan' ? 'scan' : sheetOpen ? 'squad' : 'grid'}
        tabs={[
          // GRID only navigates now. It used to toggle satellite on every tap as well, so
          // coming back to the map from SQUAD or SCAN flipped the map style; satellite has
          // its own globe button on the map.
          { id: 'grid', label: isSatellite ? 'ORBITAL' : 'GRID', Icon: Map, flourish: 'lift' },
          { id: 'scan', label: 'SCAN', Icon: Scan, flourish: 'turn' },
          { id: 'squad', label: 'SQUAD', Icon: Users, flourish: 'pop' },
        ]}
        onSelect={(id) => {
          const current = mobileView === 'scan' ? 'scan' : sheetOpen ? 'squad' : 'grid';
          if (id !== current) haptic('select');
          if (id === 'grid') {
            setMobileView('grid');
          } else if (id === 'scan') {
            setMobileView('scan');
            // First member with an actual fix — users can include members who are on the
            // roster but haven't reported coordinates yet, and aiming the AR compass at a
            // null coordinate points it nowhere. No one with a fix: scan toward campus.
            const scanNode = users.find(u => u.hasFix);
            setArTarget(scanNode
              ? { lat: scanNode.lat, lng: scanNode.lng, name: scanNode.name || 'SQUAD_NODE' }
              : { lat: SRM_KTR_COORDS.lat, lng: SRM_KTR_COORDS.lng, name: 'SRM_HQ' });
          } else {
            setMobileView('squad'); setActiveTab('users'); setSelectedItem(null);
          }
        }}
      />

      {/* ========== RALLY POINT FAB (Two-Step Targeting) ========== */}
      {!(selectedItem && activeTab === 'buildings') && (
        <button
          onClick={() => setIsTargetingMode(!isTargetingMode)}
          className={`md:hidden fixed bottom-20 right-4 p-4 rounded-full z-[1050] pointer-events-auto ${
            isTargetingMode
              ? 'bg-yellow-500 text-black border-2 border-yellow-300 shadow-[0_0_25px_rgba(234,179,8,0.6)]'
              : 'bg-red-600 text-black border-2 border-red-400 shadow-[0_0_20px_rgba(220,38,38,0.6)]'
          }`}
          style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
          title={isTargetingMode ? 'Cancel Targeting' : 'Deploy Rally Point'}
        >
          {/* Targeting: a dashed ring orbits the button while a spot is being chosen, and the
              crosshair spins into an X (and back), instead of the whole button blinking. */}
          {isTargetingMode && <span className="absolute -inset-2 rounded-full border-2 border-dashed border-yellow-400/80 locus-orbit" aria-hidden="true" />}
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={isTargetingMode ? 'cancel' : 'target'}
              className="flex"
              initial={reduceMotion ? { opacity: 0 } : { rotate: -90, scale: 0.6, opacity: 0 }}
              animate={{ rotate: 0, scale: 1, opacity: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { rotate: 90, scale: 0.6, opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
            >
              {isTargetingMode ? <X className="w-6 h-6" /> : <Crosshair className="w-6 h-6" />}
            </motion.span>
          </AnimatePresence>
        </button>
      )}

      {arTarget && <ARCompass target={arTarget} liveLocation={liveLocation} onClose={() => setArTarget(null)} />}

      {/* ========== SOS TRIGGER (double press-and-hold confirm) ========== */}
      <SosTrigger
        socket={socket}
        getLocation={() => liveLocationRef.current}
        roomCode={squadCode}
        senderName={user.displayName}
      />

      {/* ========== UPDATES: APK modal + JS-only restart strip (mandatory is gated far above) ========== */}
      {updateOverlay}

      {/* ========== INCOMING SOS (stays up until acknowledged) ========== */}
      {sosOverlay}
    </div>
  );
};

export default App;