import React, { useState, useEffect, useRef } from 'react';
import { Navigation, X, AlertTriangle, ShieldAlert } from 'lucide-react';
import { motion } from 'framer-motion';

// --- MATH HELPERS ---
const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;

const calculateBearing = (lat1, lng1, lat2, lng2) => {
  const dLng = toRad(lng2 - lng1);
  const rLat1 = toRad(lat1);
  const rLat2 = toRad(lat2);

  const y = Math.sin(dLng) * Math.cos(rLat2);
  const x = Math.cos(rLat1) * Math.sin(rLat2) - Math.sin(rLat1) * Math.cos(rLat2) * Math.cos(dLng);

  const brng = toDeg(Math.atan2(y, x));
  return (brng + 360) % 360;
};

const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371e3; // Earth radius in meters
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const deltaPhi = toRad(lat2 - lat1);
  const deltaLambda = toRad(lon2 - lon1);

  const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) *
    Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c); // Distance in meters
};

const ARCompass = ({ target, liveLocation, onClose }) => {
  const videoRef = useRef(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const [heading, setHeading] = useState(0);
  const [permissionsGranted, setPermissionsGranted] = useState(false);

  // 1. Initialize Camera
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' } 
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setCameraActive(true);
      setCameraError(false);
    } catch (err) {
      console.warn("[SYS_AR] Optics offline. Switching to Instrument Flight Rules (IFR).", err);
      setCameraError(true);
      setCameraActive(false);
    }
  };

  // 2. Initialize Compass
  const handleOrientation = (event) => {
    if (event.webkitCompassHeading) {
      // iOS absolute
      setHeading(event.webkitCompassHeading);
    } else if (event.absolute && event.alpha !== null) {
      // Android absolute
      setHeading(360 - event.alpha); 
    }
    // If it's a relative event (event.absolute is false), ignore it. 
    // Otherwise it overwrites the absolute heading with 0!
  };

  const requestPermissions = async () => {
    // iOS 13+ requires explicit permission for DeviceOrientation
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const permissionState = await DeviceOrientationEvent.requestPermission();
        if (permissionState === 'granted') {
          window.addEventListener('deviceorientationabsolute', handleOrientation, true);
          // fallback
          window.addEventListener('deviceorientation', handleOrientation, true);
          setPermissionsGranted(true);
        } else {
          alert("[SYS_ERROR] Compass access denied.");
        }
      } catch (err) {
        console.error(err);
      }
    } else {
      // Non-iOS 13+
      window.addEventListener('deviceorientationabsolute', handleOrientation, true);
      window.addEventListener('deviceorientation', handleOrientation, true);
      setPermissionsGranted(true);
    }
    startCamera();
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      window.removeEventListener('deviceorientationabsolute', handleOrientation, true);
      window.removeEventListener('deviceorientation', handleOrientation, true);
      if (videoRef.current && videoRef.current.srcObject) {
        const tracks = videoRef.current.srcObject.getTracks();
        tracks.forEach(track => track.stop());
      }
    };
  }, []);

  // Math variables
  const bearing = (liveLocation && target) ? calculateBearing(liveLocation.lat, liveLocation.lng, target.lat, target.lng) : 0;
  const distance = (liveLocation && target) ? calculateDistance(liveLocation.lat, liveLocation.lng, target.lat, target.lng) : 0;
  const rotation = bearing - heading;

  if (!permissionsGranted) {
    return (
      <div className="fixed inset-0 z-[9999] bg-black flex flex-col items-center justify-center p-6 text-center text-white">
        <ShieldAlert size={48} className="text-red-500 mb-6 animate-pulse" />
        <h2 className="font-dot text-2xl tracking-widest uppercase mb-4 text-white">SYS_AR // OPTICS_SYNC</h2>
        <p className="font-inter text-sm text-zinc-400 mb-8 max-w-sm">
          Tracking target: <span className="text-red-500 font-bold">{target.name}</span>.<br/><br/>
          Augmented Reality requires access to your device camera and compass sensors.
        </p>
        <button 
          onClick={requestPermissions}
          className="w-full max-w-sm py-4 bg-red-500 text-white font-dot uppercase tracking-widest shadow-[0_0_20px_rgba(239,68,68,0.4)] mb-4 hover:bg-red-600 transition-colors"
        >
          GRANT_ACCESS & INITIATE
        </button>
        <button 
          onClick={onClose}
          className="w-full max-w-sm py-4 border border-zinc-700 text-zinc-500 font-dot uppercase tracking-widest hover:bg-white hover:text-black transition-colors"
        >
          ABORT
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[9999] bg-black overflow-hidden pointer-events-auto">
      {/* Video Background */}
      <video 
        ref={videoRef}
        autoPlay 
        playsInline 
        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-1000 ${cameraError ? 'opacity-0' : 'opacity-100'}`}
      />

      {/* IFR Blackout Background */}
      {cameraError && (
        <div className="absolute inset-0 bg-black flex flex-col items-center justify-center z-0">
          <div className="w-[80vw] h-[80vw] border border-white/5 rounded-full absolute" />
          <div className="w-[60vw] h-[60vw] border border-white/10 rounded-full absolute" />
        </div>
      )}

      {/* Grid Overlay */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:20px_20px] pointer-events-none z-10" />

      {/* Tactical UI Layer */}
      <div className="relative z-20 w-full h-full flex flex-col p-6">
        
        {/* Header */}
        <div className="flex justify-between items-start">
          <div>
            <h3 className="font-dot text-xl text-red-500 uppercase tracking-widest leading-none mb-1">AR_TRACKER</h3>
            <p className="font-dot text-[10px] text-white uppercase tracking-widest bg-red-500 px-2 py-0.5 inline-block">
              {cameraError ? 'INSTRUMENT FLIGHT RULES (IFR)' : 'OPTICS ONLINE'}
            </p>
          </div>
          <button 
            onClick={onClose}
            className="p-3 border border-red-500/50 text-red-500 bg-black/50 backdrop-blur-md hover:bg-red-500 hover:text-white transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {/* Warning Banner */}
        <div className="mt-4 inline-flex items-center gap-2 bg-yellow-500/10 border border-yellow-500/30 px-3 py-2 self-start backdrop-blur-md">
          <AlertTriangle size={14} className="text-yellow-500" />
          <span className="font-dot text-[10px] text-yellow-500 uppercase tracking-widest">
            CALIBRATE SENSOR: PERFORM FIGURE-8 MOTION
          </span>
        </div>

        {/* Central Compass Area */}
        <div className="flex-1 flex flex-col items-center justify-center relative">
          
          {/* Static Crosshair HUD */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-64 h-64 border-2 border-white/20 rounded-full relative">
              <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1 h-4 bg-white/50" />
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 w-1 h-4 bg-white/50" />
              <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-1 bg-white/50" />
              <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-4 h-1 bg-white/50" />
            </div>
            {/* Center dot */}
            <div className="absolute w-2 h-2 bg-red-500 rounded-full" />
          </div>

          {/* Rotating Arrow */}
          <motion.div
            animate={{ rotate: rotation }}
            transition={{ type: "spring", damping: 15, stiffness: 100 }}
            className="w-48 h-48 rounded-full border-4 border-red-500 flex flex-col items-center justify-start pt-2 relative z-30 shadow-[0_0_30px_rgba(239,68,68,0.3)] bg-black/20 backdrop-blur-sm"
          >
            <Navigation size={48} className="text-red-500 drop-shadow-[0_0_10px_rgba(239,68,68,1)]" fill="currentColor" />
          </motion.div>

        </div>

        {/* Footer Target Data */}
        <div className="bg-black/60 backdrop-blur-md border border-white/20 p-4 mt-auto">
          <div className="flex justify-between items-end">
            <div>
              <p className="font-dot text-[10px] text-zinc-400 uppercase tracking-widest mb-1">TARGET_LOCK</p>
              <h2 className="font-dot text-2xl text-white uppercase tracking-widest leading-none">{target.name}</h2>
            </div>
            <div className="text-right">
              <p className="font-dot text-[10px] text-zinc-400 uppercase tracking-widest mb-1">PROXIMITY</p>
              <p className="font-dot text-3xl text-red-500 uppercase tracking-widest leading-none">{distance}M</p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};

export default ARCompass;
