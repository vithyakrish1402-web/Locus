import { io } from "socket.io-client";
import { Capacitor } from '@capacitor/core';
import React, { useState, useEffect, useRef, useMemo, Suspense } from 'react';
// `motion` is used throughout via <motion.div>/<motion.nav> JSX member expressions.
// This project's eslint config has no eslint-plugin-react (only react-hooks/react-refresh),
// so core no-unused-vars can't see through JSXMemberExpression tag names — false positive.
// eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence } from 'framer-motion';
import GoogleMapReact from 'google-map-react';
import {
  MapPin, Users, Search, Settings, Navigation, ShieldCheck,
  Building2, Sparkles, MessageSquare, Send, Loader2,
  BrainCircuit, Lock, UserCheck, Ban, LogOut, LockKeyhole, Eye, EyeOff, ArrowRight, X,
  Wifi, Bluetooth, Radio, LocateFixed, Waypoints, Activity,
  Target, Sliders, Volume2, VolumeX, Map, Battery, Zap, Bell, ShieldAlert, Terminal, Route, Crosshair, Trash2, Scan, RefreshCw, Globe, Layers
} from 'lucide-react';
// ... your other imports (React, framer-motion, lucide-react, etc.)


// 👇 ADD THIS LINE RIGHT HERE
import LocusGuide from './LocusGuide';
import ARCompass from './ARCompass';
import { SRM_MASTER_DATABASE } from './srmDatabase';
import { useDeviceHeading } from './hooks/useDeviceHeading';
import LocationMarker from './components/LocationMarker';
import WaypointMarker from './components/WaypointMarker';
import BuildingMarker from './components/BuildingMarker';
import SosTrigger from './components/SosTrigger';
import { deriveMarkerStatus } from './utils/markerStatus';
import { BUILDING_FOOTPRINT_STYLE, BUILDING_FOOTPRINT_HIGHLIGHT_STYLE } from './utils/buildingFootprintStyle';

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

// --- 🎲 AUTOMATIC SQUAD CODE RANDOMIZER (ALPHANUMERIC ONLY) ---
const generateRandomSquadCode = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

// --- THE NEW AUTH TERMINAL (Replaces CinematicLanding) ---
const AuthTerminal = ({
  email, setEmail, password, setPassword, showPassword, setShowPassword, executeAuthDirective, loginMethod, username, setUsername, latency
}) => {
  const [isRegistering, setIsRegistering] = useState(false);

  // --- 🔑 FORGOT PASSWORD / KEY RECOVERY HANDLER ---
  const handleForgotPassword = async () => {
    if (!email || !email.trim()) {
      alert("[SYS_ERROR] ID // EMAIL IS REQUIRED FOR KEY RECOVERY.");
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email.trim());
      alert(`[RECOVERY_DISPATCHED] RESET SIGNAL TRANSMITTED TO ${email.trim().toUpperCase()}. CHECK YOUR INBOX.`);
    } catch (error) {
      console.error("Password Reset Error:", error.code);
      let errorMessage = `[SYS_FAILURE] ${error.message}`;
      switch (error.code) {
        case 'auth/user-not-found': errorMessage = "[ACCESS_DENIED] NO OPERATIVE FOUND WITH THIS EMAIL."; break;
        case 'auth/invalid-email': errorMessage = "[SYS_ERROR] MALFORMED ID // EMAIL SYNTAX."; break;
        case 'auth/too-many-requests': errorMessage = "[SEC_LOCKOUT] TOO MANY REQUESTS. STAND BY BEFORE RETRYING."; break;
      }
      alert(errorMessage);
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
    <div className="relative w-full h-screen bg-black text-white font-inter selection:bg-red-500/30 flex items-center justify-center overflow-hidden bg-dots">

      {/* 📡 RESTORED PING HUD 📡 */}
      <div className="absolute top-6 right-8 z-50 flex items-center gap-3 font-dot text-xs tracking-widest text-zinc-400">
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
        className="w-full max-w-md p-10 border border-white/20 bg-black relative pointer-events-auto z-10 shadow-[0_0_50px_rgba(255,255,255,0.05)]"
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
// --- 🔮 THE PRECOGNITION ENGINE (KALMAN FILTER) ---
class PrecognitionFilter {
  constructor(q = 0.0001, r = 0.001) {
    this.q = q; // Trajectory Variance (How fast the target can actually change direction)
    this.r = r; // Sensor Distrust (How messy we assume the phone's GPS is)
    this.latEstimate = null;
    this.lngEstimate = null;
    this.latError = 1;
    this.lngError = 1;
  }

  filter(lat, lng) {
    if (!this.latEstimate) {
      this.latEstimate = lat;
      this.lngEstimate = lng;
      return { lat, lng };
    }
    // 1. Predict next state
    let pLat = this.latError + this.q;
    let pLng = this.lngError + this.q;

    // 2. Calculate Precognition Gain (How much do we trust the new GPS point?)
    let kLat = pLat / (pLat + this.r);
    let kLng = pLng / (pLng + this.r);

    // 3. Calculate final smoothed coordinates
    this.latEstimate = this.latEstimate + kLat * (lat - this.latEstimate);
    this.lngEstimate = this.lngEstimate + kLng * (lng - this.lngEstimate);

    // 4. Update error margin for the next calculation
    this.latError = (1 - kLat) * pLat;
    this.lngError = (1 - kLng) * pLng;

    return { lat: this.latEstimate, lng: this.lngEstimate };
  }
}
// --- 🧭 DEAD RECKONING ENGINE ---
const projectGhostLocation = (lat, lng, speedKmh, headingDegrees, timeDeltaSeconds) => {
  // If they were standing still, just return exact coordinates
  if (!speedKmh || speedKmh < 1) return { lat, lng };

  const R = 6371e3; // Earth's radius in meters
  // Convert km/h to m/s, then multiply by seconds offline (e.g., 5 seconds)
  const distanceMeters = (speedKmh * (5 / 18)) * timeDeltaSeconds;

  const radLat = lat * (Math.PI / 180);
  const radLng = lng * (Math.PI / 180);
  const radHeading = headingDegrees * (Math.PI / 180);

  const projectedLat = Math.asin(
    Math.sin(radLat) * Math.cos(distanceMeters / R) +
    Math.cos(radLat) * Math.sin(distanceMeters / R) * Math.cos(radHeading)
  );

  const projectedLng = radLng + Math.atan2(
    Math.sin(radHeading) * Math.sin(distanceMeters / R) * Math.cos(radLat),
    Math.cos(distanceMeters / R) - Math.sin(radLat) * Math.sin(projectedLat)
  );

  return {
    lat: projectedLat * (180 / Math.PI),
    lng: projectedLng * (180 / Math.PI)
  };
};

const App = () => {
  const [isSatellite, setIsSatellite] = useState(false);
  const [latency, setLatency] = useState(0);
  const [username, setUsername] = useState('');
  // --- MOBILE VIEW STATE ---
  // Controls which panel is active on mobile bottom HUD: 'grid' | 'matrix' | 'squad' | 'cmd'
  const [mobileView, setMobileView] = useState('grid');
  // --- TACTICAL WAYPOINT STATE ---
  const [isDroppingWaypoint, setIsDroppingWaypoint] = useState(false);
  const [activeWaypoint, setActiveWaypoint] = useState(null);
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

  const [zoneAlerts, setZoneAlerts] = useState([]); // <-- Tracks active perimeter breaches
  const [offlineNodes, setOfflineNodes] = useState({}); // <-- NEW: Tracks dead signals

  const [buildingIntel, setBuildingIntel] = useState('');

  // --- ADDED: ROUTING STATE ---
  const [routeStart, setRouteStart] = useState(null);
  const [routeEnd, setRouteEnd] = useState(null);
  const [routeData, setRouteData] = useState(null);
  const buildingPolygonsRef = useRef({}); // id -> google.maps.Polygon, real OSM building footprints

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
  // broadcast over the wire — drives this device's own LocationMarker status.
  const [liveSpeed, setLiveSpeed] = useState(0);
  const [telemetryMode, setTelemetryMode] = useState('ACTIVE');

  const [squadCode, setSquadCode] = useState('');
  const [squadMode, setSquadMode] = useState('create'); // 'create' or 'join'
  const [hasJoinedSquad, setHasJoinedSquad] = useState(false);

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

  // Auto-generate squad code when in 'create' mode. Intentionally keyed only on
  // squadMode: this should fire once per switch into 'create', not every time
  // squadCode itself changes (which would include the very setSquadCode call below).
  useEffect(() => {
    if (squadMode === 'create' && !squadCode) {
      setSquadCode(generateRandomSquadCode());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [squadMode]);
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
  const { heading, headingRef, requestHeadingPermission } = useDeviceHeading();
  // Mirrors telemetryMode in a ref so setInterval and watchPosition callbacks
  // always read the current value — they close over the ref, not the stale state.
  const telemetryModeRef = useRef('ACTIVE');

  // Start listening for compass heading as soon as we're signed in — on Android
  // this needs no user gesture. On iOS 13+ this call is a silent no-op (that
  // platform requires the permission request to originate from a click handler,
  // which ARCompass's own "GRANT_ACCESS" button still provides separately).
  useEffect(() => {
    if (user) requestHeadingPermission();
  }, [user, requestHeadingPermission]);

  const handleJoinSquad = (e) => {
    // Prevent the page from refreshing if this is inside a form
    if (e && e.preventDefault) e.preventDefault();

    // Don't do anything if the input is empty
    if (!squadCode || !squadCode.trim()) return;

    const targetRoom = squadCode.trim().toUpperCase();

    // 1. Send the knock to the server FIRST
    socket.emit('request-join', {
      roomCode: targetRoom,
      user: { name: user.displayName, photo: user.photoURL, uid: user.uid }
    });

    setHasJoinedSquad(true);

    if (squadMode === 'create') {
      // 🚀 INSTANT CLEARANCE FOR SQUAD CREATORS (0ms delay)
      setAccessStatus('granted');
      setSquadRole('OWNER');
    } else {
      // ⏳ FAILSAFE TIMEOUT FOR JOINING OPERATIVES (Fallback if network or server response is delayed)
      setTimeout(() => {
        setAccessStatus(currentStatus => {
          if (currentStatus !== 'denied' && currentStatus !== 'granted') {
            console.log("[SYS] Auto-granting clearance after network timeout fallback.");
            return 'granted';
          }
          return currentStatus;
        });
      }, 4000);
    }
  };

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
      // FIX 1: destructure timeDelta so projectGhostLocation receives the real lag time
      const { targetId, name, photo, lastKnownLocation, timeDelta } = emergencyData;

      console.log("🔥 [FRONTEND] Received Ghost Data:", emergencyData);

      if (typeof playSonarPing === 'function') {
        playSonarPing();
      }

      setUsers(prev => prev.filter(u => u.id !== targetId));

      const projectedCoords = projectGhostLocation(
        lastKnownLocation.latitude,
        lastKnownLocation.longitude,
        lastKnownLocation.speed || 0,
        lastKnownLocation.heading || 0,
        timeDelta || 5
      );

      // FIX 2: use projectedCoords (pre-cog position) instead of raw lastKnownLocation
      setOfflineNodes(prev => ({
        ...prev,
        [targetId]: {
          id: targetId,
          name: name,
          photo: photo,
          lat: projectedCoords.lat,
          lng: projectedCoords.lng,
          battery: lastKnownLocation.batteryLevel,
          time: Date.now()
        }
      }));

      alert(`[CRITICAL DISCONNECT]\n\n${name} went offline.`);
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
      setRawTelemetryData(data);
      setShowTelemetryModal(true); // Pop the Commander's Dashboard
    });
    return () => socket.off('telemetry-sync-complete');
  }, []);
  // --- 💀 ADDITION: MUTINY LISTENER ---
  useEffect(() => {
    socket.on('exiled', ({ reason } = {}) => {
      // 1. Sound the alarm
      alert(reason === 'blocked'
        ? "🚫 [SYS_BANNED] The Squad Commander has blocked you from this channel."
        : "💀 [SYS_MUTINY] You have been democratically exiled from the squad by majority vote.");

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
      setUsers(() => {
        const formattedUsers = [];
        Object.entries(activeUsers).forEach(([id, data]) => {
          // Skip self, wrong room, and GHOST nodes (server still sends them so others
          // can see their last position, but we hide them from our own map/list)
          if (id === socket.id) return;
          if (data.roomCode !== squadCode) return;
          if (data.status === 'GHOST') return;
          if (!data.lat || !data.lng) return;

          // Run Kalman smoothing on every incoming coordinate
          if (!squadPrecognition.current[id]) {
            squadPrecognition.current[id] = new PrecognitionFilter();
          }
          const smoothed = squadPrecognition.current[id].filter(data.lat, data.lng);

          formattedUsers.push({
            id,
            name: data.name || 'Squad Node',
            photo: data.photo,
            role: data.role || 'Campus Node',
            lat: smoothed.lat,
            lng: smoothed.lng,
            speed: data.speed || 0,
            heading: data.heading || 0,
            battery: data.battery || 0,
            status: data.status || 'ACTIVE',
            permission: 'accepted',
          });
        });
        return formattedUsers;
      });
    });

    socket.on('receive-ping', ({ senderName }) => {
      // 1. Play the sonar audio
      playSonarPing();

      // 2. Fire the native OS push notification
      triggerSystemNotification(
        "🚨 CRITICAL SOS BEACON",
        `Node '${senderName.toUpperCase()}' requires immediate assistance at their coordinates!`
      );

      // 3. Keep the in-app alert as a fallback
      alert(`🚨 SOS BEACON DETECTED 🚨\n\n${senderName.toUpperCase()} requires immediate assistance!`);
    });
    socket.on('new-custom-route', ({ key, data }) => {
      setLiveSecretRoutes(prev => ({ ...prev, [key]: data }));
    });

    return () => {
      socket.off('users-update');
      socket.off('receive-ping');
      socket.off('new-custom-route');
      socket.off('new-waypoint');
      socket.off('remove-waypoint');
      setUsers([]);
    };
  }, [hasJoinedSquad, squadCode]);

  // --- GATEKEEPER PROTOCOL LISTENERS ---
  // --- GATEKEEPER PROTOCOL LISTENERS (FIXED & RECONNECT SAFE) ---
  useEffect(() => {
    socket.on('access-granted', ({ role }) => {
      setAccessStatus('granted');
      setSquadRole(role);
    });

    socket.on('access-pending', () => setAccessStatus('pending'));

    socket.on('access-denied', () => {
      setAccessStatus('denied');
      setHasJoinedSquad(false);
      alert("[SYS_REJECTED] The Squad Commander denied your entry.");
    });

    socket.on('access-request', (requestData) => {
      setPendingRequests(prev => [...prev, requestData]);
    });

    socket.on('promoted-to-owner', () => setSquadRole('OWNER'));

    const onConnect = () => {
      console.log("[SYS_SOCKET] Reconnected to network mainframe.");
      if (hasJoinedSquad && squadCode && user) {
        socket.emit('request-join', {
          roomCode: squadCode,
          user: { name: user.displayName, photo: user.photoURL, uid: user.uid }
        });
      }
    };

    socket.on('connect', onConnect);

    return () => {
      socket.off('access-granted');
      socket.off('access-pending');
      socket.off('access-denied');
      socket.off('access-request');
      socket.off('promoted-to-owner');
      socket.off('connect', onConnect);
    };
  }, [hasJoinedSquad, squadCode, user]);

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

        socket.emit('update-location', {
          name: user.displayName, photo: user.photoURL,
          lat: smoothed.lat, lng: smoothed.lng,
          speed: 0, battery: 100,
          status: telemetryModeRef.current,
          roomCode: squadCode,
          heading: headingRef.current,
        });
      },
      (err) => console.log('[SYS] Initial GPS lock delayed:', err.message),
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
          lat: currentLoc.lat, lng: currentLoc.lng,
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
          lat: smoothed.lat, lng: smoothed.lng,
          speed: speed ? Math.round(speed * 3.6) : 0,
          battery: batteryLevel,
          status: telemetryModeRef.current,
          roomCode: squadCode,
          heading: headingRef.current,
        });
      },
      (error) => console.error('🚨 [SYS_ERROR] Geolocation lost:', error.message),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: currentPollingRate } // <-- AND WIRED HERE
    );

    return () => {
      clearInterval(heartbeatInterval);
      navigator.geolocation.clearWatch(watchId);
    };
    // headingRef is a ref (stable identity, never triggers a re-run) — listed only
    // to satisfy exhaustive-deps now that it comes from useDeviceHeading rather
    // than a local useRef the lint rule can recognise on its own.
  }, [user, hasJoinedSquad, squadCode, accessStatus, sysConfig.polling, headingRef]); // <-- CRITICAL: ADDED TO DEPENDENCIES
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
      lat: currentLoc.lat, lng: currentLoc.lng,
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

  const [mapProps, setMapProps] = useState({ center: SRM_KTR_COORDS, zoom: 17 });
  const mapRef = useRef(null);

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
          alert("[SYS_ERROR] ID AND KEY ARE REQUIRED FOR LINK.");
          setLoginMethod(null);
          return;
        }

        if (isRegistering) {
          // 1. Enforce Username Requirement
          if (!username.trim()) {
            alert("[SYS_ERROR] CODENAME REQUIRED FOR NEW RECRUITS.");
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
      alert(errorMessage);
      setLoginMethod(null);
    }
  };

  // --- 🚨 KILL SWITCH LOGOUT HANDLER ---
  const handleLogout = () => {
    socket.emit('leave-squad');
    setHasJoinedSquad(false);
    setSquadCode('');
    setUsers([]);
    setLiveLocation(null);
    signOut(auth);
    setOfflineNodes({});
  };

  const handleLeaveSquad = () => {
    socket.emit('leave-squad');
    setHasJoinedSquad(false);
    setSquadCode('');
    setUsers([]);
    setOfflineNodes({});
  };

  // --- TACTICAL DISTANCE ENGINE (HAVERSINE FORMULA) ---
  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    if (!lat1 || !lon1 || !lat2 || !lon2) return '[ SIGNAL_LOST ]';

    const R = 6371e3;
    const rad = Math.PI / 180;
    const phi1 = lat1 * rad;
    const phi2 = lat2 * rad;
    const deltaPhi = (lat2 - lat1) * rad;
    const deltaLambda = (lon2 - lon1) * rad;

    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
      Math.cos(phi1) * Math.cos(phi2) *
      Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;

    if (distance > 1000) {
      return `[ ${(distance / 1000).toFixed(2)} KM ]`;
    }
    return `[ ${Math.floor(distance)} M ]`;
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

  // --- SOS TRANSMITTER ---
  const fireSOSBeacon = (targetNodeId, targetNodeName) => {
    const myName = auth.currentUser?.displayName || "A Squad Member";

    socket.emit('ping-user', {
      targetId: targetNodeId,
      senderName: myName
    });

    alert(`[SYSTEM] SOS Signal transmitted directly to node: ${targetNodeName}.`);
  };

  const requestPermission = (userId) => {
    if (blockedUserIds.includes(userId)) return;
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, permission: 'requested' } : u));
  };

  const toggleBlock = (userId) => {
    setBlockedUserIds(prev => {
      if (prev.includes(userId)) return prev.filter(id => id !== userId);
      // Tell the server too — this actually removes them from the squad and bans
      // their account from rejoining, not just hiding them on this screen.
      if (squadRole === 'OWNER') {
        socket.emit('block-user', { roomCode: squadCode, targetId: userId });
      }
      setUsers(uPrev => uPrev.map(u => u.id === userId ? { ...u, permission: 'none' } : u));
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

    // 1. COMMANDER RALLY POINT OVERRIDE (Admin sidebar button)
    if (isAdmin && isDroppingWaypoint) {
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
  const handleWaypointSelect = (targetCoords) => {
    if (!routeStart) {
      if (liveLocation) {
        setRouteStart({ name: "MY_LOCATION", ...liveLocation });
        setRouteEnd(targetCoords);
        calculateActualRoute({ name: "MY_LOCATION", ...liveLocation }, targetCoords);
      } else {
        setRouteStart(targetCoords);
      }
      setSelectedItem(null);
    } else if (!routeEnd && targetCoords.id !== routeStart.id) {
      setRouteEnd(targetCoords);
      setSelectedItem(null);
      calculateActualRoute(routeStart, targetCoords);
    }
  };

  // --- WAYPOINT DISTANCE ENGINE ---
  // Deliberately draws no line/route on the map — the destination building is
  // shown as a highlighted real footprint (buildingPolygonsRef) instead. This
  // also means it no longer depends on Google's Directions API/DirectionsRenderer,
  // so it works identically on the Google engine and the Leaflet fallback.
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

  const clearRoute = () => {
    setRouteStart(null);
    setRouteEnd(null);
    setRouteData(null);
  };


  // --- REAL BUILDING FOOTPRINTS (Google engine) — actual traced building
  // shapes instead of abstract circle pins. Recreated whenever the map
  // becomes ready or the buildings tab toggles visibility. ---
  useEffect(() => {
    if (!isMapReady || !mapRef.current || !window.google) return;
    const maps = window.google.maps;
    const polygons = {};
    SRM_MASTER_DATABASE.forEach(b => {
      if (!b.footprint) return;
      const polygon = new maps.Polygon({
        paths: b.footprint.map(([lat, lng]) => ({ lat, lng })),
        ...BUILDING_FOOTPRINT_STYLE,
        map: activeTab === 'buildings' ? mapRef.current : null,
        clickable: true,
      });
      polygon.addListener('click', () => handleFocus({ lat: b.lat, lng: b.lng }, b));
      polygons[b.id] = polygon;
    });
    buildingPolygonsRef.current = polygons;
    return () => {
      Object.values(polygons).forEach(p => p.setMap(null));
    };
  }, [isMapReady, activeTab]);

  // Highlight whichever building footprint is selected or is the active waypoint destination
  useEffect(() => {
    const highlightId = (activeTab === 'buildings' && selectedItem?.id) || routeEnd?.id || null;
    Object.entries(buildingPolygonsRef.current).forEach(([id, polygon]) => {
      polygon.setOptions(Number(id) === highlightId ? BUILDING_FOOTPRINT_HIGHLIGHT_STYLE : BUILDING_FOOTPRINT_STYLE);
    });
  }, [selectedItem, routeEnd, activeTab]);

  const blockedUsers = users.filter(u => blockedUserIds.includes(u.id));

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

  if (authLoading) return <div className="h-screen bg-black text-white flex justify-center items-center font-dot">INITIALIZING_SECURE_LINK...</div>;

  if (!user) {
    if (!hasSeenGuide) {
      return <LocusGuide onInitialize={() => setHasSeenGuide(true)} />;
    }
    return (
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
    );
  }

  if (user && !hasJoinedSquad) {
    return (
      <div className="h-screen w-full bg-black flex flex-col items-center justify-center text-white p-6 bg-dots">
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
              }}
              className={`flex-1 py-3 transition-colors ${squadMode === 'create' ? 'bg-white text-black font-bold' : 'text-zinc-500 hover:text-white'}`}
            >
              CREATE SQUAD
            </button>
            <button
              onClick={() => {
                setSquadMode('join');
                setSquadCode('');
              }}
              className={`flex-1 py-3 transition-colors border-l border-white/20 ${squadMode === 'join' ? 'bg-white text-black font-bold' : 'text-zinc-500 hover:text-white'}`}
            >
              JOIN SQUAD
            </button>
          </div>

          {squadMode === 'create' ? (
            <div className="space-y-6">
              <div className="p-4 border border-red-500/40 bg-red-500/5 relative">
                <p className="text-[10px] font-dot text-zinc-400 uppercase tracking-widest mb-2">GENERATED SQUAD DESIGNATOR</p>
                <div className="flex items-center justify-center gap-3">
                  <span className="font-dot text-2xl text-red-500 tracking-[0.25em] font-bold">
                    {squadCode || 'GENERATING...'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSquadCode(generateRandomSquadCode())}
                    className="p-2 border border-red-500/30 text-red-400 hover:bg-red-500 hover:text-white transition-colors"
                    title="Generate New Code"
                  >
                    <RefreshCw size={16} />
                  </button>
                </div>
                <p className="text-[9px] font-dot text-zinc-500 uppercase tracking-widest mt-2">
                  Share this code with your team to grant entry clearance.
                </p>
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
                <label className="text-[10px] font-dot text-zinc-400 uppercase tracking-widest">ENTER SQUAD CODE (ALPHANUMERIC ONLY)</label>
                <input
                  type="text"
                  placeholder="E.G. KTR7X9"
                  className="w-full bg-black border border-white/30 py-4 text-center font-dot text-lg uppercase tracking-[0.2em] focus:outline-none focus:border-red-500 text-white transition-colors placeholder:text-zinc-700"
                  value={squadCode}
                  onChange={(e) => setSquadCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                  maxLength={8}
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
            className="absolute top-24 left-1/2 -translate-x-1/2 z-[1000] w-[90%] max-w-md bg-black border border-red-500 pointer-events-auto shadow-[0_0_30px_rgba(239,68,68,0.2)]"
          >
            <div className="p-4 flex flex-col gap-2 relative">
              <button onClick={clearRoute} className="absolute top-2 right-2 text-zinc-500 hover:text-white">
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

                {routeData && (
                  <div className="text-right flex flex-col">
                    <span className="text-2xl font-dot text-red-500 leading-none">{routeData.distance.text}</span>
                    <span className="text-[10px] font-dot text-zinc-400 uppercase tracking-widest">ETA: {routeData.duration.text}</span>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sidebar Panel — visible on desktop always, on mobile when mobileView is 'matrix' or 'squad' */}
      <motion.div
        initial={false}
        animate={{
          y: window.innerWidth < 768 ? ((mobileView === 'matrix' || mobileView === 'squad') ? 0 : '100%') : 0,
          x: 0,
          opacity: 1
        }}
        transition={{ type: "spring", damping: 25, stiffness: 200 }}
        className={`${
          window.innerWidth < 768 
            ? 'fixed inset-x-0 top-0 bottom-16 z-[900] flex flex-col bg-black/95 backdrop-blur-lg pointer-events-auto border-b border-red-900/50'
            : 'hidden md:flex w-80 bg-black border-r border-red-900/50 fixed z-[900] flex-col pointer-events-auto top-20 left-6 bottom-6 h-auto'
        }`}
        onTouchStart={(e) => { e.currentTarget._touchStartX = e.touches[0].clientX; }}
        onTouchEnd={(e) => {
          const startX = e.currentTarget._touchStartX;
          const endX = e.changedTouches[0].clientX;
          const diff = startX - endX;
          if (diff > 60) {
            // Swiped LEFT → go to Squad
            setActiveTab('users'); setSelectedItem(null);
            if (window.innerWidth < 768) setMobileView('squad');
          } else if (diff < -60) {
            // Swiped RIGHT → go to Matrix
            setActiveTab('buildings'); setSelectedItem(null);
            if (window.innerWidth < 768) setMobileView('matrix');
          }
        }}
      >
        {/* Mobile drag-down handle */}
        <div className="md:hidden w-12 h-1.5 bg-white/30 rounded-full mx-auto mt-4 mb-2 shrink-0" onClick={() => setMobileView('grid')} />

        {/* Gesture Dot Indicators (mobile) + Desktop Tabs */}
        <div className="md:hidden flex items-center justify-center gap-3 py-3">
          <div className={`w-2 h-2 rounded-full transition-all duration-300 ${activeTab === 'buildings' ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)] scale-125' : 'bg-zinc-700'}`} />
          <span className="font-dot text-[9px] text-zinc-500 uppercase tracking-widest">{activeTab === 'buildings' ? 'MATRIX' : 'SQUAD'}</span>
          <div className={`w-2 h-2 rounded-full transition-all duration-300 ${activeTab === 'users' ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)] scale-125' : 'bg-zinc-700'}`} />
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
              <button
                onClick={() => socket.emit('request-telemetry', squadCode)}
                className="w-full px-4 py-3 border border-yellow-500 text-sm font-dot uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-yellow-500 hover:text-black transition-colors text-yellow-500 shadow-[0_0_15px_rgba(234,179,8,0.2)]"
              >
                <Activity size={18} /> SYNC_TELEMETRY
              </button>

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
        <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar bg-black">
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
              users.filter(u => !blockedUserIds.includes(u.id)).map(user => (
                <motion.div
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  key={user.id}
                  className="p-4 mb-2 bg-gray-900 border border-gray-800 rounded-lg active:bg-gray-800 transition-colors relative group hover:border-white/40"
                >
                  <div className="absolute top-0 right-0 w-2 h-2 bg-white/20" />

                  {/* ROW 1: HEADER & ICONS */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 flex items-center justify-center font-dot text-sm border overflow-hidden shrink-0 ${user.permission === 'accepted' ? 'border-emerald-500 text-emerald-500 bg-emerald-500/10' : 'border-white/20 text-zinc-500'}`}>
                        {user.photo ? <img src={user.photo} className="w-full h-full object-cover" alt="" /> : user.name.charAt(0)}
                      </div>
                      <div className="flex flex-col">
                        <h4 className="font-dot text-sm uppercase tracking-widest text-white leading-none mb-1">{user.name}</h4>
                        <div className="text-[10px] font-dot text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                          <span>[{user.role}]</span>
                          {liveLocation && (
                            <span className="text-emerald-400">
                              {calculateDistance(liveLocation.lat, liveLocation.lng, user.lat, user.lng)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2 items-center">
                      <button onClick={() => sendPing(user.id)} className="text-emerald-400 hover:text-white transition-colors p-1" title="Ping User">
                        <Radio size={16} className="animate-pulse" />
                      </button>
                      {user.permission === 'accepted' ? <UserCheck size={16} className="text-zinc-500" /> : <Lock size={16} className="text-zinc-700" />}
                      {squadRole === 'OWNER' && (
                        <button onClick={() => toggleBlock(user.id)} className="text-zinc-600 hover:text-red-500 transition-colors p-1" title="Instant Ban">
                          <Ban size={16} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* ROW 2: TELEMETRY GRID */}
                  <div className="grid grid-cols-2 gap-2 mb-4">
                    <div className="bg-white/5 border border-white/10 p-2 flex items-center gap-2">
                      <div className="w-1.5 h-3 border border-zinc-500 rounded-[1px] relative flex items-end overflow-hidden">
                        <div className={`w-full ${user.battery < 25 ? 'bg-red-500' : 'bg-emerald-500'} transition-all duration-500`} style={{ height: `${user.battery}%` }} />
                      </div>
                      <span className="text-[10px] font-dot text-zinc-400 uppercase tracking-widest">{user.battery || 0}% PWR</span>
                    </div>
                    <div className="bg-white/5 border border-white/10 p-2 flex items-center gap-2">
                      <Activity size={12} className="text-blue-400" />
                      <span className="text-[10px] font-dot text-zinc-400 uppercase tracking-widest">{user.speed || 0} KM/H</span>
                    </div>
                  </div>

                  {/* ROW 3: ACTIONS */}
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={() => fireSOSBeacon(user.id, user.name)}
                      className="w-full py-2 bg-red-950/30 border border-red-900 text-red-500 font-dot text-[10px] uppercase tracking-widest hover:bg-red-500 hover:text-white transition-all"
                    >
                      FIRE_SOS_BEACON
                    </button>
                    {user.permission === 'accepted' ? (
                      <div className="flex gap-2 w-full">
                        <button
                          onClick={(e) => { e.stopPropagation(); setArTarget({ lat: user.lat, lng: user.lng, name: user.name }); }}
                          className="w-12 flex-shrink-0 py-3 flex items-center justify-center border border-white/30 hover:border-red-500 hover:text-red-500 transition-colors text-white bg-black"
                          title="AR Tracking"
                        >
                          <Crosshair size={14} />
                        </button>
                        <button onClick={() => handleFocus({ lat: user.lat, lng: user.lng }, null)} className="w-full py-3 border border-white/30 hover:border-white hover:bg-white hover:text-black font-dot text-xs uppercase tracking-widest transition-colors text-white">
                          TRACK_TARGET
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => requestPermission(user.id)} className="w-full py-3 bg-white text-black hover:bg-zinc-200 font-dot text-xs uppercase tracking-widest transition-colors">
                        REQUEST_LINK
                      </button>
                    )}
                  </div>
                </motion.div>
              ))
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
      <div className="absolute top-24 right-6 z-[1000] flex flex-col gap-2 w-72 pointer-events-none">
        <AnimatePresence>
          {zoneAlerts.map(alert => (
            <motion.div
              key={alert.id}
              initial={{ opacity: 0, x: 50, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 50, scale: 0.9 }}
              className={`p-3 border backdrop-blur-md flex flex-col gap-1 pointer-events-auto shadow-[0_0_15px_rgba(0,0,0,0.5)] ${alert.type === 'ENTER'
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
              onMapClick={handleMapClick}
              onFocus={handleFocus}
              liveLocation={liveLocation}
              heading={heading}
              liveSpeed={liveSpeed}
              users={users}
              blockedUserIds={blockedUserIds}
              offlineNodes={offlineNodes}
              activeTab={activeTab}
              activeWaypoint={activeWaypoint}
              squadRole={squadRole}
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

          yesIWantToUseGoogleMapApiInternals
          onGoogleApiLoaded={({ map }) => {
            mapRef.current = map;
            map.setTilt(0);
            // 🟢 GREEN LIGHT: Map canvas is live — safe to draw saved zones now
            setIsMapReady(true);
          }}
        >
          {liveLocation && (
            <div
              key="live-user"
              lat={liveLocation.lat}
              lng={liveLocation.lng}
              onClick={() => handleFocus(liveLocation, null)}
              style={{ cursor: 'pointer' }}
            >
              <LocationMarker
                heading={heading}
                status={deriveMarkerStatus(liveSpeed)}
                color="#10B981"
              />
            </div>
          )}
          {/* Buildings with a verified OSM outline are drawn as real traced footprints
              via buildingPolygonsRef (imperative google.maps.Polygon). The rest have no
              trustworthy outline in OSM, so they fall back to a pin here — without this
              they rendered as nothing at all on the Google engine and were untappable.
              The Leaflet engine already does the same (TacticalLeafletMap.jsx). */}
          {activeTab === 'buildings' && SRM_MASTER_DATABASE.filter(b => !b.footprint).map(b => (
            <div
              key={`building-${b.id}`}
              lat={b.lat}
              lng={b.lng}
              onClick={() => handleFocus({ lat: b.lat, lng: b.lng }, b)}
              style={{ cursor: 'pointer' }}
            >
              <BuildingMarker />
            </div>
          ))}
          {activeWaypoint && (
            <WaypointMarker
              lat={activeWaypoint.lat}
              lng={activeWaypoint.lng}
              name={activeWaypoint.name}
              onClick={() => handleFocus(activeWaypoint, null)}
              canClear={squadRole === 'OWNER'}
              onClear={() => socket.emit('clear-waypoint', squadCode)}
              onTrack={() => setArTarget({ lat: activeWaypoint.lat, lng: activeWaypoint.lng, name: activeWaypoint.name })}
            />
          )}
          {/* Filter out: blocked, ghost, and users with no coordinates yet */}
          {activeTab === 'users' && users.filter(u => u.permission === 'accepted' && !blockedUserIds.includes(u.id) && u.status !== 'GHOST' && u.lat && u.lng).map(u => (
            <div
              key={u.id}
              lat={u.lat}
              lng={u.lng}
              onClick={() => handleFocus({ lat: u.lat, lng: u.lng }, null)}
              style={{ cursor: 'pointer' }}
            >
              <LocationMarker
                heading={u.heading}
                status={deriveMarkerStatus(u.speed / 3.6)}
                color="#EF4444"
              />
            </div>
          ))}

          {/* FIX 3: ghost markers always render — removed activeTab gate so they show on any tab */}
          {Object.values(offlineNodes).map(ghost => (
            <div
              key={`ghost-${ghost.id}`}
              lat={ghost.lat}
              lng={ghost.lng}
              onClick={() => handleFocus({ lat: ghost.lat, lng: ghost.lng }, { name: `LOST: ${ghost.name}`, info: `Last seen with ${ghost.battery} battery.` })}
              style={{ cursor: 'pointer' }}
            >
              <LocationMarker status="signal-lost" color="#A1A1AA" />
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
                    alert(`[SYS] Route ${startName} -> ${endName} published successfully.`);
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
      {/* Right-side Action Column */}
      <div className="absolute right-4 top-1/3 flex flex-col gap-3 z-40 pointer-events-auto">

        <button
          onClick={() => handleFocus(SRM_KTR_COORDS, null)}
          className="bg-black/80 border border-gray-700 p-3 rounded text-white shadow-lg transition-colors hover:bg-gray-900" 
          title="Recenter Campus"
        >
          <MapPin size={20} />
        </button>

        {liveLocation && (
          <button
            onClick={() => handleFocus(liveLocation, null)}
            className="bg-black/80 border border-red-900 p-3 rounded text-red-500 shadow-[0_0_10px_rgba(220,38,38,0.5)] transition-colors hover:bg-red-900/50"
            title="Locate Signal"
          >
            <LocateFixed size={20} className="animate-pulse" />
          </button>
        )}

        {/* Satellite Recon Toggle Button */}
        <button
          onClick={() => setIsSatellite(!isSatellite)}
          className={`p-3 rounded border transition-colors shadow-lg ${isSatellite ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.4)]' : 'bg-black/80 text-white border-gray-700 hover:bg-gray-900'}`}
          title={isSatellite ? "Switch to Tactical Grid" : "Switch to Satellite Recon"}
        >
          <Globe size={20} />
        </button>

        {/* Gear icon opens SYS_CONFIG modal */}
        <button
          onClick={() => setShowSettingsModal(true)}
          className="bg-black/80 border border-gray-700 p-3 rounded text-white shadow-lg transition-colors hover:bg-gray-900"
          title="System Configuration (SYS_CONFIG)"
        >
          <Settings size={20} />
        </button>
      </div>

      {/* Selected Location Card */}
      <AnimatePresence>
        {selectedItem && activeTab === 'buildings' && (
          <motion.div
            initial={{ opacity: 0, x: 60 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 60 }}
            transition={{ duration: 0.4 }}
            className="absolute inset-x-4 bottom-24 md:inset-x-auto md:bottom-6 md:right-6 z-[600] md:w-80 max-h-[60vh] md:max-h-none overflow-y-auto bg-black border border-white/20 pointer-events-auto flex flex-col pt-6 pb-2"
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
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/90 backdrop-blur-md z-[2000] flex items-center justify-center p-4 pointer-events-auto"
          >
            <motion.div
              initial={{ scale: 0.95, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.95, y: 20, opacity: 0 }}
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
                              socket.emit('resolve-access', { targetId: node.targetId, roomCode: squadCode, approved: true });
                              setPendingRequests(prev => prev.filter(p => p.targetId !== node.targetId));
                            }}
                            className="flex-1 bg-white/10 text-emerald-400 border border-emerald-500/50 hover:bg-emerald-500/20 hover:border-emerald-400 py-3 font-dot text-xs uppercase tracking-widest transition-all shadow-[0_0_10px_rgba(16,185,129,0.1)] hover:shadow-[0_0_15px_rgba(16,185,129,0.3)]"
                          >
                            GRANT_ACCESS
                          </button>
                          <button
                            onClick={() => {
                              socket.emit('resolve-access', { targetId: node.targetId, roomCode: squadCode, approved: false });
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
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/95 backdrop-blur-md z-[4000] flex items-center justify-center p-4 pointer-events-auto bg-dots"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
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
                  {users.filter(u => u.permission === 'accepted').map(userNode => {
                    const cacheData = rawTelemetryData?.[userNode.id];
                    const freshness = getSignalFreshness(cacheData?.timestamp);
                    const batteryColor = cacheData && parseInt(cacheData.batteryLevel) < 20 ? 'text-red-500' : 'text-emerald-500';

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
                            {cacheData ? (
                              <>
                                LAT: {cacheData.latitude.toFixed(5)}<br />
                                LNG: {cacheData.longitude.toFixed(5)}
                              </>
                            ) : "NO_CACHE_DATA"}
                          </div>
                        </div>

                        {/* 3. BATTERY */}
                        <div className={`font-bold flex md:block justify-between items-center ${batteryColor}`}>
                          <span className="md:hidden text-zinc-600 font-normal text-[10px] font-dot uppercase tracking-widest">POWER:</span>
                          {cacheData ? cacheData.batteryLevel : "UNKNOWN"}
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
                <span className="font-dot text-[10px] text-zinc-600 uppercase tracking-widest">AUTO-REFRESHING EVERY 5 SECONDS</span>
                <button
                  onClick={() => socket.emit('request-telemetry', squadCode)}
                  className="px-6 py-2 border border-yellow-500 text-yellow-500 hover:bg-yellow-500 hover:text-black font-dot text-xs uppercase tracking-widest transition-colors flex items-center gap-2"
                >
                  <Activity size={14} /> FORCE_SYNC
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
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/95 backdrop-blur-md z-[5000] flex items-center justify-center p-4 pointer-events-auto bg-dots"
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }}
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
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/95 backdrop-blur-md z-[6000] flex items-center justify-center p-4 pointer-events-auto bg-dots"
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
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
                              alert(`[SYS] Route ${startName} → ${endName} published.`);
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

      {/* ========== MOBILE BOTTOM HUD — REPROGRAMMED ========== */}
      <div className="md:hidden fixed bottom-0 w-full bg-black/95 backdrop-blur-xl border-t border-red-600/30 flex justify-around items-center p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] z-[1100] pointer-events-auto">

        {/* GRID — Toggles Satellite vs Dark Map */}
        <button
          onClick={() => { setIsSatellite(!isSatellite); setMobileView('grid'); }}
          className={`flex flex-col items-center transition-all duration-200 ${mobileView === 'grid' && !isSatellite ? 'text-red-500 drop-shadow-[0_0_8px_rgba(239,68,68,0.8)]' : isSatellite ? 'text-emerald-500 drop-shadow-[0_0_8px_rgba(16,185,129,0.8)]' : 'text-zinc-600 hover:text-zinc-400'}`}
        >
          <Map className="w-5 h-5 mb-1" />
          <span className="text-[9px] tracking-widest font-dot uppercase">{isSatellite ? 'ORBITAL' : 'GRID'}</span>
          <div className={`w-1 h-1 rounded-full mt-1 animate-pulse ${isSatellite ? 'bg-emerald-500' : 'bg-red-500'}`} />
        </button>

        {/* SCAN — Opens AR Compass / Friend Finder */}
        <button
          onClick={() => {
            setMobileView('scan');
            // If we have a live location, open the AR scanner targeting the nearest squad member
            // If no squad members, scan toward campus center
            const scanTarget = (users && users.length > 0 && users[0])
              ? { lat: users[0].lat, lng: users[0].lng, name: users[0].name || 'SQUAD_NODE' }
              : { lat: SRM_KTR_COORDS.lat, lng: SRM_KTR_COORDS.lng, name: 'SRM_HQ' };
            setArTarget(scanTarget);
          }}
          className={`flex flex-col items-center transition-all duration-200 ${mobileView === 'scan' ? 'text-red-500 drop-shadow-[0_0_8px_rgba(239,68,68,0.8)] scale-110' : 'text-zinc-600 hover:text-zinc-400'}`}
        >
          <Scan className="w-5 h-5 mb-1" />
          <span className="text-[9px] tracking-widest font-dot uppercase">SCAN</span>
          {mobileView === 'scan' && <div className="w-1 h-1 rounded-full bg-red-500 mt-1 animate-pulse" />}
        </button>

        {/* SQUAD — Opens the Squad Room */}
        <button
          onClick={() => { setMobileView('squad'); setActiveTab('users'); setSelectedItem(null); }}
          className={`flex flex-col items-center transition-all duration-200 ${mobileView === 'squad' ? 'text-red-500 drop-shadow-[0_0_8px_rgba(239,68,68,0.8)] scale-110' : 'text-zinc-600 hover:text-zinc-400'}`}
        >
          <Users className="w-5 h-5 mb-1" />
          <span className="text-[9px] tracking-widest font-dot uppercase">SQUAD</span>
          {mobileView === 'squad' && <div className="w-1 h-1 rounded-full bg-red-500 mt-1 animate-pulse" />}
        </button>

      </div>

      {/* ========== TARGETING MODE BANNER ========== */}
      <AnimatePresence>
        {isTargetingMode && (
          <motion.div
            initial={{ y: -60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -60, opacity: 0 }}
            transition={{ type: 'spring', damping: 25 }}
            className="md:hidden fixed top-20 left-4 right-4 z-[1200] bg-yellow-500/10 border border-yellow-500/50 backdrop-blur-xl p-3 flex items-center gap-3 pointer-events-auto"
            style={{ marginTop: 'env(safe-area-inset-top)' }}
          >
            <Target size={18} className="text-yellow-500 animate-pulse flex-shrink-0" />
            <div>
              <p className="font-dot text-[10px] text-yellow-500 uppercase tracking-widest leading-tight">TARGETING MODE ACTIVE</p>
              <p className="font-dot text-[9px] text-yellow-500/60 uppercase tracking-widest">TAP ANYWHERE ON MAP TO DEPLOY RALLY POINT</p>
            </div>
            <button onClick={() => setIsTargetingMode(false)} className="ml-auto text-yellow-500 hover:text-white p-1 flex-shrink-0">
              <X size={16} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ========== RALLY POINT FAB (Two-Step Targeting) ========== */}
      {!(selectedItem && activeTab === 'buildings') && (
        <button
          onClick={() => setIsTargetingMode(!isTargetingMode)}
          className={`md:hidden fixed bottom-20 right-4 p-4 rounded-full z-[1050] pointer-events-auto active:scale-90 transition-all duration-300 ${
            isTargetingMode
              ? 'bg-yellow-500 text-black border-2 border-yellow-300 shadow-[0_0_25px_rgba(234,179,8,0.6)] animate-pulse'
              : 'bg-red-600 text-black border-2 border-red-400 shadow-[0_0_20px_rgba(220,38,38,0.6)]'
          }`}
          style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
          title={isTargetingMode ? 'Cancel Targeting' : 'Deploy Rally Point'}
        >
          {isTargetingMode ? <X className="w-6 h-6" /> : <Crosshair className="w-6 h-6" />}
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
    </div>
  );
};

export default App;