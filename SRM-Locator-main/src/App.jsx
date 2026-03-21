import { io } from "socket.io-client";
import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useScroll, useTransform, useSpring } from 'framer-motion';
import GoogleMapReact from 'google-map-react';
import { 
  MapPin, Users, Search, Settings, Navigation, ShieldCheck, 
  Building2, Sparkles, MessageSquare, Send, Loader2, 
  BrainCircuit, Lock, UserCheck, Ban, LogOut, LockKeyhole, Eye, EyeOff, ArrowRight, X,
  Wifi, Bluetooth, Radio, LocateFixed, OctagonAlert, Waypoints, Activity
} from 'lucide-react';

// --- ADDED: FIREBASE AUTH ---
import { auth, googleProvider } from './firebase';
import { signInWithPopup, onAuthStateChanged, signOut } from 'firebase/auth';

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

const CustomMarker = ({ isUser, name, photo, onClick }) => {
  if (isUser) {
    return (
      <div 
        onClick={onClick}
        className="w-10 h-10 -ml-5 -mt-5 bg-gradient-to-br from-emerald-400/80 to-teal-500/80 backdrop-blur-md rounded-full border border-emerald-200/50 shadow-[0_0_15px_rgba(52,211,153,0.6)] flex items-center justify-center text-white font-bold tracking-tighter cursor-pointer overflow-hidden"
      >
        {photo ? <img src={photo} alt={name} className="w-full h-full object-cover" /> : name?.charAt(0)}
      </div>
    )
  }
  return (
    <div 
      onClick={onClick}
      className="w-10 h-10 -ml-5 -mt-5 bg-gradient-to-br from-indigo-500/80 to-purple-600/80 backdrop-blur-md rounded-full border border-white/20 shadow-[0_0_15px_rgba(99,102,241,0.6)] flex items-center justify-center text-white cursor-pointer"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>
        <circle cx="12" cy="10" r="3"/>
      </svg>
    </div>
  )
}

const CinematicLanding = ({ 
  email, setEmail, password, setPassword, showPassword, setShowPassword, handleLogin, loginMethod 
}) => {
  const containerRef = useRef(null);
  const { scrollYProgress } = useScroll({ target: containerRef });
  const smoothProgress = useSpring(scrollYProgress, { stiffness: 50, damping: 15 });

  const heroOpacity = useTransform(smoothProgress, [0, 0.1, 0.15], [1, 1, 0]);
  const heroScale = useTransform(smoothProgress, [0, 0.15], [1, 1.2]);
  
  const btOpacity = useTransform(smoothProgress, [0.1, 0.18, 0.25, 0.3], [0, 1, 1, 0]);
  const btY = useTransform(smoothProgress, [0.1, 0.3], [100, -100]);

  const wifiOpacity = useTransform(smoothProgress, [0.25, 0.33, 0.4, 0.45], [0, 1, 1, 0]);
  const wifiScale = useTransform(smoothProgress, [0.25, 0.45], [0.8, 1.1]);

  const crowdOpacity = useTransform(smoothProgress, [0.4, 0.48, 0.55, 0.6], [0, 1, 1, 0]);
  const crowdBlur = useTransform(smoothProgress, [0.4, 0.5], ['blur(20px)', 'blur(0px)']);

  const radarOpacity = useTransform(smoothProgress, [0.55, 0.63, 0.7, 0.75], [0, 1, 1, 0]);
  const radarRotate = useTransform(smoothProgress, [0.55, 0.75], [0, 360]);

  const sosOpacity = useTransform(smoothProgress, [0.7, 0.78, 0.85, 0.9], [0, 1, 1, 0]);
  
  const finalOpacity = useTransform(smoothProgress, [0.85, 0.95, 1], [0, 1, 1]);
  const finalY = useTransform(smoothProgress, [0.85, 1], [100, 0]);

  return (
    <div ref={containerRef} className="relative w-full h-[800vh] bg-black text-white font-inter selection:bg-red-500/30">
      <motion.nav 
        className="fixed top-0 left-0 w-full px-6 py-4 flex justify-between items-center z-50 bg-black/80 backdrop-blur-md border-b border-white/20"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 border border-white text-white">
            <Radio className="w-5 h-5" />
          </div>
          <span className="text-xl font-bold font-dot tracking-widest uppercase hidden sm:block">LOCATOR.SRM</span>
        </div>
        <div className="text-xs font-dot tracking-widest uppercase text-white hover:text-red-500 cursor-pointer transition-colors border border-white/20 px-3 py-1">
          SYS_STATUS: ONLINE
        </div>
      </motion.nav>

      <div className="sticky top-0 w-full h-screen overflow-hidden flex items-center justify-center perspective-[1000px] bg-dots">
        {/* --- SCENE 1: HERO & 3D CAMPUS --- */}
        <motion.div style={{ opacity: heroOpacity, scale: heroScale, y: 0 }} className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center z-10 w-full max-w-7xl mx-auto pointer-events-none">
           <div className="inline-block border border-white/20 px-3 py-1 font-dot text-xs text-zinc-400 uppercase tracking-widest mb-12">
             <Activity size={12} className="inline mr-2 text-red-500 animate-pulse" />
             V 4.0 / QUANTUM POSITIONING
           </div>
           <h1 className="text-6xl sm:text-7xl md:text-9xl font-dot uppercase leading-[0.9] tracking-tighter mix-blend-difference z-20">
             MAPPING <br/> THE <br/> <span className="text-red-500">VOID.</span>
           </h1>
           <p className="mt-8 text-lg font-inter text-zinc-400 max-w-lg border-l-2 border-red-500 pl-4 text-left z-20">
             The hyper-accurate, decentralized locator network. See through the noise. Track your crew. 
           </p>

           <div className="absolute inset-0 z-0 flex items-center justify-center pointer-events-none opacity-40">
              <div className="w-[80vw] h-[80vw] max-w-3xl max-h-3xl border border-white/10 rounded-full flex flex-col items-center justify-center animate-[spin_60s_linear_infinite]">
                 <div className="absolute w-2 h-2 bg-red-500 shadow-[0_0_20px_#f00] top-1/4 left-1/4 animate-pulse" />
                 <div className="absolute w-1 h-1 bg-white shadow-[0_0_10px_#fff] top-1/2 right-1/4 animate-ping" />
                 <div className="absolute w-1.5 h-1.5 bg-white shadow-[0_0_10px_#fff] bottom-1/3 left-1/2 animate-pulse" />
                 <div className="w-1/2 h-1/2 border border-white/20 rounded-full animate-[spin_30s_linear_infinite_reverse] relative">
                    <div className="absolute w-2 h-2 bg-red-500 shadow-[0_0_20px_#f00] top-0 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                 </div>
              </div>
           </div>
           <div className="absolute bottom-12 font-dot text-xs text-zinc-500 tracking-[0.3em] uppercase animate-pulse">
             SCROLL_TO_INITIALIZE_SYS
           </div>
        </motion.div>

        {/* --- SCENE 2: BLUETOOTH PROXIMITY --- */}
        <motion.div style={{ opacity: btOpacity, y: btY }} className="absolute inset-0 flex flex-col md:flex-row items-center justify-center p-6 gap-12 max-w-6xl mx-auto z-20 pointer-events-none">
          <div className="w-full md:w-1/2 aspect-square relative flex items-center justify-center">
            <Bluetooth size={48} className="text-white z-10" />
            <motion.div className="absolute inset-0 border border-white/20 rounded-full" animate={{ scale: [1, 2], opacity: [1, 0] }} transition={{ duration: 2, repeat: Infinity }} />
            <motion.div className="absolute inset-0 border border-red-500/50 rounded-full" animate={{ scale: [1, 2], opacity: [1, 0] }} transition={{ duration: 2, repeat: Infinity, delay: 0.5 }} />
            <motion.div className="absolute inset-0 border border-white/10 rounded-full" animate={{ scale: [1, 2], opacity: [1, 0] }} transition={{ duration: 2, repeat: Infinity, delay: 1 }} />
            <div className="absolute top-[20%] right-[20%] w-2 h-2 bg-red-500 rounded-full"></div>
            <div className="absolute bottom-[30%] left-[15%] w-1.5 h-1.5 bg-white rounded-full"></div>
            <div className="absolute bottom-[20%] right-[30%] w-3 h-3 border border-white rounded-full flex items-center justify-center"><div className="w-1 h-1 bg-white rounded-full"></div></div>
          </div>
          <div className="md:w-1/2 space-y-6">
            <div className="font-dot text-red-500 text-sm tracking-widest">[ 01_PROXIMITY_MESH ]</div>
            <h2 className="text-5xl font-dot uppercase leading-none">P2P <br/> ECHO_SCAN</h2>
            <p className="font-inter text-zinc-400 text-lg">
              Smart devices interlock directly. Forming an invisible, decentralised Bluetooth mesh to trace high-accuracy micro-locations indoors.
            </p>
          </div>
        </motion.div>

        {/* --- SCENE 3: WIFI FINGERPRINTING --- */}
        <motion.div style={{ opacity: wifiOpacity, scale: wifiScale }} className="absolute inset-0 flex flex-col md:flex-row-reverse items-center justify-center p-6 gap-12 max-w-6xl mx-auto z-20 pointer-events-none">
          <div className="w-full md:w-1/2 aspect-[4/3] bg-black border border-white/20 p-4 relative overflow-hidden flex items-center justify-center">
             <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:20px_20px]" />
             <Wifi size={64} className="text-red-500 z-10 animate-pulse" />
             <motion.div animate={{ height: ['0%', '100%'] }} transition={{ duration: 1.5, repeat: Infinity, repeatType: "reverse" }} className="absolute left-1/4 w-[1px] bg-red-500 blur-[1px] bottom-0" />
             <motion.div animate={{ height: ['0%', '80%'] }} transition={{ duration: 1.8, repeat: Infinity, repeatType: "reverse", delay: 0.3 }} className="absolute right-1/4 w-[1px] bg-white blur-[1px] top-0" />
             <motion.div animate={{ width: ['0%', '100%'] }} transition={{ duration: 1.2, repeat: Infinity, repeatType: "reverse", delay: 0.6 }} className="absolute top-1/3 h-[1px] bg-red-500 blur-[1px] left-0" />
          </div>
          <div className="md:w-1/2 space-y-6">
            <div className="font-dot text-red-500 text-sm tracking-widest">[ 02_MAPPING_VECTORS ]</div>
            <h2 className="text-5xl font-dot uppercase leading-none">SIGNAL <br/> FINGERPRINTS</h2>
            <p className="font-inter text-zinc-400 text-lg">
              Triangulating against legacy AP nodes. Advanced Neural algorithms map signal decay across building geometry to locate targets without GPS.
            </p>
          </div>
        </motion.div>

        {/* --- SCENE 4: CROWD DENSITY HEATMAP --- */}
        <motion.div style={{ opacity: crowdOpacity, filter: crowdBlur }} className="absolute inset-0 flex flex-col items-center justify-center p-6 max-w-5xl mx-auto text-center z-20 pointer-events-none">
           <Users size={64} className="text-white mb-8" />
           <h2 className="text-5xl md:text-7xl font-dot uppercase mb-6">THERMAL <br/> OVERLAY</h2>
           <p className="font-inter text-zinc-400 max-w-xl mx-auto text-lg mb-12">
             Real-time aggregation. Heatmaps track dense congregation areas dynamically. Avoid the rush or find the action.
           </p>
           <div className="w-full max-w-2xl h-32 border border-white/20 bg-black relative overflow-hidden flex blur-sm">
             <motion.div animate={{ x: ['-100%', '200%'] }} transition={{ duration: 4, ease: "linear", repeat: Infinity }} className="h-full w-48 bg-red-500/50 blur-3xl rounded-full mix-blend-screen" />
             <motion.div animate={{ x: ['200%', '-100%'] }} transition={{ duration: 5, ease: "linear", repeat: Infinity }} className="h-full w-64 bg-white/30 blur-3xl rounded-full mix-blend-screen absolute top-4" />
           </div>
        </motion.div>

        {/* --- SCENE 5: FRIEND RADAR --- */}
        <motion.div style={{ opacity: radarOpacity, rotate: radarRotate }} className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 opacity-30">
           <div className="w-[100vw] h-[100vw] sm:w-[50vw] sm:h-[50vw] border border-red-500 rounded-full relative">
              <div className="absolute top-0 bottom-1/2 left-1/2 w-0.5 bg-gradient-to-t from-red-500 to-transparent origin-bottom animate-pulse"></div>
              <div className="absolute w-2 h-2 bg-white top-1/4 left-1/3 shadow-[0_0_10px_#fff]" />
              <div className="absolute w-3 h-3 border border-red-500 top-2/3 right-1/4 flex items-center justify-center"><div className="w-1 h-1 bg-red-500" /></div>
           </div>
        </motion.div>
        <motion.div style={{ opacity: radarOpacity }} className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center z-20 pointer-events-none">
           <LocateFixed size={48} className="text-red-500 mb-6" />
           <h2 className="text-5xl md:text-7xl font-dot uppercase text-white drop-shadow-[0_0_20px_rgba(0,0,0,1)]">SQUAD <br/> RADAR</h2>
        </motion.div>

        {/* --- SCENE 6: EMERGENCY SOS --- */}
        <motion.div style={{ opacity: sosOpacity }} className="absolute inset-0 bg-red-950 flex flex-col items-center justify-center p-6 z-30 transition-colors duration-500 mix-blend-difference pointer-events-none">
           <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ duration: 0.5, repeat: Infinity }} className="p-8 border-4 border-red-500 text-red-500 bg-black rotate-45 mb-12">
             <OctagonAlert size={64} className="-rotate-45" />
           </motion.div>
           <h2 className="text-6xl md:text-8xl font-dot uppercase tracking-tighter text-red-500">
             SOS_OVERRIDE
           </h2>
           <p className="font-mono text-white mt-6 bg-red-500 px-4 py-1 text-sm tracking-widest uppercase">
             CRITICAL DISTRESS SIGNAL PROTOCOL
           </p>
        </motion.div>

        {/* --- SCENE 7 & FINAL: AUTH NODE --- */}
        <motion.div style={{ opacity: finalOpacity, y: finalY }} className="absolute inset-0 flex items-center justify-center p-6 bg-black z-40">
           <div className="w-full max-w-md p-10 border border-white/20 bg-black relative pointer-events-auto">
             <div className="absolute top-0 left-0 w-2 h-2 bg-white" />
             <div className="absolute top-0 right-0 w-2 h-2 bg-white" />
             <div className="absolute bottom-0 left-0 w-2 h-2 bg-white" />
             <div className="absolute bottom-0 right-0 w-2 h-2 bg-white" />
             
             <div className="mb-10 text-left border-b border-white/20 pb-6 flex items-start justify-between">
               <div>
                 <h2 className="text-3xl font-dot uppercase tracking-widest mb-2">Auth_Node</h2>
                 <p className="text-red-500 font-dot text-xs">AWAITING CREDENTIALS...</p>
               </div>
               <Waypoints size={32} className="text-zinc-600" />
             </div>

             <form onSubmit={(e) => { e.preventDefault(); handleLogin('email'); }} className="space-y-6 relative z-50">
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
                 className="w-full py-4 mt-4 bg-white text-black font-dot uppercase tracking-widest hover:bg-red-500 hover:text-white border border-white hover:border-red-500 transition-all flex justify-center items-center gap-2"
               >
                 INITIALIZE_LINK <ArrowRight size={16} />
               </button>
             </form>

             <div className="flex items-center gap-4 my-8 relative z-50">
               <div className="h-[1px] bg-white/20 flex-1"></div>
               <span className="text-[10px] font-dot text-zinc-500 uppercase">OR EXT_AUTH</span>
               <div className="h-[1px] bg-white/20 flex-1"></div>
             </div>

             <button 
               onClick={() => handleLogin('google')}
               className="w-full py-4 border border-white/30 hover:border-white transition-all font-dot uppercase text-xs flex items-center justify-center gap-3 bg-black text-white relative z-50"
             >
               <div className="w-4 h-4 border border-white flex items-center justify-center">
                  <span className="text-[10px] leading-none">G</span>
               </div> 
               CONTINUE VIA GOOGLE
             </button>
           </div>
        </motion.div>

        {/* Auth Overlay Modal */}
        <AnimatePresence>
          {loginMethod && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-[100] bg-black border-[8px] border-white flex flex-col items-center justify-center p-6 pointer-events-auto"
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
    </div>
  );
}

const App = () => {
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
      path: [ { lat: 12.825020, lng: 80.045323 }, { lat: 12.824500, lng: 80.044900 }, { lat: 12.823900, lng: 80.044600 }, { lat: 12.823348, lng: 80.044489 } ]
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
  // --- 📡 ADDITION 1: THE SAFETY PING (HEARTBEAT) ---
  useEffect(() => {
    // Only fire if the user is in a squad and has a GPS lock
    if (!squadCode || !liveLocation) return;

    const pingInterval = setInterval(async () => {
      let currentBattery = 'Unknown';
      
      if (navigator.getBattery) {
        try {
          const battery = await navigator.getBattery();
          currentBattery = `${Math.round(battery.level * 100)}%`;
        } catch (err) {
          console.log("Battery API blocked by browser.");
        }
      }

      // Fire the whisper to the Node server
      socket.emit('safety-ping', {
        latitude: liveLocation.lat,
        longitude: liveLocation.lng,
        timestamp: new Date().toISOString(),
        batteryLevel: currentBattery
      });
      
    }, 5000); // 5000ms = 5 seconds

    return () => clearInterval(pingInterval);
  }, [squadCode, liveLocation]);
  // --- 🚨 ADDITION 2: THE DEAD MAN'S SWITCH INTERCEPTOR ---
  useEffect(() => {
    socket.on('member-signal-lost', (emergencyData) => {
      const { name, lastKnownLocation, disconnectTime } = emergencyData;
      
      console.error(`🚨 [CRITICAL ALERT] Signal lost for ${name}`);
      
      // Trigger the Sonar Ping audio if it exists
      if (typeof playSonarPing === 'function') {
        playSonarPing();
      }

      // Tactical Alert
      alert(`[CRITICAL DISCONNECT] \n\nUnit '${name}' has gone offline.\n\n📍 Last Known Coordinates: \nLAT: ${lastKnownLocation.latitude.toFixed(5)} \nLNG: ${lastKnownLocation.longitude.toFixed(5)} \n🔋 Battery at time of drop: ${lastKnownLocation.batteryLevel}`);
      
      // TODO: Render a static red "LKL" Marker on the GoogleMapReact component
    });

    return () => {
      socket.off('member-signal-lost');
    };
  }, []);
  // --- 📊 ADDITION 3: TELEMETRY DATA RECEIVER ---
  useEffect(() => {
    socket.on('telemetry-sync-complete', (data) => {
      console.log("📊 [TACTICAL TELEMETRY DUMP]:", data);
      
      // For now, we are just alerting it so you can confirm it works.
      // Next, we will map this data directly into your UI.
      const nodeCount = Object.keys(data).length;
      alert(`[SYS_SYNC] Telemetry data acquired for ${nodeCount} active nodes. Check browser console for raw data.`);
    });

    return () => socket.off('telemetry-sync-complete');
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

  
 // 1. Listen for real-time network updates from the server
  useEffect(() => {
    if (!hasJoinedSquad) return;

    socket.on('users-update', (activeUsers) => {
      const formattedUsers = [];
      
      Object.entries(activeUsers).forEach(([id, data]) => {
        // 🚨 UPGRADED: We now completely ignore data.status === 'GHOST'
        if (id !== socket.id && data.roomCode === squadCode && data.status !== 'GHOST') { 
          formattedUsers.push({
            id: id,
            name: data.name || "Live User",
            photo: data.photo,
            role: "Campus Node",
            lat: data.lat,
            lng: data.lng,
            speed: data.speed || 0,
            battery: data.battery || 0,
            status: data.status || "ACTIVE", // Capture their status
            permission: "accepted" 
          });
        }
      });
      setUsers(formattedUsers);
    });

    // ... rest of the socket.on listeners remain the same ...

    socket.on('receive-ping', ({ senderName }) => {
      alert(`🚨 SOS BEACON DETECTED 🚨\n\n${senderName.toUpperCase()} requires immediate assistance at their coordinates!`);
    });

    // Listen for newly published admin routes
    socket.on('new-custom-route', ({ key, data }) => {
       setLiveSecretRoutes(prev => ({ ...prev, [key]: data }));
    });

    return () => {
      socket.off('users-update');
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
  useEffect(() => {
    if (!user || !hasJoinedSquad || accessStatus !== 'granted') return;

    // 👻 GHOST MODE: Tell the server we are a ghost, then abort GPS tracking
    if (telemetryMode === 'GHOST') {
      socket.emit('update-location', { id: socket.id, status: 'GHOST', roomCode: squadCode });
      return; 
    }

    // 🧊 FROZEN MODE: Send static location once, then abort GPS tracking to save battery
    if (telemetryMode === 'FROZEN' && liveLocation) {
      socket.emit('update-location', {
        id: socket.id, name: user.displayName, photo: user.photoURL,
        lat: liveLocation.lat, lng: liveLocation.lng,
        speed: 0, battery: 0, roomCode: squadCode, status: 'FROZEN'
      });
      return;
    }

    // 🟢 ACTIVE MODE: Standard live hardware tracking
    const watchId = navigator.geolocation.watchPosition(
      async (position) => { 
        const { latitude, longitude, speed } = position.coords;
        setLiveLocation({ lat: latitude, lng: longitude });

        let batteryLevel = null;
        try {
          if ('getBattery' in navigator) {
            const battery = await navigator.getBattery();
            batteryLevel = Math.round(battery.level * 100);
          }
        } catch (e) { console.log("Battery API blocked"); }

        socket.emit('update-location', {
          id: socket.id, name: user.displayName, photo: user.photoURL,
          lat: latitude, lng: longitude,
          speed: speed ? Math.round(speed * 3.6) : 0, battery: batteryLevel,
          roomCode: squadCode, status: 'ACTIVE'
        });
      },
      (error) => console.error("🚨 [SYS_ERROR] Geolocation lost:", error.message),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  // This is at the very end of the GPS useEffect block (around line 520)
}, [user, hasJoinedSquad, squadCode, telemetryMode, accessStatus]);

  
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

  const handleLogin = async (method) => {
    setLoginMethod(method);
    if (method === 'google') {
       try {
         await signInWithPopup(auth, googleProvider);
       } catch (error) {
         console.error("Google Auth Failed:", error);
         setLoginMethod(null);
       }
    } else {
       setTimeout(() => {
         setLoginMethod(null);
         alert("Email auth requires backend. Please click CONTINUE VIA GOOGLE");
       }, 1800);
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
  };

  const handleLeaveSquad = () => {
    socket.emit('leave-squad');
    setHasJoinedSquad(false);
    setSquadCode('');
    setUsers([]);
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
    setAiLoading(true);
    setAiResponse('');
    
    try {
      // 1. COMPRESSED TELEMETRY: Only send Name, Distance, Speed, Battery
      const squadSnapshot = users.filter(u => !blockedUserIds.includes(u.id)).map(u => 
        `[${u.name}] Dist:${calculateDistance(liveLocation?.lat, liveLocation?.lng, u.lat, u.lng)}, Spd:${u.speed}km/h, Bat:${u.battery}%`
      ).join(' | ');

      // 2. COMPRESSED MAP DATA: Only send Name and Coordinates (Drop the info descriptions)
      const campusSnapshot = BUILDINGS.map(b => 
        `[${b.name}] Lat:${b.lat.toFixed(5)}, Lng:${b.lng.toFixed(5)}`
      ).join(' | ');

      // 3. LEAN INSTRUCTION: Force the AI to be concise to save output tokens
      const tacticalInstruction = `You are 'SYS_ORACLE', a tactical AI on the LOCUS network at SRM KTR.
        SQUAD DATA: ${squadSnapshot || "Empty"}
        MAP DATA: ${campusSnapshot}
        DIRECTIVE: Answer the user's query utilizing the data above. Keep answers under 3 sentences. Use a concise, military-comms tone.`;

      const res = await callGemini(aiQuery, tacticalInstruction);
      setAiResponse(res);
    } catch (err) {
      setAiResponse("[SYS_FAILURE] Neural link to Oracle severed. Retrying connection...");
    } finally {
      setAiLoading(false);
      setAiQuery('');
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

  const createMapOptions = (maps) => {
    return {
      zoomControl: false,
      mapTypeControl: false,
      fullscreenControl: false,
      streetViewControl: false,
      styles: [
        { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
        { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
        { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
        {
          featureType: "administrative.locality",
          elementType: "labels.text.fill",
          stylers: [{ color: "#d59563" }],
        },
        {
          featureType: "poi",
          elementType: "labels.text.fill",
          stylers: [{ color: "#d59563" }],
        },
        {
          featureType: "poi.park",
          elementType: "geometry",
          stylers: [{ color: "#263c3f" }],
        },
        {
          featureType: "poi.park",
          elementType: "labels.text.fill",
          stylers: [{ color: "#6b9a76" }],
        },
        {
          featureType: "road",
          elementType: "geometry",
          stylers: [{ color: "#38414e" }],
        },
        {
          featureType: "road",
          elementType: "geometry.stroke",
          stylers: [{ color: "#212a37" }],
        },
        {
          featureType: "road",
          elementType: "labels.text.fill",
          stylers: [{ color: "#9ca5b3" }],
        },
        {
          featureType: "water",
          elementType: "geometry",
          stylers: [{ color: "#17263c" }],
        },
        {
          featureType: "water",
          elementType: "labels.text.fill",
          stylers: [{ color: "#515c6d" }],
        },
        {
          featureType: "water",
          elementType: "labels.text.stroke",
          stylers: [{ color: "#17263c" }],
        },
      ],
    };
  }

  if (authLoading) return <div className="h-screen bg-black text-white flex justify-center items-center font-dot">INITIALIZING_SECURE_LINK...</div>;

  if (!user) {
    return (
      <CinematicLanding 
        email={email}
        setEmail={setEmail}
        password={password}
        setPassword={setPassword}
        showPassword={showPassword}
        setShowPassword={setShowPassword}
        handleLogin={handleLogin}
        loginMethod={loginMethod}
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
            <h1 className="font-dot tracking-widest uppercase text-xl">LOCATOR.SRM</h1>
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
             className={`flex-1 py-4 flex items-center justify-center gap-2 font-dot text-sm uppercase tracking-widest transition-colors ${
               activeTab === 'buildings' ? 'bg-white text-black' : 'text-zinc-500 hover:text-white hover:bg-white/5'
             }`}
           >
             <Building2 size={16} /> MATRIX
           </button>
           <button 
             onClick={() => { setActiveTab('users'); setSelectedItem(null); setIsEditMode(false); }}
             className={`flex-1 py-4 flex items-center justify-center gap-2 font-dot text-sm uppercase tracking-widest transition-colors border-l border-white/20 ${
               activeTab === 'users' ? 'bg-white text-black' : 'text-zinc-500 hover:text-white hover:bg-white/5'
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
                 <div className="flex items-center gap-2"><ShieldCheck size={18}/> NODE_ACCESS</div>
                 {pendingRequests.length > 0 && <span className="px-2 py-0.5 bg-red-500 text-white text-xs">{pendingRequests.length}</span>}
               </button>
               
               {/* --- NEW: TELEMETRY SYNC BUTTON --- */}
               <button 
                 onClick={() => socket.emit('request-telemetry', squadCode)} 
                 className="w-full px-4 py-3 border border-yellow-500 text-sm font-dot uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-yellow-500 hover:text-black transition-colors text-yellow-500 shadow-[0_0_15px_rgba(234,179,8,0.2)]"
               >
                 <Activity size={18}/> SYNC_TELEMETRY
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
                   onClick={() => setTelemetryMode('ACTIVE')} 
                   className={`flex-1 py-2 font-dot text-[10px] tracking-widest border flex flex-col items-center gap-1 transition-colors ${telemetryMode === 'ACTIVE' ? 'bg-emerald-500/20 border-emerald-500 text-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)]' : 'border-white/10 text-zinc-600 hover:border-white/30'}`}
                 >
                   <Activity size={14} /> ACTIVE
                 </button>
                 <button 
                   onClick={() => setTelemetryMode('FROZEN')} 
                   className={`flex-1 py-2 font-dot text-[10px] tracking-widest border flex flex-col items-center gap-1 transition-colors ${telemetryMode === 'FROZEN' ? 'bg-blue-500/20 border-blue-500 text-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.3)]' : 'border-white/10 text-zinc-600 hover:border-white/30'}`}
                 >
                   <LocateFixed size={14} /> FROZEN
                 </button>
                 <button 
                   onClick={() => setTelemetryMode('GHOST')} 
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
                    onClick={() => handleFocus({ lat: building.lat, lng: building.lng }, building)}
                    className={`p-4 border cursor-pointer transition-colors ${
                      selectedItem?.id === building.id 
                      ? 'border-white bg-white/10' 
                      : 'border-white/20 hover:border-white/50'
                    }`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex flex-col">
                        <h3 className="font-dot text-sm uppercase tracking-widest">{building.name}</h3>
                        {liveLocation && (
                          <span className="text-[10px] text-red-500 font-dot mt-1">
                            {calculateDistance(liveLocation.lat, liveLocation.lng, building.lat, building.lng)} AWAY
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] font-dot text-zinc-400 uppercase tracking-widest">
                        [{building.category}]
                      </span>
                    </div>
                    <p className="text-xs text-zinc-500">{building.info}</p>
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
                    className="p-4 border border-white/20 relative"
                  >
                    <div className="absolute top-0 right-0 w-2 h-2 bg-white/20" />
                    
                    <div className="flex items-center gap-4 mb-4">
                      <div className={`w-10 h-10 flex items-center justify-center font-dot text-sm border overflow-hidden ${user.permission === 'accepted' ? 'border-red-500 text-red-500' : 'border-white/20 text-zinc-500'}`}>
                        {user.photo ? <img src={user.photo} className="w-full h-full object-cover" alt="" /> : user.name.charAt(0)}
                      </div>
                      <div className="flex-1">
                        <h4 className="font-dot text-sm uppercase tracking-widest">{user.name}</h4>
                        <div className="text-[10px] font-dot text-zinc-500 uppercase tracking-widest flex items-center gap-2 mt-1">
                          <span>[{user.role}]</span>
                          {liveLocation && (
                            <span className="text-red-500">
                              {calculateDistance(liveLocation.lat, liveLocation.lng, user.lat, user.lng)}
                            </span>
                          )}
                        </div>
                        <div className="flex gap-4 mt-2 border-t border-white/5 pt-2">
                        <div className="flex items-center gap-1.5">
                          <div className="w-1.5 h-3 border border-zinc-600 rounded-[1px] relative flex items-end overflow-hidden">
                            <div
                              className={`w-full ${user.battery < 25 ? 'bg-red-500' : 'bg-emerald-500'} transition-all duration-500`}
                              style={{ height: `${user.battery}%` }}
                            />
                          </div>
                          <span className="text-[9px] font-dot text-zinc-500 uppercase tracking-tighter">{user.battery || 0}% BAT</span>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <Activity size={10} className="text-blue-500 animate-pulse" />
                          <span className="text-[9px] font-dot text-zinc-500 uppercase tracking-tighter">{user.speed || 0} KM/H</span>
                        </div>
                      
                        <button 
                          onClick={() => fireSOSBeacon(user.id, user.name)}
                          className="w-full mt-3 py-2 bg-red-900/30 border border-red-500 text-red-500 font-dot text-[10px] uppercase tracking-widest hover:bg-red-500 hover:text-white transition-all"
                        >
                          FIRE_SOS_BEACON
                          </button>
                        </div>
                      </div>
                      <div className="flex gap-3 items-center">
                        <button 
                          onClick={() => sendPing(user.id)} 
                          className="text-emerald-400 hover:text-white transition-colors"
                          title="Ping User"
                          >
                            <Radio size={18} className="animate-pulse" />
                          </button>

                          {user.permission === 'accepted' ? <UserCheck size={18} className="text-white" /> : <Lock size={18} className="text-zinc-600"/>}

                          <button onClick={() => toggleBlock(user.id)} className="text-zinc-600 hover:text-red-500 transition-colors">
                            <Ban size={18} /> 
                          </button>

                      </div>
                    </div>

                    {user.permission === 'accepted' ? (
                      <button onClick={() => handleFocus({ lat: user.lat, lng: user.lng }, null)} className="w-full py-3 border border-white hover:bg-white hover:text-black font-dot text-xs uppercase tracking-widest transition-colors">
                        TRACK_TARGET
                      </button>
                    ) : user.permission === 'requested' ? (
                      <div className="w-full py-3 border border-white/20 text-zinc-500 font-dot text-xs uppercase tracking-widest text-center">
                        AWAITING_AUTH...
                      </div>
                    ) : (
                      <button onClick={() => requestPermission(user.id)} className="w-full py-3 bg-white text-black hover:bg-zinc-200 font-dot text-xs uppercase tracking-widest transition-colors">
                        REQUEST_LINK
                      </button>
                    )}
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

      {/* FULLSCREEN GOOGLE MAP */}
      <div className="absolute inset-0 z-0 bg-black">
        <GoogleMapReact
          bootstrapURLKeys={{ key: 'AIzaSyD10sWfHpczEuvmvwBkqkPHOu-QXQr8uM0' }}
          center={mapProps.center}
          zoom={mapProps.zoom}
          options={{ ...createMapOptions(), draggableCursor: (isAdmin && isRecordingPath) ? 'crosshair' : (isEditMode && selectedItem ? 'crosshair' : 'grab') }}
          onClick={handleMapClick}
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
          {activeTab === 'users' && users.filter(u => u.permission === 'accepted' && !blockedUserIds.includes(u.id)).map(u => (
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
        </GoogleMapReact>
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

             {buildingIntel&& (
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
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="bg-black w-full max-w-lg border border-white flex flex-col max-h-[85vh] overflow-hidden"
            >
              <div className="p-6 border-b border-white/20 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="border border-red-500 p-2 text-red-500">
                     <ShieldCheck size={24} />
                  </div>
                  <h3 className="font-dot text-xl tracking-widest text-white uppercase">SYS_ACCESS_CONTROL</h3>
                </div>
                <button onClick={() => setShowRequestsModal(false)} className="p-2 border border-white/20 hover:bg-white hover:text-black transition-colors">
                  <X size={20} />
                </button>
              </div>

              <div className="flex border-b border-white/20 bg-black">
                 <button 
                  onClick={() => setModalTab('requests')}
                  className={`flex-1 py-4 font-dot text-sm uppercase tracking-widest transition-colors ${
                    modalTab === 'requests' ? 'bg-white text-black' : 'text-zinc-500 hover:text-white hover:bg-white/10'
                  }`}
                 >
                   INBOUND {pendingRequests.length > 0 && `[${pendingRequests.length}]`}
                 </button>
                 <button 
                  onClick={() => setModalTab('blocked')}
                  className={`flex-1 py-4 border-l border-white/20 font-dot text-sm uppercase tracking-widest transition-colors ${
                    modalTab === 'blocked' ? 'bg-red-500 text-white' : 'text-zinc-500 hover:text-white hover:bg-white/10'
                  }`}
                 >
                   BLACKLIST
                 </button>
              </div>
              
              <div className="p-6 overflow-y-auto custom-scrollbar flex-1 space-y-4">
                {modalTab === 'requests' ? (
                  pendingRequests.length === 0 ? (
                    <div className="py-16 flex flex-col items-center justify-center text-zinc-600 gap-4 cursor-default">
                      <ShieldCheck size={48} className="opacity-20" />
                      <p className="font-dot tracking-widest text-sm uppercase">NO_PENDING_REQUESTS</p>
                    </div>
                  ) : (
                    pendingRequests.map(node => (
  <div key={node.targetId} className="p-4 bg-black border border-white/20 flex flex-col gap-4 relative">
    <div className="absolute top-0 right-0 w-2 h-2 bg-red-500 animate-pulse" />
    
    <div className="flex items-center gap-4">
      <div className="w-12 h-12 border border-white/30 flex items-center justify-center font-dot text-xl text-zinc-400 overflow-hidden">
         {node.photo ? <img src={node.photo} className="w-full h-full object-cover" alt="" /> : node.name.charAt(0)}
      </div>
      <div>
        <p className="font-dot uppercase tracking-widest text-white text-lg">{node.name}</p>
        <p className="text-[10px] font-dot text-red-500 uppercase tracking-widest">REQUESTING_ACCESS // NODE_LINK</p>
      </div>
    </div>

    <div className="flex gap-3 mt-2">
       <button 
         onClick={() => {
           socket.emit('resolve-access', { targetId: node.targetId, roomCode: squadCode, approved: true });
           setPendingRequests(prev => prev.filter(p => p.targetId !== node.targetId));
         }} 
         className="flex-1 bg-white text-black border border-white hover:bg-black hover:text-white py-3 font-dot text-xs uppercase tracking-widest transition-colors"
       >
         GRANT_ACCESS
       </button>
       <button 
         onClick={() => {
           socket.emit('resolve-access', { targetId: node.targetId, roomCode: squadCode, approved: false });
           setPendingRequests(prev => prev.filter(p => p.targetId !== node.targetId));
         }}
         className="flex-1 bg-black text-white py-3 border border-white/20 hover:border-red-500 hover:text-red-500 font-dot text-xs uppercase tracking-widest transition-colors"
       >
         DENY
       </button>
    </div>
  </div>
))
                  )
                ) : (
                  blockedUsers.length === 0 ? (
                    <div className="py-16 flex flex-col items-center justify-center text-zinc-600 gap-4 cursor-default">
                      <Ban size={48} className="opacity-20" />
                      <p className="font-dot tracking-widest text-sm uppercase">BLACKLIST_EMPTY</p>
                    </div>
                  ) : (
                    blockedUsers.map(user => (
                      <div key={user.id} className="p-4 bg-black border border-red-500 flex items-center justify-between">
                         <span className="font-dot uppercase tracking-widest text-white">{user.name}</span>
                         <button onClick={() => toggleBlock(user.id)} className="border border-white/20 hover:border-white text-white px-4 py-2 font-dot text-xs uppercase tracking-widest transition-colors">
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
      
    </div>
  );
};

export default App;