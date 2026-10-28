import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { notify } from './utils/notify';
import { CameraOff, Compass, MoonStar, ScanLine } from 'lucide-react';
import { Button } from './components/ui';
import { AR_START } from './copy/permissions';
import { useDeviceHeading } from './hooks/useDeviceHeading';
import { calculateBearing, calculateDistanceMeters as calculateDistance, normalizeRotationDelta } from './utils/geoMath';
import {
  DEFAULT_BUILDING_HEIGHT_M,
  NO_ALIGNMENT,
  PERSON_HEIGHT_M,
  applyAlignment,
  computeAlignment,
  effectiveHorizontalFov,
  loadAlignment,
  saveAlignment,
} from './utils/landmarkAnchorEngine';
import { buildArLandmarks } from './arLandmarks';
import ARLandmarkLayer from './components/ARLandmarkLayer';
import { GPS_HEADING_SPEED_MPS } from './LiveLocationMarker';
import { useArPosition } from './hooks/useArPosition';
import { stickyDistance } from './utils/arPosition';
import { magneticDeclination } from './utils/declination';
import ARRoadLine from './components/ARRoadLine';
import { buildRoadRibbon, buildRoadStrip, remainingPath, remainingRouteSamples } from './utils/arRoadLine';
import { formatMetres, relativeClock, compassPoint, HERE_METRES } from './utils/direction';
import { directionLabel, distanceLabel, walkLabel } from './copy/place';
import { AR_ALIGN, AR_NOTICES, AR_READOUT } from './copy/arScan';
import ArNotice from './components/ar/ArNotice';
import { useCameraDarkness } from './hooks/useCameraDarkness';
import { cameraQuaternion, projectGroundPoint } from './utils/arCamera';
import ARRoadGL from './components/ARRoadGL';
import ARArrow3D from './components/ARArrow3D';
import { RealisticArrow } from './components/ARArrowGL';
import { resolveArFeatures } from './utils/arFeatures';
import { LAYER } from './utils/layers';
import ArTopBar from './components/ar/ArTopBar';
import ArTargetPicker from './components/ar/ArTargetPicker';
import { AR_TAG_TOP_SAFE_MARGIN_PX } from './utils/topInset';

const ARROW_SPRING = { type: 'spring', damping: 15, stiffness: 100 };

// The debug overlay (raw and smoothed heading, accuracies, declination) opens and closes
// with a long press on the "Finding" pill (ArTopBar); hidden by default, and a tap never
// opens it. The tuning constants it helps with live at the top of utils/arHeading.js,
// utils/arPosition.js and utils/landmarkAnchorEngine.js.
const DEBUG_REFRESH_MS = 250;
// Declination changes by well under 0.1 deg over a few km, so it is worked out again only
// when the position moves this far (in degrees of latitude/longitude, ~1 km).
const DECLINATION_GRID_DEG = 0.01;

// The Emergency button stands above AR Scan at the bottom left, 5 rem up and 5 rem tall
// (SosTrigger: bottom-20, h-20), on the gesture bar's inset. AR Scan's own bottom content (the
// start screen's buttons, the readout) sits above it, with 1 rem to spare.
export const CLEAR_OF_EMERGENCY_BUTTON = 'var(--emergency-clearance)';
// While the target picker is up the HUD gives way to it: it fades out at once, and comes back only
// after the picker's sheet has left (PICKER_LEAVE_MS), so the two are never on screen together.
const HUD_FADE_MS = 150;
const PICKER_LEAVE_MS = 300;
// A transparent 1 px picture. The Android WebView draws its own big "play" placeholder over a video
// with no poster until the camera's first frame arrives; a poster that shows nothing stops that.
const NO_POSTER = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

const fmtDeg = (v, digits = 1) => (Number.isFinite(v) ? `${v.toFixed(digits)}°` : '--');
const fmtSigned = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}°`;

// Why an ALIGN tap was refused (computeAlignment's reasons), in plain words (copy/arScan.js).
const ALIGN_REFUSALS = AR_ALIGN.refused;

// The app session's storage, where the ALIGN correction is kept; null where it is blocked.
const sessionStore = () => {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

// speedMps: raw m/s from geolocation (App.jsx's liveSpeed).
// squadMembers / buildings: what the floating tags can label (roster entries and
// SRM_MASTER_DATABASE); selfUid keeps this phone's own user off them.
// routePath: the walking route to draw on the ground, only when AR Scan is on the squad's
// Rally Point (see arRoutePathFor); null otherwise.
// fidelity: sysConfig.arFidelity (AR_RENDER_MODE), the main dial.
// overrides: sysConfig.arFeatureOverrides, each feature's own setting ('auto' follows the
// dial). Together they give each feature's fidelity (resolveArFeatures), which is all
// that is read below:
//   arrow: 'realistic' is the three.js arrow, anything else the CSS one (see the ring).
//   roadLine: 'realistic' is the three.js road (ARRoadGL), 'off' none, anything else the
//     Stage 3 ribbon.
//   tags: 'off' hides the ambient tags. The destination's own tag stays: it is part of
//     finding the way, as the arrow is.
// Every tag is placed by the Landmark Anchor Engine (utils/landmarkAnchorEngine.js),
// rendered by ARLandmarkLayer; this component only gathers its inputs.
// onCameraStarted: called once the camera has actually started (App notes it, so the camera
// explainer stops showing).
// onChooseTarget: aims AR Scan somewhere else, from its target picker; meetingPoint: the
// group's meeting point, offered first among the picker's places.
const ARCompass = ({ target, liveLocation: sharedLocation, speedMps = 0, squadMembers = [], buildings = [], selfUid = null, routePath = null, fidelity = 'standard', overrides, onClose, onCameraStarted, onChooseTarget = null, meetingPoint = null }) => {
  const videoRef = useRef(null);
  const [cameraError, setCameraError] = useState(false);
  // The camera's picture is shown only once it is playing (its first frame has arrived).
  const [videoPlaying, setVideoPlaying] = useState(false);
  const features = resolveArFeatures(fidelity, overrides);
  const roadPath = features.roadLine === 'off' ? null : routePath;
  // Where the phone is: AR Scan's own accuracy-gated, filtered fix (useArPosition), or
  // App's shared one until that has a fix. Everything below measures from it.
  const { position: liveLocation, accuracy: gpsAccuracy, lowAccuracy } = useArPosition(sharedLocation);
  // The compass, read as a camera (the phone held up; see useDeviceHeading), plus the
  // phone's live tilt: the tags are anchored through it in every mode (the destination's
  // tag is always drawn), as is the 3D road.
  const { heading: magneticHeading, hasReading, tilt, permissionsGranted, requestHeadingPermission, calibrationNeeded, diagnosticsRef } =
    useDeviceHeading({ camera: true, tilt: true });
  // The one-tap ALIGN correction (computeAlignment), kept for the app session.
  const [alignment, setAlignment] = useState(() => loadAlignment(sessionStore()));
  const changeAlignment = (next) => {
    setAlignment(next);
    saveAlignment(sessionStore(), next);
  };
  // The compass reads magnetic north; bearings, maps and the GPS course are true north.
  // The World Magnetic Model gives the difference here (about -1 deg around SRM).
  const declLat = liveLocation ? Math.round(liveLocation.lat / DECLINATION_GRID_DEG) * DECLINATION_GRID_DEG : null;
  const declLng = liveLocation ? Math.round(liveLocation.lng / DECLINATION_GRID_DEG) * DECLINATION_GRID_DEG : null;
  const declination = useMemo(() => {
    if (declLat === null) return 0;
    const d = magneticDeclination(declLat, declLng);
    return Number.isFinite(d) ? d : 0;
  }, [declLat, declLng]);
  // Only a real reading is corrected: before one arrives the hook's 0 is a placeholder
  // ("no compass"), not magnetic north. ALIGN's heading correction is a compass error,
  // so it goes on the compass alone, never on the GPS course below.
  const compassHeading = hasReading
    ? (((magneticHeading + declination + alignment.headingOffsetDeg) % 360) + 360) % 360
    : magneticHeading;
  // Where the camera points: the phone's own (already smoothed) heading, always. AR Scan used to
  // take the map marker's GPS course while walking, so panning the phone sideways mid-step left
  // the arrow and tags placed as if it faced the way you walked, up to 90 deg off (2026-10-29).
  const heading = compassHeading;

  // Too dark for labels (hooks/useCameraDarkness.js): sampled only while the camera runs.
  // Only the labels hide; the arrow, road line, readout and controls stay.
  const tooDark = useCameraDarkness(videoRef, permissionsGranted && !cameraError);

  // 1. Initialize Camera
  // The stream is kept here, not only on the <video>: that element doesn't exist yet when AR Scan
  // first draws (the start screen), so the cleanup that read it found nothing to stop, and the
  // camera (and the phone's green camera dot) stayed on after AR Scan closed (a fix, 2026-10-29).
  const streamRef = useRef(null);
  const closedRef = useRef(false);
  const attachStream = () => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream || video.srcObject === stream) return;
    video.srcObject = stream;
    video.play?.()?.catch?.(() => {});
  };
  const startCamera = async () => {
    try {
      // Started once per opening: a second request reuses the stream already running.
      const stream = streamRef.current ?? await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      // AR Scan closed while the camera was being asked for: let it go at once.
      if (closedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      attachStream();
      setCameraError(false);
      onCameraStarted?.();
    } catch (err) {
      console.warn("AR Scan: the camera is unavailable; carrying on without it.", err);
      setCameraError(true);
    }
  };

  const requestPermissions = async () => {
    const granted = await requestHeadingPermission();
    if (!granted) notify.warning(AR_ALIGN.compassRefused);
    startCamera();
  };

  // The camera view appears once permissions are in: give it the stream if it arrived first.
  useEffect(() => { attachStream(); });

  // Cleanup on unmount (device orientation listeners are torn down by useDeviceHeading itself):
  // the camera stops, whichever screen AR Scan was on.
  useEffect(() => {
    closedRef.current = false;
    return () => {
      closedRef.current = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  // Math variables. The bearing is true (initial great-circle bearing), as is `heading`.
  const bearing = (liveLocation && target) ? calculateBearing(liveLocation.lat, liveLocation.lng, target.lat, target.lng) : 0;
  const distance = (liveLocation && target) ? calculateDistance(liveLocation.lat, liveLocation.lng, target.lat, target.lng) : 0;

  // The road line is drawn in real pixels (its widths are pixel widths), so it needs the
  // screen's size; AR Scan is full-screen, so that is the window's.
  // The tags' top limit comes with it: the status bar's height plus a gap, read now (rotation moves it).
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight, topMarginPx: AR_TAG_TOP_SAFE_MARGIN_PX() }));
  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight, topMarginPx: AR_TAG_TOP_SAFE_MARGIN_PX() });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // The camera stream's own size, once it plays: with the screen's, it gives the field
  // of view actually on screen (effectiveHorizontalFov), which the tags, the road and the
  // destination's tag all use, so they line up with the picture.
  const [videoSize, setVideoSize] = useState(null);
  const onVideoSize = useCallback((e) => {
    const { videoWidth, videoHeight } = e.currentTarget;
    if (videoWidth > 0 && videoHeight > 0) {
      setVideoSize((prev) => (prev && prev.width === videoWidth && prev.height === videoHeight ? prev : { width: videoWidth, height: videoHeight }));
    }
  }, []);
  const fovDeg = effectiveHorizontalFov({
    videoWidth: videoSize?.width,
    videoHeight: videoSize?.height,
    screenWidth: viewport.width,
    screenHeight: viewport.height,
  });

  // 'realistic' mode's road: a real-world strip on the ground (buildRoadStrip), rebuilt
  // only when the position or the route changes (turning just turns the camera). The
  // three.js canvas exists only while there is a strip. Until it is drawing, and for good
  // if WebGL fails, the Stage 3 ribbon stands in, as the CSS arrow does for the arrow.
  const realistic = features.roadLine === 'realistic';
  const liveLat = liveLocation?.lat;
  const liveLng = liveLocation?.lng;
  const strip = useMemo(() => {
    if (!realistic || !roadPath) return null;
    const origin = { lat: liveLat, lng: liveLng };
    return buildRoadStrip(remainingRouteSamples(roadPath, origin), origin);
  }, [realistic, roadPath, liveLat, liveLng]);
  const [roadGl, setRoadGl] = useState('loading');
  // A failure is final for this AR Scan session; the canvas's unmount doesn't undo it.
  const onRoadGlStatus = useCallback((next) => setRoadGl((prev) => (prev === 'failed' ? prev : next)), []);
  const roadGlDrawing = Boolean(strip) && roadGl === 'ready';
  // The world camera: the phone's real tilt, facing AR Scan's heading (FALLBACK_PITCH_DEG
  // down with no live tilt), tipped by ALIGN's pitch correction. Everything over the
  // camera is drawn through it: the tags, the 3D road and the ribbon, so they agree.
  const pitchOffsetDeg = alignment.pitchOffsetDeg;
  const orientation = useMemo(
    () => applyAlignment(cameraQuaternion({ heading, tilt }), { pitchOffsetDeg }),
    [heading, tilt, pitchOffsetDeg],
  );

  const ribbon = roadPath && !roadGlDrawing
    ? buildRoadRibbon({
      origin: liveLocation,
      heading,
      path: roadPath,
      screenWidth: viewport.width,
      screenHeight: viewport.height,
      fovDeg,
      projectGround: (lat, lng) => {
        const at = projectGroundPoint({ q: orientation, width: viewport.width, height: viewport.height, origin: liveLocation, lat, lng, horizontalFovDeg: fovDeg });
        return at && { x: at.x * viewport.width, y: at.y * viewport.height };
      },
    })
    : null;

  // The Landmark Anchor Engine's inputs. Landmarks: the buildings (arLandmarks.js), squad
  // members with a fix (not this phone's user), and the destination, id 'target': anchored
  // like its building when it is one, at chest height for a member, on the ground
  // otherwise (a Rally Point, where the road ends). Ambient ones only when tags are on.
  const buildingLandmarks = useMemo(() => buildArLandmarks(buildings), [buildings]);
  const showAmbient = features.tags !== 'off';
  const landmarks = useMemo(() => {
    const targetBuilding = target
      ? buildingLandmarks.find((b) => b.name === target.name && calculateDistance(b.lat, b.lng, target.lat, target.lng) < 100)
      : null;
    const isTargetMember = (m) => Boolean(target && (target.memberUid ? m.uid === target.memberUid : target.memberId && m.id === target.memberId));
    const list = !showAmbient ? [] : [
      ...squadMembers
        .filter((m) => m && m.hasFix && m.lat != null && m.lng != null && !(selfUid && m.uid === selfUid) && !isTargetMember(m))
        .map((m) => ({ id: `member-${m.id}`, kind: 'member', name: m.name || 'SQUAD_NODE', lat: m.lat, lng: m.lng, heightM: null })),
      ...buildingLandmarks.filter((b) => b !== targetBuilding),
    ];
    if (target && target.lat != null && target.lng != null) {
      list.push({
        id: 'target',
        kind: 'target',
        building: Boolean(targetBuilding),
        name: target.name,
        lat: targetBuilding ? targetBuilding.lat : target.lat,
        lng: targetBuilding ? targetBuilding.lng : target.lng,
        heightM: targetBuilding
          ? (targetBuilding.heightM ?? DEFAULT_BUILDING_HEIGHT_M)
          : (target.memberUid || target.memberId) ? PERSON_HEIGHT_M : 0,
        anchorOffsetM: targetBuilding?.anchorOffsetM ?? null,
        footprint: targetBuilding?.footprint ?? null,
      });
    }
    return list;
  }, [buildingLandmarks, squadMembers, selfUid, target, showAmbient]);
  const engineLat = liveLocation?.lat;
  const engineLng = liveLocation?.lng;
  const enginePosition = useMemo(
    () => (engineLat == null ? null : { lat: engineLat, lng: engineLng, accuracy: gpsAccuracy }),
    [engineLat, engineLng, gpsAccuracy],
  );
  const engineView = useMemo(
    () => ({ q: orientation, hFovDeg: fovDeg, width: viewport.width, height: viewport.height, topMarginPx: viewport.topMarginPx, targetId: target ? 'target' : null }),
    [orientation, fovDeg, viewport.width, viewport.height, viewport.topMarginPx, target],
  );
  const landmarkFrameRef = useRef(null);

  // One-tap ALIGN: the user centres a building and taps; the building nearest the centre
  // of the view is taken to be the one they mean (see computeAlignment).
  const align = () => {
    if (speedMps > GPS_HEADING_SPEED_MPS) {
      notify.warning(ALIGN_REFUSALS.walking);
      return;
    }
    const tags = (landmarkFrameRef.current?.tags ?? []).filter((t) => t.building && t.visible);
    const tag = tags.reduce((best, t) => (!best || Math.hypot(t.camAzDeg, t.camElDeg) < Math.hypot(best.camAzDeg, best.camElDeg) ? t : best), null);
    const result = computeAlignment({ tag, accuracyM: gpsAccuracy, current: alignment });
    if (!result.ok) {
      notify.warning(ALIGN_REFUSALS[result.reason]);
      return;
    }
    changeAlignment(result.alignment);
    notify.success(AR_ALIGN.aligned(tag.name));
  };
  const aligned = alignment.headingOffsetDeg !== 0 || alignment.pitchOffsetDeg !== 0;

  // The footer's distance, held until it has moved DISTANCE_DEADBAND_M, so a fix wobbling
  // by a metre doesn't flicker it. Stored from the previous render (React's "adjust state
  // while rendering" pattern). The tags' own distances come from the engine, which only
  // works them out again once the phone has moved POSITION_EPSILON_M.
  const [shownDistance, setShownDistance] = useState(distance);
  const nextShownDistance = stickyDistance(shownDistance, distance);
  if (nextShownDistance !== shownDistance) setShownDistance(nextShownDistance);

  // The readout's direction: a clock face ("2 o'clock") while the compass has a steady
  // reading, otherwise compass words ("to the north-east"), which need no compass. And
  // "about N min on foot", only along a real route (routePath is only ever a real one):
  // what is left of it from here. Without one, distance and direction only.
  const headingSteady = hasReading && !calibrationNeeded && Number.isFinite(heading);
  const readoutDirection = liveLocation
    ? directionLabel({
      here: distance < HERE_METRES,
      clock: headingSteady ? relativeClock(bearing, heading) : null,
      direction: `BEARING ${compassPoint(bearing)}`,
    })
    : '';
  const routeLeftM = useMemo(() => {
    const left = remainingPath(routePath, liveLocation);
    let metres = 0;
    for (let i = 1; i < left.length; i++) metres += calculateDistance(left[i - 1].lat, left[i - 1].lng, left[i].lat, left[i].lng);
    return left.length >= 2 ? metres : null;
  }, [routePath, liveLocation]);
  const readoutWalk = routeLeftM !== null ? walkLabel(routeLeftM) : '';

  // Debug overlay: hidden until a long-press on the title. While open it copies the
  // compass hook's diagnostics a few times a second (they live in a ref, updated per
  // sensor event, so reading them doesn't re-render AR Scan 60 times a second).
  const [debugOpen, setDebugOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [debugSnapshot, setDebugSnapshot] = useState(null);
  useEffect(() => {
    if (!debugOpen) return undefined;
    const copy = () => {
      const f = landmarkFrameRef.current;
      setDebugSnapshot({
        ...(diagnosticsRef.current ?? {}),
        engine: f && {
          hFovDeg: f.hFovDeg,
          vFovDeg: f.vFovDeg,
          pitchDeg: f.pitchDeg,
          rollDeg: f.rollDeg,
          tags: f.tags.slice(-6).reverse().map((t) => ({ name: t.labelName, x: t.screenX, y: t.screenY, edge: t.offscreenSide, occluded: t.occluded })),
        },
      });
    };
    const timer = setInterval(copy, DEBUG_REFRESH_MS);
    return () => clearInterval(timer);
  }, [debugOpen, diagnosticsRef]);

  // --- WRAPAROUND-SAFE ROTATION ---
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

  // AR Scan's own start screen, every time it opens: its tap is what starts the compass and
  // the camera (a sensor permission must come from a tap). Shown in the app's theme.
  if (!permissionsGranted) {
    return (
      <div data-testid="ar-start" className="fixed inset-0 bg-bg text-text font-ui flex flex-col px-5" style={{ zIndex: LAYER.arScan, paddingTop: 'env(safe-area-inset-top)', paddingBottom: CLEAR_OF_EMERGENCY_BUTTON }}>
        {/* Centred while it fits; on a short phone with large text it scrolls instead of running
            off the top or into the buttons (my-auto centres without overflowing). Under 700 px
            high its picture goes, as the guide's does. */}
        <div data-testid="ar-start-body" className="flex-1 min-h-0 overflow-y-auto flex flex-col max-w-md w-full mx-auto">
          <div className="my-auto flex flex-col items-center text-center gap-3 py-4">
            <span className="flex [@media(max-height:699px)]:hidden items-center justify-center w-22 h-22 rounded-full bg-accent-soft text-accent mb-3" aria-hidden="true">
              <ScanLine size={40} />
            </span>
            <h2 className="text-display">{AR_START.title}</h2>
            <p className="text-body text-text-secondary">{AR_START.body(target.name)}</p>
          </div>
        </div>
        <div className="max-w-md w-full mx-auto flex flex-col gap-2">
          <Button block size="large" onClick={requestPermissions}>{AR_START.start}</Button>
          <Button variant="plain" block onClick={onClose}>{AR_START.cancel}</Button>
        </div>
      </div>
    );
  }

  return (
    <div ref={setOverlayEl} data-testid="ar-scan" className="fixed inset-0 bg-black overflow-hidden pointer-events-auto" style={{ zIndex: LAYER.arScan }}>
      {/* Video Background */}
      <video 
        ref={videoRef}
        autoPlay
        muted
        playsInline
        controls={false}
        disablePictureInPicture
        poster={NO_POSTER}
        data-testid="ar-video"
        data-playing={videoPlaying ? 'true' : 'false'}
        onPlaying={() => setVideoPlaying(true)}
        onLoadedMetadata={onVideoSize}
        onResize={onVideoSize}
        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-1000 ${cameraError || !videoPlaying ? 'opacity-0' : 'opacity-100'}`}
      />

      {/* The route to the Rally Point, on the ground: under the HUD and the tags. */}
      {ribbon && <ARRoadLine ribbon={ribbon} width={viewport.width} height={viewport.height} />}
      {strip && roadGl !== 'failed' && <ARRoadGL strip={strip} orientation={orientation} fovDeg={fovDeg} onStatus={onRoadGlStatus} />}

      {/* The faint centre mark: the exact middle of the whole screen, the point ALIGN
          lines a building up with. Under the tags; it takes no touches. */}
      <div
        data-testid="ar-centre-mark"
        className="ar-centre-mark absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full pointer-events-none z-[24]"
        aria-hidden="true"
      />

      {/* Floating tags, anchored on the real buildings by the Landmark Anchor Engine.
          Above the arrow ring, below nothing tappable (they take no touches). */}
      <div data-testid="ar-labels" data-too-dark={tooDark || undefined} className={`absolute inset-0 overflow-hidden pointer-events-none z-[25] ${tooDark ? 'invisible' : ''}`} aria-hidden="true">
        <ARLandmarkLayer landmarks={landmarks} position={enginePosition} view={engineView} frameRef={landmarkFrameRef} />
      </div>

      {/* Debug overlay (long-press AR_TRACKER): the numbers to tune on a real walk.
          Headings: RAW and SMOOTH are the compass's own (magnetic); TRUE is what the
          arrow and tags use (plus declination, or the GPS course while walking). Above
          the tags, which would otherwise cover it. */}
      {debugOpen && (
        <div
          data-testid="ar-debug-overlay"
          className="ar-plate absolute left-6 top-36 z-[40] whitespace-pre rounded-input border border-border px-3 py-2 font-mono text-[10px] leading-4 text-text pointer-events-none"
        >
          <div className="font-ui font-semibold text-[11px] text-text-secondary mb-1">Debug</div>
          <div>RAW_HDG  {fmtDeg(debugSnapshot?.raw)} MAG</div>
          <div>SMOOTH   {fmtDeg(debugSnapshot?.smoothed)} MAG{debugSnapshot?.fast ? ' FAST' : ''}</div>
          <div>TRUE_HDG {fmtDeg(heading)}</div>
          <div>DECL     {fmtDeg(declination, 2)}</div>
          <div>SENSOR   {debugSnapshot?.source ?? '--'}</div>
          <div>SNS_ACC  {Number.isFinite(debugSnapshot?.accuracy) ? fmtDeg(debugSnapshot.accuracy) : 'N/A'}</div>
          <div>JITTER   {fmtDeg(debugSnapshot?.jitter, 2)}{calibrationNeeded ? ' CAL' : ''}</div>
          <div>GPS_ACC  {Number.isFinite(gpsAccuracy) ? `${Math.round(gpsAccuracy)} M` : '--'}</div>
          <div>FOV_H/V  {fmtDeg(debugSnapshot?.engine?.hFovDeg)} / {fmtDeg(debugSnapshot?.engine?.vFovDeg)}</div>
          <div>PITCH    {fmtDeg(debugSnapshot?.engine?.pitchDeg)}  ROLL {fmtDeg(debugSnapshot?.engine?.rollDeg)}</div>
          <div>ALIGN    HDG {fmtSigned(alignment.headingOffsetDeg)}  PITCH {fmtSigned(alignment.pitchOffsetDeg)}</div>
          <div>TGT_ANG  {fmtDeg(normalizeRotationDelta(bearing, heading))}</div>
          {(debugSnapshot?.engine?.tags ?? []).map((t) => (
            <div key={t.name}>
              {`${t.name.slice(0, 12).padEnd(12)} ${Math.round(t.x)},${Math.round(t.y)}${t.edge ? ` ${t.edge.toUpperCase()}` : ''}${t.occluded ? ' OCC' : ''}`}
            </div>
          ))}
        </div>
      )}

      {/* The HUD. It sets no stacking order of its own, so its parts layer against the labels
          (z-25) one by one: the controls, notices and readout above them (z-30), so a label
          never covers words or a button; the arrow below them (z-22), as the labels have
          always been drawn over it. */}
      <div
        data-testid="ar-ui"
        data-picker-open={pickerOpen ? 'true' : undefined}
        inert={pickerOpen}
        className="relative w-full h-full flex flex-col p-6"
        // Clear of the status bar (the same strip Settings covers) and of the Emergency button. While
        // the target picker is open the HUD is hidden and takes no touches, so nothing of it shows
        // through the picker or is left under it as its sheet leaves.
        style={{
          paddingTop: 'calc(var(--top-cover-height) + 1.5rem)',
          paddingBottom: CLEAR_OF_EMERGENCY_BUTTON,
          opacity: pickerOpen ? 0 : 1,
          pointerEvents: pickerOpen ? 'none' : undefined,
          transition: `opacity ${HUD_FADE_MS}ms ease ${pickerOpen ? 0 : PICKER_LEAVE_MS}ms`,
        }}
      >
        <div data-testid="ar-top" className="relative z-[30] flex flex-col">

          {/* Close, what AR Scan is finding, and ALIGN (components/ar/ArTopBar.jsx). A long press
              on the pill opens the debug overlay; a tap never does. */}
          <ArTopBar
            targetName={target.name}
            onClose={onClose}
            onPick={onChooseTarget ? () => setPickerOpen(true) : null}
            onAlign={align}
            aligned={aligned}
            onReset={() => changeAlignment(NO_ALIGNMENT)}
            onDebug={() => setDebugOpen((open) => !open)}
          />

          {/* Calibration notice: only while the compass looks unreliable (useDeviceHeading's
              calibrationNeeded, which already has its own show/hide hysteresis), fading in
              and out. It keeps its space when hidden, so the layout never jumps. */}
          <ArNotice
            testId="ar-calibration-banner"
            icon={Compass}
            title={AR_NOTICES.calibrate.title}
            body={AR_NOTICES.calibrate.body}
            visible={calibrationNeeded}
          />

          {/* Camera off (refused, or no camera): the arrow and readout carry on over a dark
              screen; the steps to allow it are in words. */}
          {cameraError && (
            <ArNotice
              testId="ar-camera-off"
              icon={CameraOff}
              title={AR_NOTICES.cameraOff.title}
              body={AR_NOTICES.cameraOff.body}
              steps={AR_NOTICES.cameraOff.steps}
            />
          )}

          {/* Too dark: the labels are hidden until there's more light (useCameraDarkness). */}
          {tooDark && (
            <ArNotice
              testId="ar-too-dark"
              icon={MoonStar}
              title={AR_NOTICES.tooDark.title}
              body={AR_NOTICES.tooDark.body}
            />
          )}
        </div>

        {/* Central Compass Area */}
        <div className="flex-1 flex flex-col items-center justify-center relative">
          
          {/* The arrow's box, and the destination arrow turning inside it by the same
              wraparound-safe angle and spring as before. The box draws nothing (the old red
              ring and crosshair are gone); the realistic arrow sizes itself to it. The arrow
              depends on its resolved fidelity (AR_RENDER_MODE, or its override): 'efficient'
              and 'standard' (and anything unknown) get the CSS 3D wedge; 'realistic' gets
              the three.js arrow (RealisticArrow), which loads three.js only then. */}
          <div
            ref={ringRef}
            data-testid="ar-arrow-ring"
            data-fidelity={features.arrow}
            className="w-48 h-48 flex items-center justify-center relative z-[22]"
          >
            {/* No arrow while the fix is too rough to aim from (useArPosition's lowAccuracy). */}
            {lowAccuracy ? null : features.arrow === 'realistic' ? (
              <RealisticArrow rotation={displayRotation} spring={ARROW_SPRING} ringRef={ringRef} overlayEl={overlayEl} />
            ) : (
              <ARArrow3D rotation={displayRotation} transition={ARROW_SPRING} />
            )}
          </div>

        </div>

        {/* The readout: how far, large; which way; and the walk, only along a real route.
            On a plate at the bottom of the HUD, which keeps clear of the Emergency button
            (CLEAR_OF_EMERGENCY_BUTTON). The pill above already names the destination. */}
        <div
          data-testid="ar-readout"
          role="status"
          aria-label={AR_READOUT.label(target.name)}
          className="ar-plate relative z-[30] mt-auto self-center rounded-card border border-border shadow-[var(--shadow-2)] px-5 py-3 flex flex-col items-center text-center font-ui text-text max-w-full"
        >
          {!liveLocation
            ? <p data-testid="ar-readout-no-fix" className="text-body font-semibold">{AR_READOUT.noFix}</p>
            : lowAccuracy
              ? <p data-testid="ar-readout-rough" className="text-body font-semibold">{AR_READOUT.lowAccuracy}</p>
              : <p data-testid="ar-readout-distance" className="text-[40px] leading-none font-semibold tabular-nums">{distanceLabel(formatMetres(shownDistance))}</p>}
          {!lowAccuracy && (readoutDirection || readoutWalk) && (
            <p data-testid="ar-readout-way" className="mt-1.5 text-secondary text-text-secondary">
              {[readoutDirection, readoutWalk].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>

      </div>

      {/* What to find (components/ar/ArTargetPicker.jsx), from the Finding pill. */}
      {onChooseTarget && (
        <ArTargetPicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          me={liveLocation}
          target={target}
          members={squadMembers}
          buildings={buildings}
          meetingPoint={meetingPoint}
          selfUid={selfUid}
          onChoose={onChooseTarget}
        />
      )}
    </div>
  );
};

export default ARCompass;
