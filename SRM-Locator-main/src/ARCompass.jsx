import React, { useState, useEffect, useRef } from 'react';
import { notify } from './utils/notify';
import { X, AlertTriangle, ShieldAlert } from 'lucide-react';
import { useDeviceHeading } from './hooks/useDeviceHeading';
import { useLiveHeading } from './hooks/useLiveHeading';
import { calculateBearing, calculateDistanceMeters as calculateDistance, normalizeRotationDelta } from './utils/geoMath';
import { selectArTags } from './utils/arTags';
import ARTag from './components/ARTag';
import ARRoadLine from './components/ARRoadLine';
import { buildRoadRibbon, roadScreenYFor } from './utils/arRoadLine';
import ARArrow3D from './components/ARArrow3D';
import { RealisticArrow } from './components/ARArrowGL';

const ARROW_SPRING = { type: 'spring', damping: 15, stiffness: 100 };

// speedMps: raw m/s from geolocation (App.jsx's liveSpeed).
// squadMembers / buildings: what the floating tags can label (roster entries and
// SRM_MASTER_DATABASE); selfUid keeps this phone's own user off them.
// routePath: the walking route to draw on the ground, only when AR Scan is on the squad's
// Rally Point (see arRoutePathFor); null otherwise.
// fidelity: sysConfig.arFidelity (AR_RENDER_MODE), which picks the arrow (see the ring below).
const ARCompass = ({ target, liveLocation, speedMps = 0, squadMembers = [], buildings = [], selfUid = null, routePath = null, fidelity = 'standard', onClose }) => {
  const videoRef = useRef(null);
  const [cameraError, setCameraError] = useState(false);
  const { heading: compassHeading, permissionsGranted, requestHeadingPermission } = useDeviceHeading();
  // Same fusion as the live map marker: GPS course while walking, the smoothed
  // compass otherwise. The compass alone drifts indoors and near steel.
  const heading = useLiveHeading({
    lat: liveLocation?.lat,
    lng: liveLocation?.lng,
    speedMps,
    compassHeading,
  });

  // 1. Initialize Camera
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setCameraError(false);
    } catch (err) {
      console.warn("[SYS_AR] Optics offline. Switching to Instrument Flight Rules (IFR).", err);
      setCameraError(true);
    }
  };

  const requestPermissions = async () => {
    const granted = await requestHeadingPermission();
    if (!granted) notify.error("[SYS_ERROR] Compass access denied.");
    startCamera();
  };

  // Cleanup on unmount (device orientation listeners are torn down by useDeviceHeading itself).
  // Capture the video node now rather than reading videoRef.current inside the cleanup —
  // by the time cleanup runs, React may have already cleared the ref.
  useEffect(() => {
    const video = videoRef.current;
    return () => {
      if (video && video.srcObject) {
        const tracks = video.srcObject.getTracks();
        tracks.forEach(track => track.stop());
      }
    };
  }, []);

  // Math variables
  const bearing = (liveLocation && target) ? calculateBearing(liveLocation.lat, liveLocation.lng, target.lat, target.lng) : 0;
  const distance = (liveLocation && target) ? calculateDistance(liveLocation.lat, liveLocation.lng, target.lat, target.lng) : 0;

  // The road line is drawn in real pixels (its widths are pixel widths), so it needs the
  // screen's size; AR Scan is full-screen, so that is the window's.
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const ribbon = routePath
    ? buildRoadRibbon({ origin: liveLocation, heading, path: routePath, screenWidth: viewport.width, screenHeight: viewport.height })
    : null;

  // Floating tags over whatever is in view, placed in screen percentages (width and
  // height of 100) so they need no resize handling. While a road is drawn, the
  // destination's tag goes on the road's curve, so the road runs up to it.
  const tags = selectArTags({
    origin: liveLocation,
    heading,
    members: squadMembers,
    buildings,
    selfUid,
    target,
    screenWidth: 100,
    screenHeight: 100,
    targetScreenYFor: ribbon ? roadScreenYFor : undefined,
  });

  // --- 🧭 WRAPAROUND-SAFE ROTATION ---
  // (bearing - heading) is a raw difference of two 0-360deg values, which jumps
  // discontinuously whenever either crosses the 0/360 boundary (e.g. heading 359 -> 1
  // makes the raw value swing by ~358 instead of ~2). Framer Motion interpolates
  // `rotate` numerically with no wraparound awareness, so the arrow visibly spins the
  // long way around anytime the user turns through north. Instead, accumulate an
  // unbounded rotation and nudge it each update by the shortest signed delta (<=180deg)
  // needed to reach the new target angle, so the animated value never jumps.
  // The ring, and the AR screen's root element, which the 'realistic' arrow draws over.
  const ringRef = useRef(null);
  const [overlayEl, setOverlayEl] = useState(null);
  const rotationRef = useRef(0);
  const [displayRotation, setDisplayRotation] = useState(0);

  useEffect(() => {
    const targetAngle = bearing - heading;
    const prev = rotationRef.current;
    const delta = normalizeRotationDelta(targetAngle, prev);
    const next = prev + delta;
    rotationRef.current = next;
    setDisplayRotation(next);
  }, [bearing, heading]);

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
    <div ref={setOverlayEl} className="fixed inset-0 z-[9999] bg-black overflow-hidden pointer-events-auto">
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

      {/* The route to the Rally Point, on the ground: under the HUD and the tags. */}
      {ribbon && <ARRoadLine ribbon={ribbon} width={viewport.width} height={viewport.height} />}

      {/* Floating tags, anchored to real things as the phone pans. Above the arrow ring,
          below nothing tappable (they take no touches). Drawn furthest first, so where
          two overlap the nearer one is on top. */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-[25]" aria-hidden="true">
        {[...tags.ambient].reverse().map((t) => (
          <ARTag key={t.key} name={t.name} distance={t.distance} x={t.x} y={t.y} variant={t.kind} />
        ))}
        {tags.target && (
          <ARTag key="target" name={tags.target.name} distance={tags.target.distance} x={tags.target.x} y={tags.target.y} variant="target" />
        )}
      </div>

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

          {/* The ring, and the destination arrow turning inside it by the same
              wraparound-safe angle and spring as before. The arrow depends on
              AR_RENDER_MODE: 'efficient' and 'standard' (and anything unknown) get the
              CSS 3D wedge; 'realistic' gets the three.js arrow (RealisticArrow), which
              loads three.js only then. */}
          <div
            ref={ringRef}
            data-testid="ar-arrow-ring"
            data-fidelity={fidelity}
            className="w-48 h-48 rounded-full border-4 border-red-500 flex items-center justify-center relative z-30 shadow-[0_0_30px_rgba(239,68,68,0.3)] bg-black/20 backdrop-blur-sm"
          >
            {fidelity === 'realistic' ? (
              <RealisticArrow rotation={displayRotation} spring={ARROW_SPRING} ringRef={ringRef} overlayEl={overlayEl} />
            ) : (
              <ARArrow3D rotation={displayRotation} transition={ARROW_SPRING} />
            )}
          </div>

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
