import { io } from "socket.io-client";
import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useScroll, useTransform, useSpring } from 'framer-motion';
import GoogleMapReact from 'google-map-react';
import { 
  MapPin, Users, Search, Settings, Navigation, ShieldCheck, 
  Building2, Sparkles, MessageSquare, Send, Loader2, 
  BrainCircuit, Lock, UserCheck, Ban, LogOut, LockKeyhole, Eye, EyeOff, ArrowRight, X,
  Wifi, Bluetooth, Radio, LocateFixed, OctagonAlert, Waypoints, Activity,
  Target, Sliders, Volume2, VolumeX, Map, Battery, Zap, Bell
} from 'lucide-react';
// ... your other imports (React, framer-motion, lucide-react, etc.)


// 👇 ADD THIS LINE RIGHT HERE
import LocusGuide from './LocusGuide';

// --- ADDED: FIREBASE AUTH ---
import { auth, googleProvider } from './firebase';
import { 
  signInWithPopup, 
  onAuthStateChanged, 
  signOut,
  signInWithEmailAndPassword,       // <-- Required for standard Login
  createUserWithEmailAndPassword,
  updateProfile    // <-- Required for new Registration
} from 'firebase/auth';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';

const socket = io(BACKEND_URL, {
  transports: ['websocket'],
  reconnection: true,
  reconnectionAttempts: 5
});

const SRM_KTR_COORDS = { lat: 12.8237, lng: 80.0444 };

const BUILDINGS = [
  { id: 1, name: "Tech Park", category: "Academic", lat: 12.825020924230433, lng: 80.0453233376537, info: "Home to CSE & IT departments. 15 floors of innovation.", tacticalIntel: "» FACT 01: Largest academic block on campus.\n» FACT 02: Houses the primary Apple Mac Lab and supercomputing facility.\n» FACT 03: Contains 15 floors of dedicated tech infrastructure." },
  { id: 2, name: "University Building (UB)", category: "Academic", lat: 12.824353553512712, lng: 80.04221892231276, info: "The administrative heart and main library block.", tacticalIntel: "» FACT 01: Houses the massive Central Library spanning multiple floors.\n» FACT 02: Directorate of Admissions and main admin offices are located here.\n» FACT 03: Serves as the architectural centerpiece of SRM KTR." },
  { id: 3, name: "T.P. Ganesan Auditorium", category: "Event", lat: 12.824880056150072, lng: 80.04668508123501, info: "One of Asia's largest auditoriums, near the main gate.", tacticalIntel: "» FACT 01: Seating capacity exceeds 3,000 students.\n» FACT 02: Frequently hosts international tech conferences and hackathons.\n» FACT 03: Equipped with stadium-grade acoustics and VIP holding rooms." },
  { id: 4, name: "CRC Block", category: "Academic", lat: 12.820344661045802, lng: 80.03784856136284, info: "The heritage block housing Mechanical and Civil Engineering.", tacticalIntel: "» FACT 01: One of the oldest legacy structures on campus.\n» FACT 02: Contains heavy-machinery testing labs on the ground floor.\n» FACT 03: Known for its expansive open-air central courtyard." },
  { id: 5, name: "Hi-Tech Block", category: "Research", lat: 12.821075984327978, lng: 80.03893573761148, info: "Specialized labs for ECE and EEE students.", tacticalIntel: "» FACT 01: Home to advanced robotics and circuitry labs.\n» FACT 02: Features specialized RF (Radio Frequency) isolated rooms.\n» FACT 03: Connects directly to the main research grid." },
  { id: 6, name: "SRM Medical College", category: "Medical", lat: 12.821098258984547, lng: 80.0481636983677, info: "Multi-specialty hospital and medical research center.", tacticalIntel: "» FACT 01: Fully functional multi-specialty hospital serving the public.\n» FACT 02: Houses critical trauma centers and surgical wards.\n» FACT 03: Operates on an independent backup power grid." },
  { id: 7, name: "Java Green", category: "Food", lat: 12.823348807944917, lng: 80.04448904064235, info: "Popular outdoor student hangout and food court.", tacticalIntel: "» FACT 01: The highest-density social node during lunch hours.\n» FACT 02: Features multiple distinct vendor stalls and shaded seating.\n» FACT 03: Prime location for student club recruitment drives." },
  { id: 8, name: "Bio-Tech Block", category: "Academic", lat: 12.825007113379733, lng: 80.04414300737659, info: "Genetic engineering and biotechnology research facility.", tacticalIntel: "» FACT 01: Contains Level-2 Bio-Safety laboratories.\n» FACT 02: Features an advanced greenhouse and genetic testing wing.\n» FACT 03: Located adjacent to the core Tech Park network." }
];

const CustomMarker = ({ isUser, name, photo, onClick, isOffline }) => {
  // --- NEW: THE GHOST MARKER (LAST KNOWN LOCATION) ---
  if (isOffline) {
    return (
      <div
        onClick={onClick}
        // 👇 TACTICAL VISUAL OFFSET: Slides the UI 8px down and right, leaving the GPS data mathematically pure.
        style={{ transform: 'translate(8px, 8px)' }} 
        className="w-10 h-10 -ml-5 -mt-5 bg-zinc-900/90 backdrop-blur-md rounded-full border-2 border-zinc-600 border-dashed shadow-[0_0_15px_rgba(113,113,122,0.4)] flex items-center justify-center text-zinc-400 font-bold tracking-tighter cursor-pointer overflow-hidden relative z-[45]"
        title={`SIGNAL LOST: ${name}`}
      >
        {/* Flashing red distress indicator */}
        <div className="absolute top-0 right-0 w-2.5 h-2.5 bg-red-600 rounded-full animate-ping z-50" />
        <div className="absolute top-0 right-0 w-2.5 h-2.5 bg-red-500 rounded-full z-50" />

        {photo ? (
          <img src={photo} alt={name} className="w-full h-full object-cover opacity-40 grayscale mix-blend-luminosity" />
        ) : (
          <span className="text-[10px] uppercase font-dot text-zinc-500">LKL</span>
        )}
      </div>
    )
  }

  // --- EXISTING LIVE MARKERS ---
  if (isUser) {
    return (
      <div
        onClick={onClick}
        className="w-10 h-10 -ml-5 -mt-5 bg-gradient-to-br from-emerald-400/80 to-teal-500/80 backdrop-blur-md rounded-full border border-emerald-200/50 shadow-[0_0_15px_rgba(52,211,153,0.6)] flex items-center justify-center text-white font-bold tracking-tighter cursor-pointer overflow-hidden relative z-50"
      >
        {photo ? <img src={photo} alt={name} className="w-full h-full object-cover" /> : name?.charAt(0)}
      </div>
    )
  }
  return (
    <div
      onClick={onClick}
      className="w-10 h-10 -ml-5 -mt-5 bg-gradient-to-br from-indigo-500/80 to-purple-600/80 backdrop-blur-md rounded-full border border-white/20 shadow-[0_0_15px_rgba(99,102,241,0.6)] flex items-center justify-center text-white cursor-pointer z-40"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
        <circle cx="12" cy="10" r="3" />
      </svg>
    </div>
  )
}
// --- THE NEW AUTH TERMINAL (Replaces CinematicLanding) ---
const AuthTerminal = ({
  email, setEmail, password, setPassword, showPassword, setShowPassword, executeAuthDirective, loginMethod, username, setUsername, latency
}) => {
  const [isRegistering, setIsRegistering] = useState(false);

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

          <button
            type="submit"
            className={`w-full py-4 mt-4 font-dot uppercase tracking-widest border transition-all flex justify-center items-center gap-2 ${
              isRegistering 
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
  // --- SYS_CONFIG STATE ---
  const [showSettingsModal, setShowSettingsModal] = useState(false);
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
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const [buildingIntel, setBuildingIntel] = useState('');

  // --- ADDED: ROUTING STATE ---
  const [routeStart, setRouteStart] = useState(null);
  const [routeEnd, setRouteEnd] = useState(null);
  const [routeData, setRouteData] = useState(null);
  const directionsRendererRef = useRef(null);
  const customPolylineRef = useRef(null);

  // --- MODIFIED: FIREBASE AUTH STATE ---
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  // --- ADMIN PATH RECORDER STATE ---
  const ADMIN_EMAIL = "vithyakrish1402@gmail.com"; // 🚨 REPLACE WITH YOUR EXACT GOOGLE LOGIN EMAIL
  const isAdmin = user?.email === ADMIN_EMAIL;

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

  const [isEditMode, setIsEditMode] = useState(false);
  const [editableBuildings, setEditableBuildings] = useState(BUILDINGS);

  const [users, setUsers] = useState([]);
  const [liveLocation, setLiveLocation] = useState(null);
  const [telemetryMode, setTelemetryMode] = useState('ACTIVE');

  const [squadCode, setSquadCode] = useState('');
  const [hasJoinedSquad, setHasJoinedSquad] = useState(false);
  // --- SQUAD GATEKEEPER STATES ---
  const [accessStatus, setAccessStatus] = useState(null);
  const [squadRole, setSquadRole] = useState(null);
  const [pendingRequests, setPendingRequests] = useState([]);
  const liveLocationRef = useRef(null);
  const [heading, setHeading] = useState(0); // compass heading in degrees
  // Mirrors telemetryMode in a ref so setInterval and watchPosition callbacks
  // always read the current value — they close over the ref, not the stale state.
  const telemetryModeRef = useRef('ACTIVE');

  const handleJoinSquad = (e) => {
    // Prevent the page from refreshing if this is inside a form
    if (e && e.preventDefault) e.preventDefault();

    // Don't do anything if the input is empty
    if (!squadCode || !squadCode.trim()) return;

    // 1. Send the knock to the server FIRST
    socket.emit('request-join', {
      roomCode: squadCode,
      user: { name: user.displayName, photo: user.photoURL }
    });

    // 2. Trigger the waiting room UI
    setHasJoinedSquad(true);
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
      const { targetId, name, photo, lastKnownLocation, timeDelta, disconnectTime } = emergencyData;

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
    socket.on('exiled', () => {
      // 1. Sound the alarm
      alert("💀 [SYS_MUTINY] You have been democratically exiled from the squad by majority vote.");

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
      setUsers([]);
    };
  }, [hasJoinedSquad, squadCode]);

  // --- GATEKEEPER PROTOCOL LISTENERS ---
  // --- GATEKEEPER PROTOCOL LISTENERS (FIXED) ---
  useEffect(() => {
    socket.on('access-granted', ({ role }) => {
      setAccessStatus('granted'); // Correct: Use the set function
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

    return () => {
      socket.off('access-granted');
      socket.off('access-pending');
      socket.off('access-denied');
      socket.off('access-request');
      socket.off('promoted-to-owner');
    };
  }, []);

  // --- REPLACED ILLEGAL ASSIGNMENT ---
  // We calculate this derived data inside the component body, but we DON'T use '=' on the state itself.
  const activePendingRequests = pendingRequests;
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
          heading: heading || 0,
        });
      },
      (err) => console.log('[SYS] Initial GPS lock delayed...'),
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
      } catch (e) { }

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
          heading: 0 // You can enhance this by calculating heading from previous coordinates if needed
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

        let batteryLevel = 100;
        try {
          if ('getBattery' in navigator) {
            const battery = await navigator.getBattery();
            batteryLevel = Math.round(battery.level * 100);
          }
        } catch (e) { }

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
          heading: 0 // You can enhance this by calculating heading from previous coordinates if needed
        });
      },
      (error) => console.error('🚨 [SYS_ERROR] Geolocation lost:', error.message),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: currentPollingRate } // <-- AND WIRED HERE
    );

    return () => {
      clearInterval(heartbeatInterval);
      navigator.geolocation.clearWatch(watchId);
    };
  }, [user, hasJoinedSquad, squadCode, accessStatus, sysConfig.polling]); // <-- CRITICAL: ADDED TO DEPENDENCIES
  // --- ⚡ INSTANT MODE OVERRIDE ---
  // Fires the moment a telemetry button is clicked so the server gets the new
  // status immediately, without waiting for the next watchPosition tick.
  useEffect(() => {
    const currentLoc = liveLocationRef.current;
    if (!currentLoc || !user || !hasJoinedSquad) return;

    socket.emit('update-location', {
      name: user.displayName, photo: user.photoURL,
      lat: currentLoc.lat, lng: currentLoc.lng,
      speed: 0, battery: 100,
      status: telemetryMode, // use state here — this effect re-runs when it changes
      roomCode: squadCode,
      heading: 0, 
    });
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
    } catch (e) {
      console.log("Audio not supported.");
    }
  };

  // 3. Listen for incoming P2P Pings
  useEffect(() => {
    socket.on('receive-ping', ({ senderName }) => {
      playSonarPing();
      alert(`🚨 [INCOMING_SIGNAL] \n\nNode '${senderName}' is pinging your location!`);
    });

    return () => socket.off('receive-ping');
  }, []);

  useEffect(() => {
    clearRoute();
  }, [activeTab]);

  const [blockedUserIds, setBlockedUserIds] = useState([]);
  const [showRequestsModal, setShowRequestsModal] = useState(false);
  const [modalTab, setModalTab] = useState('requests');

  const [mapProps, setMapProps] = useState({ center: SRM_KTR_COORDS, zoom: 17 });
  const mapRef = useRef(null);

  const [aiLoading, setAiLoading] = useState(false);
  const [aiResponse, setAiResponse] = useState('');
  const [showAiModal, setShowAiModal] = useState(false);
  const [aiQuery, setAiQuery] = useState('');

  
  // Gemini API Utility
  const callGemini = async (prompt, systemInstruction = "You are a helpful campus assistant for SRM KTR.") => {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;

    const combinedPrompt = `${systemInstruction}\n\nUSER_QUERY: ${prompt}`;

    const payload = {
      contents: [{ parts: [{ text: combinedPrompt }] }]
    };

    let delay = 1000;
    for (let i = 0; i < 5; i++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const errorData = await response.json();
          console.error("🚨 [GEMINI ERROR]:", errorData);
          throw new Error('API Error');
        }

        const data = await response.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || "No response found.";
      } catch (err) {
        if (i === 4) throw err;
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2;
      }
    }
  };

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

  const handleGeneralAiQuery = async (e) => {
    e.preventDefault();
    if (!aiQuery.trim() || aiLoading) return;
    setAiLoading(true); setAiResponse('');

    try {
      // --- 🧠 SYS_ORACLE TACTICAL COMPRESSOR ---

      // 1. Squad Context: Compress active nodes and ghosts into dense strings
      const activeNodes = users.filter(u => u.permission === 'accepted' && u.status !== 'GHOST' && !blockedUserIds.includes(u.id));
      const ghostNodes = Object.values(offlineNodes);

      let squadStr = activeNodes.length > 0
        ? activeNodes.map(u => `[NODE:${u.name}|DIST:${calculateDistance(liveLocation?.lat, liveLocation?.lng, u.lat, u.lng)}|BAT:${u.battery}%|SPD:${u.speed}kmh]`).join('')
        : "NO_ACTIVE_NODES";

      if (ghostNodes.length > 0) {
        squadStr += ` | GHOSTS: ${ghostNodes.map(g => `[${g.name}(Lost Signal)]`).join('')}`;
      }

      // 2. Map Context: Calculate distance and ONLY send the 3 closest buildings to save tokens
      let mapStr = "UNKNOWN";
      if (liveLocation) {
        const nearbyBuildings = BUILDINGS.map(b => {
          const distStr = calculateDistance(liveLocation.lat, liveLocation.lng, b.lat, b.lng);
          const isKM = distStr.includes('KM');
          const num = parseFloat(distStr.replace(/[^0-9.]/g, ''));
          return { name: b.name, distStr, val: isKM ? num * 1000 : num };
        }).sort((a, b) => a.val - b.val).slice(0, 3); // Extract top 3

        mapStr = nearbyBuildings.map(b => `[${b.name}:${b.distStr}]`).join('');
      }

      // 3. The Injection: Feed the compressed data to Gemini
      const systemInstruction = `You are SYS_ORACLE, a tactical AI on the LOCUS network at SRM KTR. 
MY_STATUS: ${liveLocation ? 'ONLINE' : 'OFFLINE'}
SQUAD_TELEMETRY: ${squadStr}
NEAREST_BUILDINGS: ${mapStr}
DIRECTIVE: Answer the user's query utilizing the data above. Keep answers strictly under 3 sentences. Use a concise, military-comms tone. Provide spatial awareness when asked.`;

      const res = await callGemini(aiQuery, systemInstruction);
      setAiResponse(res);
    } catch (err) {
      setAiResponse("[SYS_FAILURE] Neural link to Oracle severed. Retrying connection...");
    } finally {
      setAiLoading(false); setAiQuery('');
    }
  };

  const requestPermission = (userId) => {
    if (blockedUserIds.includes(userId)) return;
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, permission: 'requested' } : u));
  };

  const simulateAccept = (userId) => {
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, permission: 'accepted' } : u));
  };

  const toggleBlock = (userId) => {
    setBlockedUserIds(prev => {
      if (prev.includes(userId)) return prev.filter(id => id !== userId);
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

    // 2. Standard Edit Mode Logic
    if (isEditMode && selectedItem && activeTab === 'buildings') {
      setEditableBuildings(prev => prev.map(b =>
        b.id === selectedItem.id ? { ...b, lat, lng } : b
      ));
      setSelectedItem(prev => ({ ...prev, lat, lng }));
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

  // --- 🚨 MODIFIED: HYBRID ENGINE (Checks Custom Routes First) ---
  const calculateActualRoute = (start, end) => {
    // BULLETPROOF SAFEGUARD
    if (typeof window === 'undefined' || !window.google || !window.google.maps) {
      console.error("🚨 [SYS_ERROR] Google Maps API is offline or blocked.");
      alert("[SYS_ERROR] TACTICAL ROUTING OFFLINE. (API BLOCKED)");
      return;
    }

    // 1. CHECK FOR SECRET SHORTCUT OVERRIDES FIRST
    const routeKey = `${start.name}_${end.name}`;
    const reverseRouteKey = `${end.name}_${start.name}`;
    const secretData = liveSecretRoutes[routeKey] || liveSecretRoutes[reverseRouteKey];

    // Only trigger secret route if going Building-to-Building (not from live GPS)
    if (secretData && start.name !== "MY_LOCATION") {
      console.log("🕵️‍♂️ [OVERRIDE] Secret route detected. Bypassing Google.");

      // Clear standard red line if it exists
      if (directionsRendererRef.current) directionsRendererRef.current.setDirections({ routes: [] });
      if (customPolylineRef.current) customPolylineRef.current.setMap(null);

      // Draw custom emerald green path
      const pathCoords = liveSecretRoutes[routeKey] ? secretData.path : [...secretData.path].reverse();
      customPolylineRef.current = new window.google.maps.Polyline({
        path: pathCoords,
        geodesic: true,
        strokeColor: '#10b981', // Emerald green
        strokeOpacity: 1.0,
        strokeWeight: 5,
        map: mapRef.current
      });

      setRouteData({
        distance: { text: secretData.distance },
        duration: { text: secretData.eta }
      });
      return; // Abort Google request completely
    }

    // 2. FALLBACK: STANDARD GOOGLE MAPS ROUTING
    const directionsService = new window.google.maps.DirectionsService();
    directionsService.route({
      origin: { lat: start.lat, lng: start.lng },
      destination: { lat: end.lat, lng: end.lng },
      travelMode: window.google.maps.TravelMode.WALKING
    }, (result, status) => {
      if (status === 'OK') {
        if (customPolylineRef.current) customPolylineRef.current.setMap(null); // Clear green line
        directionsRendererRef.current.setDirections(result);
        setRouteData(result.routes[0].legs[0]);
      } else {
        alert("[SYS_ERROR] UNAVAILABLE WALKING PATH.");
      }
    });
  };

  const clearRoute = () => {
    setRouteStart(null);
    setRouteEnd(null);
    setRouteData(null);
    if (directionsRendererRef.current) {
      directionsRendererRef.current.setDirections({ routes: [] });
    }
    if (customPolylineRef.current) {
      customPolylineRef.current.setMap(null);
      customPolylineRef.current = null;
    }
  };


  const blockedUsers = users.filter(u => blockedUserIds.includes(u.id));

  // --- TACTICAL MAP RENDERING ENGINE ---
  const createMapOptions = (theme) => {
    if (isSatellite) {
      return {
        zoomControl: false, mapTypeControl: false, fullscreenControl: false, streetViewControl: false,
        mapTypeId: 'hybrid', // This triggers the real satellite imagery
        styles: [] // Clear custom styles so the photos show up
      };
    }
    // Standard Cyberpunk Dark Theme
    const tacticalStyles = [
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
    const stealthStyles = [
      { elementType: "geometry", stylers: [{ color: "#000000" }] },
      { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
      { elementType: "labels.text.fill", stylers: [{ color: "#333333" }] },
      { elementType: "labels.text.stroke", stylers: [{ color: "#000000" }] },
      { featureType: "poi", stylers: [{ visibility: "off" }] },
      { featureType: "road", elementType: "geometry.fill", stylers: [{ color: "#0a0a0a" }] },
      { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#111111" }] },
      { featureType: "water", elementType: "geometry", stylers: [{ color: "#000000" }] }
    ];

    return {
      zoomControl: false, mapTypeControl: false, fullscreenControl: false, streetViewControl: false,
      mapTypeId: 'roadmap',
      styles: theme === 'stealth' ? stealthStyles : tacticalStyles
    };
  }

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
        <div className="w-full max-w-md p-12 border border-white/20 bg-black relative shadow-[0_0_100px_rgba(255,0,0,0.1)] text-center">
          <ShieldCheck size={48} className="text-red-500 mx-auto mb-6" />
          <h2 className="text-3xl font-dot uppercase tracking-widest mb-2">SECURE_CHANNEL</h2>
          <p className="text-zinc-500 font-dot text-[10px] uppercase mb-10 tracking-widest">Enter Squad Designation</p>

          <input
            type="text"
            placeholder="E.G. ALPHA_TEAM"
            className="w-full bg-black border border-white/30 py-4 text-center font-dot text-lg uppercase tracking-widest focus:outline-none focus:border-red-500 mb-8 text-white transition-colors"
            value={squadCode}
            onChange={(e) => setSquadCode(e.target.value.toUpperCase())}
            maxLength={12}
          />
          <button
            onClick={handleJoinSquad}
            className="w-full py-5 bg-white text-black font-dot uppercase tracking-[0.2em] text-xs hover:bg-red-500 hover:text-white transition-all"
          >
            JOIN SQUAD
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-full bg-black flex overflow-hidden text-white font-inter selection:bg-red-500/30 bg-dots">

      {/* Blocky Header Panel */}
      <motion.nav
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.5 }}
        className="absolute top-0 left-0 z-[1000] w-full px-6 py-4 bg-black border-b border-white/20 flex items-center justify-between pointer-events-auto"
      >
        <div className="flex items-center gap-4">
          <div className="p-2 border border-white text-white">
            <Navigation className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-dot tracking-widest uppercase text-xl">LOCUS</h1>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="hidden sm:flex items-center gap-3 px-4 py-2 border border-white/20 bg-black font-dot text-xs uppercase tracking-widest">
            {user.photoURL ? (
              <img src={user.photoURL} className="w-6 h-6 rounded-full border border-white/50" alt="profile" />
            ) : (
              <div className="w-2 h-2 bg-red-500"></div>
            )}
            {user.displayName || "GUEST_NODE"}
          </div>
          {/* --- NEW: SYS_CONFIG BUTTON --- */}
          <button 
            onClick={() => setShowSettingsModal(true)}
            className="p-2 border border-white/20 hover:bg-white hover:text-black transition-colors"
            title="System Configuration"
          >
             <Sliders size={18} />
          </button>
          <button
            onClick={handleLogout}
            className="p-2 border border-white/20 hover:bg-white hover:text-black transition-colors"
          >
            <LogOut size={18} />
          </button>
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="md:hidden p-2 border border-white/20 ml-2 hover:bg-white hover:text-black transition-colors"
          >
            {isMenuOpen ? <X size={20} /> : <Users size={20} />}
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

      {/* Sidebar Panel */}
      <motion.div
        initial={false}
        animate={{
          y: window.innerWidth < 768 ? (isMenuOpen ? 0 : '100%') : 0,
          x: window.innerWidth < 768 ? 0 : 0,
          opacity: 1
        }}
        transition={{ type: "spring", damping: 25, stiffness: 200 }}
        className={`
          fixed z-[900] bg-black border-white/20 flex flex-col pointer-events-auto
          md:top-20 md:left-6 md:bottom-6 md:w-96 md:border md:h-auto
          max-md:bottom-0 max-md:left-0 max-md:right-0 max-md:h-[70vh] max-md:w-full max-md:border-t-2 max-md:rounded-t-[32px]
        `}
      >
        <div className="md:hidden w-12 h-1.5 bg-white/30 rounded-full mx-auto mt-4 mb-2 shrink-0" onClick={() => setIsMenuOpen(false)} />

        {/* Tabs */}
        <div className="flex border-b border-white/20">
          <button
            onClick={() => { setActiveTab('buildings'); setSelectedItem(null); setIsEditMode(false); }}
            className={`flex-1 py-4 flex items-center justify-center gap-2 font-dot text-sm uppercase tracking-widest transition-colors ${activeTab === 'buildings' ? 'bg-white text-black' : 'text-zinc-500 hover:text-white hover:bg-white/5'
              }`}
          >
            <Building2 size={16} /> MATRIX
          </button>
          <button
            onClick={() => { setActiveTab('users'); setSelectedItem(null); setIsEditMode(false); }}
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
              editableBuildings.filter(b => b.name.toLowerCase().includes(searchQuery.toLowerCase())).map(building => (
                <motion.div
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  key={building.id}
                  className="p-4 border border-white/20 relative group hover:border-white/40 transition-colors bg-black cursor-pointer"
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
                  <button
                    onClick={(e) => { e.stopPropagation(); handleWaypointSelect(building); }}
                    className="w-full py-3 border border-white/30 hover:border-white hover:bg-white hover:text-black font-dot text-xs uppercase tracking-widest transition-colors text-white"
                  >
                    SELECT_WAYPOINT
                  </button>
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
                  className="p-4 border border-white/20 relative group hover:border-white/40 transition-colors bg-black"
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
                      <button onClick={() => handleFocus({ lat: user.lat, lng: user.lng }, null)} className="w-full py-3 border border-white/30 hover:border-white hover:bg-white hover:text-black font-dot text-xs uppercase tracking-widest transition-colors text-white">
                        TRACK_TARGET
                      </button>
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

          {activeTab === 'buildings' && (
            <motion.div layout className="mt-8 p-6 border border-white/20 relative overflow-hidden group">
              <div className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 border-white -translate-x-1 -translate-y-1" />
              <div className="absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 border-white translate-x-1 translate-y-1" />
              <div className="flex flex-col gap-4 relative z-10">
                <div className="flex items-center gap-2 text-white">
                  <Sparkles size={16} />
                  <h4 className="font-dot text-sm uppercase tracking-widest">SYS_ORACLE</h4>
                </div>
                <button
                  onClick={() => { setShowAiModal(true); setAiResponse(''); }}
                  className="w-full py-4 bg-white text-black hover:bg-zinc-300 font-dot text-xs uppercase tracking-widest transition-colors flex items-center justify-center gap-2"
                >
                  INITIATE_PROCEDURE <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
                </button>
              </div>
            </motion.div>
          )}
        </div>
      </motion.div>

        {/* --- 1. WAITING ROOM OVERLAY --- */}
        {hasJoinedSquad && accessStatus !== 'granted' && (
          <div className="absolute inset-0 z-[1000] bg-black/90 backdrop-blur-md flex flex-col items-center justify-center pointer-events-auto">
            <Loader2 className="animate-spin text-red-500 mb-6" size={40} />
            <h2 className="font-dot text-white text-2xl tracking-[0.3em] uppercase mb-2 text-center">
              {accessStatus === 'denied' ? 'ACCESS_DENIED' : 'AWAITING_CLEARANCE'}
            </h2>
            <p className="font-inter text-zinc-500 text-sm text-center max-w-xs px-6">
              {accessStatus === 'denied'
                ? 'Handshake rejected by Commander.'
                : 'Transmitting handshake to Squad Commander. Stand by...'}
            </p>
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
        {/* FULLSCREEN GOOGLE MAP */}
        <div className="absolute inset-0 z-0 bg-black">
          <GoogleMapReact
            bootstrapURLKeys={{ key: 'AIzaSyD10sWfHpczEuvmvwBkqkPHOu-QXQr8uM0' }}
            center={mapProps.center}
            options={{ ...createMapOptions(sysConfig.theme,isSatellite), draggableCursor: (isAdmin && isRecordingPath) ? 'crosshair' : (isEditMode && selectedItem ? 'crosshair' : 'grab') }}
          
            onClick={handleMapClick}
            
            zoom={mapProps.zoom}
            
            yesIWantToUseGoogleMapApiInternals
            onGoogleApiLoaded={({ map, maps }) => {
              mapRef.current = map;
              directionsRendererRef.current = new maps.DirectionsRenderer({
                suppressMarkers: true,
                polylineOptions: { strokeColor: '#ef4444', strokeWeight: 4 }
              });
              directionsRendererRef.current.setMap(map);
            }}
          >
            {liveLocation && (
              <CustomMarker
                key="live-user"
                lat={liveLocation.lat}
                lng={liveLocation.lng}
                isUser={true}
                name={user.displayName}
                photo={user.photoURL}
                onClick={() => handleFocus(liveLocation, null)}
              />
            )}
            {activeTab === 'buildings' && editableBuildings.map(b => (
              <CustomMarker
                key={b.id}
                lat={b.lat}
                lng={b.lng}
                isUser={false}
                onClick={() => handleFocus({ lat: b.lat, lng: b.lng }, b)}
              />
            ))}
            {/* ... other markers ... */}
            {/* Filter out: blocked, ghost, and users with no coordinates yet */}
            {activeTab === 'users' && users.filter(u => u.permission === 'accepted' && !blockedUserIds.includes(u.id) && u.status !== 'GHOST' && u.lat && u.lng).map(u => (
              <CustomMarker
                key={u.id}
                lat={u.lat}
                lng={u.lng}
                isUser={true}
                name={u.name}
                photo={u.photo}
                onClick={() => handleFocus({ lat: u.lat, lng: u.lng }, null)}
              />
            ))}

            {/* FIX 3: ghost markers always render — removed activeTab gate so they show on any tab */}
            {Object.values(offlineNodes).map(ghost => (
              <CustomMarker
                key={`ghost-${ghost.id}`}
                lat={ghost.lat}
                lng={ghost.lng}
                isUser={false}
                isOffline={true} // This triggers the grey dashed UI you already wrote
                name={ghost.name}
                photo={ghost.photo}
                onClick={() => handleFocus({ lat: ghost.lat, lng: ghost.lng }, { name: `LOST: ${ghost.name}`, info: `Last seen with ${ghost.battery} battery.` })}
              />
            ))}


            {/* ... Your existing users.filter map loop stays exactly the same below this ... */}
          </GoogleMapReact>
          <div className="absolute bottom-24 right-6 z-[500] pointer-events-auto">
            <button
              onClick={() => setIsSatellite(!isSatellite)}
              className="flex items-center gap-2 bg-black/80 backdrop-blur-md border border-white/20 px-4 py-2 font-dot text-[10px] tracking-widest uppercase transition-all hover:border-emerald-500 hover:text-emerald-500"
            >
              <div className={`w-2 h-2 rounded-full ${isSatellite ? 'bg-emerald-500 animate-pulse shadow-[0_0_8px_#10b981]' : 'bg-zinc-600'}`}></div>
              {isSatellite ? 'ORBITAL RECON' : 'TACTICAL GRID'}
            </button>
          </div>
        </div>

        {/* --- ADMIN OVERRIDE PANEL --- */}
        {isAdmin && (
          <div className="absolute top-24 right-6 z-[600] flex flex-col gap-2 pointer-events-auto">
            {!isRecordingPath ? (
              <button
                onClick={() => setIsRecordingPath(true)}
                className="p-3 bg-black border border-yellow-500 text-yellow-500 hover:bg-yellow-500 hover:text-black transition-colors font-dot text-[10px] uppercase tracking-widest shadow-[0_0_15px_rgba(234,179,8,0.3)]"
              >
                [ADMIN] RECORD_PATH
              </button>
            ) : (
              <div className="bg-black border border-yellow-500 p-4 flex flex-col gap-3 shadow-[0_0_20px_rgba(234,179,8,0.4)]">
                <div className="text-yellow-500 font-dot text-xs tracking-widest animate-pulse">RECORDING_NODES: {recordedCoords.length}</div>

                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      const startName = prompt("Enter START Building Name (e.g., Tech Park):");
                      const endName = prompt("Enter END Building Name (e.g., Java Green):");

                      if (startName && endName && recordedCoords.length > 1) {
                        const newRouteData = {
                          distance: "CUSTOM", eta: "TACTICAL",
                          path: recordedCoords
                        };

                        // Save to local state
                        setLiveSecretRoutes(prev => ({
                          ...prev,
                          [`${startName}_${endName}`]: newRouteData
                        }));

                        // Broadcast to backend
                        socket.emit('publish-custom-route', {
                          key: `${startName}_${endName}`,
                          data: newRouteData
                        });

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
            )}
          </div>
        )}

        {/* Map Interactive Layers */}
        <div className="absolute right-6 top-1/2 -translate-y-1/2 z-[500] flex flex-col gap-4 pointer-events-auto">

          <button onClick={() => handleFocus(SRM_KTR_COORDS, null)} className="p-4 bg-black border border-white/20 text-white hover:bg-white hover:text-black transition-colors group" title="Recenter Campus">
            <MapPin size={24} />
          </button>

          {liveLocation && (
            <button
              onClick={() => handleFocus(liveLocation, null)}
              className="p-4 bg-black border border-red-500 text-red-500 hover:bg-red-500 hover:text-white transition-colors group"
              title="Locate Signal"
            >
              <LocateFixed size={24} className="animate-pulse" />
            </button>
          )}

          {activeTab === 'buildings' && (
            <button
              onClick={() => setIsEditMode(!isEditMode)}
              className={`p-4 transition-colors border ${isEditMode ? 'bg-white text-black border-white' : 'bg-black text-white border-white/20 hover:bg-white hover:text-black'}`}
              title="Edit Pins Mode"
            >
              <Settings size={24} className={`${isEditMode ? 'animate-spin-slow' : ''}`} />
            </button>
          )}

          {isEditMode && selectedItem && (
            <div className="absolute top-1/2 -translate-y-1/2 right-[120%] whitespace-nowrap px-4 py-3 bg-red-500 text-white font-dot text-xs tracking-widest uppercase flex items-center gap-3">
              <span className="w-2 h-2 bg-white animate-pulse"></span>
              AWAITING_COORDS // {selectedItem.name}
            </div>
          )}
        </div>

        {/* Selected Location Card */}
        <AnimatePresence>
          {selectedItem && activeTab === 'buildings' && (
            <motion.div
              initial={{ opacity: 0, x: 60 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 60 }}
              transition={{ duration: 0.4 }}
              className="absolute bottom-6 right-6 z-[600] w-80 bg-black border border-white/20 pointer-events-auto flex flex-col pt-6 pb-2"
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
                      className={`flex-1 py-4 font-dot text-sm uppercase tracking-widest transition-all relative ${
                        modalTab === 'requests' ? 'text-red-500 bg-red-500/5' : 'text-zinc-500 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      INBOUND {pendingRequests.length > 0 && `[${pendingRequests.length}]`}
                      {modalTab === 'requests' && <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.8)]" />}
                    </button>
                    <button
                      onClick={() => setModalTab('blocked')}
                      className={`flex-1 py-4 border-l border-red-500/20 font-dot text-sm uppercase tracking-widest transition-all relative ${
                        modalTab === 'blocked' ? 'text-red-500 bg-red-500/5' : 'text-zinc-500 hover:text-white hover:bg-white/5'
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

          {/* --- AI ORACLE MODAL --- */}
          <AnimatePresence>
            {showAiModal && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/95 backdrop-blur-md z-[3000] flex items-center justify-center p-4 pointer-events-auto bg-dots"
              >
                <motion.div
                  initial={{ scale: 0.95, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.95, opacity: 0 }}
                  className="bg-black w-full max-w-3xl border-2 border-white flex flex-col h-[85vh] relative shadow-[0_0_50px_rgba(255,255,255,0.05)]"
                >
                  <div className="absolute top-0 left-0 w-4 h-4 bg-white" />
                  <div className="absolute top-0 right-0 w-4 h-4 bg-white" />
                  <div className="absolute bottom-0 left-0 w-4 h-4 bg-white" />
                  <div className="absolute bottom-0 right-0 w-4 h-4 bg-white" />

                  <div className="p-6 border-b-2 border-white flex justify-between items-center bg-black z-10">
                    <div className="flex items-center gap-4 text-white">
                      <BrainCircuit className="w-8 h-8" />
                      <h3 className="font-dot text-2xl tracking-widest uppercase">SYS_ORACLE // NEURAL_LINK</h3>
                    </div>
                    <button onClick={() => setShowAiModal(false)} className="p-2 border-2 border-transparent hover:border-white transition-colors text-white">
                      <X size={24} />
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto p-8 space-y-6 custom-scrollbar bg-black z-10 flex flex-col">
                    {aiResponse ? (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4 }}
                        className="p-8 border border-white/20 bg-black font-inter text-zinc-300 leading-relaxed text-lg"
                      >
                        {aiResponse}
                      </motion.div>
                    ) : (
                      <div className="flex-1 flex flex-col items-center justify-center text-zinc-600 gap-6 py-10">
                        <MessageSquare size={80} className="text-white/10" />
                        <p className="font-dot text-lg tracking-widest uppercase animate-pulse">AWAITING_QUERY_INPUT...</p>
                      </div>
                    )}

                    {aiLoading && (
                      <motion.div
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                        className="flex items-center gap-4 text-red-500 p-6 border border-red-500 bg-black mt-auto"
                      >
                        <Loader2 className="animate-spin" size={24} />
                        <span className="font-dot text-sm uppercase tracking-widest">PROCESSING_NEURAL_REQUEST...</span>
                      </motion.div>
                    )}
                  </div>

                  <form onSubmit={handleGeneralAiQuery} className="p-6 border-t-2 border-white bg-black z-10">
                    <div className="flex gap-4 relative">
                      <div className="absolute left-6 top-1/2 -translate-y-1/2 font-dot text-zinc-500">{">"}</div>
                      <input
                        type="text"
                        placeholder="ENTER_QUERY..."
                        className="flex-1 bg-black border border-white/30 focus:border-white pl-12 pr-6 py-5 text-sm font-dot uppercase tracking-widest focus:outline-none transition-colors text-white placeholder:text-zinc-600"
                        value={aiQuery}
                        onChange={(e) => setAiQuery(e.target.value)}
                      />
                      <button
                        type="submit"
                        disabled={aiLoading}
                        className="bg-white text-black hover:bg-zinc-200 px-8 flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-dot uppercase tracking-widest"
                      >
                        <Send size={20} className="mr-2" /> TRANSMIT
                      </button>
                    </div>
                  </form>
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

                {/* Setting 2: Map Theme */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 border-b border-white/10 pb-2">
                    <Map size={16} className="text-blue-400" />
                    <span className="font-dot text-xs uppercase tracking-widest text-zinc-400">GRID_OVERLAY_THEME</span>
                  </div>
                  <div className="flex gap-4">
                    <button onClick={() => toggleConfig('theme', 'tactical')} className={`flex-1 py-3 font-dot text-xs uppercase tracking-widest border transition-colors ${sysConfig.theme === 'tactical' ? 'bg-blue-500/20 text-blue-400 border-blue-500' : 'bg-black text-zinc-500 border-white/20 hover:border-white/50'}`}>TACTICAL (DARK)</button>
                    <button onClick={() => toggleConfig('theme', 'stealth')} className={`flex-1 py-3 font-dot text-xs uppercase tracking-widest border transition-colors ${sysConfig.theme === 'stealth' ? 'bg-white/10 text-white border-white' : 'bg-black text-zinc-500 border-white/20 hover:border-white/50'}`}>STEALTH (MINIMAL)</button>
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

      </div>
    );
};

export default App;