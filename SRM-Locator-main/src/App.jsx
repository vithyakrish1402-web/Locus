import { io } from "socket.io-client";
import { Capacitor } from '@capacitor/core';
import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, Suspense } from 'react';
// `motion` is used throughout via <motion.div>/<motion.nav> JSX member expressions.
// This project's eslint config has no eslint-plugin-react (only react-hooks/react-refresh),
// so core no-unused-vars can't see through JSXMemberExpression tag names — false positive.
// eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence, useDragControls, useReducedMotion, useMotionValue, animate as animateMotion } from 'framer-motion';
import GoogleMapReact from 'google-map-react';
import {
  Users, Search, Settings, Navigation, ShieldCheck,
  Building2, MessageSquare, Send, Loader2,
  BrainCircuit, UserCheck, Ban, LogOut, LockKeyhole, Eye, EyeOff, ArrowRight, X,
  Wifi, WifiOff, Bluetooth, Radio, LocateFixed, Activity,
  AlertCircle, Check, Map, Battery, Zap, Bell, ShieldAlert, Terminal, Route, Crosshair, Trash2, Scan, RefreshCw, Layers, Undo2
} from 'lucide-react';
// ... your other imports (React, framer-motion, lucide-react, etc.)


//  ADD THIS LINE RIGHT HERE
import Guide from './components/guide/Guide';
import { guideSeen, rememberGuideSeen } from './utils/guideSeen';
import BrandMark from './components/access/BrandMark';
import BootScreen from './components/access/BootScreen';
import StatusScreen from './components/access/StatusScreen';
import { Avatar, Button, Card, IconButton, InlineMessage, SegmentedControl, TextField } from './components/ui';
import PlaceCard from './components/PlaceCard';
import MeetingPointConfirm from './components/MeetingPointConfirm';
import { SETTINGS } from './copy/settings';
import { SETTINGS_Z } from './components/settings/SettingsScreen';
import SettingsHost from './components/settings/SettingsHost';
import { setSettingsOpen, isSettingsOpen } from './utils/settingsOpen';
import { sectionSwipe } from './utils/panelSwipe';
import { isInAppDnd } from './utils/inAppDnd';
import { hasNativeAlertSound, playAlertSound, shareInAppDnd, dndAccessGranted, openDndAccessSettings } from './utils/alertSound';

// The one-time explanation of Do Not Disturb access is shown once per phone.
const DND_EXPLAINED_KEY = 'locus.dndExplained';
const dndExplainedBefore = () => {
  try { return window.localStorage?.getItem(DND_EXPLAINED_KEY) === '1'; } catch { return true; }
};
const rememberDndExplained = () => {
  try { window.localStorage?.setItem(DND_EXPLAINED_KEY, '1'); } catch { /* shown again next time */ }
};
import { SharingChip, TopBar } from './components/map/TopBar';
import { MapControls, MeetingPointButton } from './components/map/MapControls';
import { BELOW_TOP_BAR } from './utils/mapChrome';
import { trimRouteBehind } from './utils/routeTrim';
import RouteCard from './components/map/RouteCard';
import {
  TurnInstructionCard,
  ArrivalPanel,
} from './components/navigation/NavigationHUD';
import { useNavigationController } from './hooks/useNavigationController';
import BuildingRow from './components/map/BuildingRow';
import GroupHeader from './components/group/GroupHeader';
import SharingControl from './components/group/SharingControl';
import MemberOptions from './components/group/MemberOptions';
import LeadTools from './components/group/LeadTools';
import LocationsTable from './components/group/LocationsTable';
import AdminTools, { RecordingBar } from './components/admin/AdminTools';
import AddPlaceSheet, { PlacingBar } from './components/admin/AddPlace';
import { ADD_PLACE_PROBLEMS } from './copy/addPlace';
import { useCampusPlaces } from './hooks/useCampusPlaces';
import { isGrounds, placeMatches } from './utils/campusPlaces';
import JoinRequests from './components/group/JoinRequests';
import ActivityLog from './components/group/ActivityLog';
import BlockedList from './components/group/BlockedList';
import FriendRequests from './components/group/FriendRequests';
import { useFriends } from './hooks/useFriends';
import { exportActivityLog } from './utils/activityLogExport';
import PeekLines from './components/group/PeekLines';
import PanelStops from './components/group/PanelStops';
import { MembersEmpty, MembersHeading, MembersLoading } from './components/group/MembersHeading';
import { panelStops, snapPanel, SHEET_BOTTOM_PADDING_PX } from './utils/panelHeights';
import { LeaveGroupButton, LeaveGroupConfirm } from './components/group/LeaveGroup';
import { GROUP_TABS, MEMBERS as GROUP_MEMBERS, MEMBERS_LIST as GROUP_MEMBERS_LIST, BUILDINGS_LIST as GROUP_BUILDINGS_LIST, REFRESH_FAILED, SOS_CONTROLS, ROLE_REFUSED, ACTIVITY_LOG, LEAD_TOOLS, FRIENDS } from './copy/group';
import { FindingLocation, LocationProblemCard, MeetingPointBanner } from './components/map/MapBanners';
import { TABS } from './copy/map';
import { mapStylesFor } from './utils/mapStyles';
import MemberMarker from './components/MemberMarker';
import { MARKERS } from './copy/map';
import { distanceLabel } from './copy/place';
import { useResolvedTheme } from './theme/useResolvedTheme';
import { registerThemeSettle, registerThemePrepare } from './theme/theme';
import CameraExplainer from './components/CameraExplainer';
import LocationExplainer from './components/LocationExplainer';
import { locationKnownAllowed, locationPermissionGranted, rememberLocationAllowed } from './utils/locationPermission';
import { cameraKnownAllowed, cameraPermissionGranted, rememberCameraAllowed } from './utils/cameraPermission';
import { NOTICES, OS_NOTICES } from './copy/notices';
import { AUTH_PROBLEMS, CREATE_ACCOUNT, LOBBY, NOT_APPROVED, RESET, RESUME, SIGN_IN, WAITING, YOURE_IN, firstNameOf } from './copy/access';
import { authProblem } from './utils/authProblems';
import ARCompass from './ARCompass';
import { arTargetForMember, followArTarget } from './utils/arTags';
import { arRoutePathFor } from './utils/arRoadLine';
import { useDeviceHeading } from './hooks/useDeviceHeading';
import { DEFAULT_AR_FEATURE_OVERRIDES } from './utils/arFeatures';

import { useLiveHeading } from './hooks/useLiveHeading';
import { useWaypointNavigationLine, ROUTE_COLOR, ROUTE_CASING_COLOR } from './hooks/useWaypointNavigationLine';
import { useWalkingRoute } from './hooks/useWalkingRoute';
import { formatDistanceMeters, formatDurationMinutes } from './utils/walkingRoute';
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
import { locateTarget, sortByDistance } from './utils/direction';
import { notify, dismiss as dismissNotice } from './utils/notify';
import { logNavBuild } from './utils/navBuild';
import { rallyAction, rallyIsAt } from './utils/rallyAction';
import { mapEngineStatus } from './utils/mapEngineStatus';
import { focusMapOn, registerMapDriver, MAP_FOCUS_BUILDING_ZOOM, MAP_FOCUS_RALLY_ZOOM, FOCUS_ZOOM_LEVEL, FOCUS_HIGHLIGHT_MS } from './utils/mapFocus';
import { useIncomingSos } from './hooks/useIncomingSos';
import { useClosedAppSos } from './hooks/useClosedAppSos';
import { useAppUpdate } from './hooks/useAppUpdate';
import { useLiveUpdate } from './hooks/useLiveUpdate';
import { useBackButtonGuard } from './hooks/useBackButtonGuard';
import { pushBackHandler } from './utils/backHandlers';
import { useBlurOnKeyboardHide } from './hooks/useBlurOnKeyboardHide';
import { useWifiFusion } from './hooks/useWifiFusion';
import { useBackgroundSharing } from './hooks/useBackgroundSharing';
import { stopBackgroundSharing, LocusBackground } from './utils/backgroundSharing';
import { rememberGroup, rememberedGroup, forgetGroup } from './utils/rememberedGroup';
import { useIndoorView } from './hooks/useIndoorView';
import { WIFI_POSITIONING_ENABLED, SHOW_INDOOR_POSITION_TO_SQUAD } from './utils/positionSource';
import { buildingAt, isOnOtherFloor, memberFloorTag } from './utils/indoorView';
import { ConfidenceHalo, FloorTag } from './components/IndoorMarkers';
import FloorPicker from './components/FloorPicker';
import WifiReadout from './components/WifiReadout';
import { useIsMobile } from './hooks/useIsMobile';
import { haptic } from './utils/haptics';
import { SHEET_SPRING, PANEL_SPRING, fade } from './utils/motion';
import { LAYER } from './utils/layers';
import { deriveGhostMembers, GHOST_FADE_MS } from './utils/ghostProjection';
import { generateRandomSquadCode } from './utils/squadCode';
import { createSosOutbox } from './utils/sosOutbox';
import { SOS_HELD, SOS_SENT, SOS_DROPPED, SOS_REFUSED } from './copy/emergency';

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

// The Emergency alert's way out (utils/sosOutbox.js): straight to the group when it can be
// reached, held until this phone is back in its group when it can't. One per app, like the socket.
const sosOutbox = createSosOutbox(socket);

// Baked in at Vite build time from .env's VITE_GOOGLE_MAPS_API_KEY (gitignored) —
// never hardcode this. The Capacitor/Android build reads the same key separately from
// android/local.properties (see AndroidManifest.xml's MAPS_API_KEY meta-data placeholder).
const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

// How long the old ping and lost-connection banners stayed up; their notices keep it.
const OLD_BANNER_MS = 6000;

if (!GOOGLE_MAPS_API_KEY) {
  // Say this out loud. Without a key Google would still "work" — it just renders a
  // watermarked "For development purposes only" map — which looks like an app bug
  // rather than a missing build secret. The app uses the keyless Leaflet engine
  // instead; this line explains why the map looks different from the Google one.
  console.warn(
    '[SYS_MAP] No VITE_GOOGLE_MAPS_API_KEY set — satellite will use the keyless Leaflet/Esri view. ' +
    'For Google satellite, put a billing-enabled Maps JavaScript API key in SRM-Locator-main/.env (see .env.example).'
  );
}

const SRM_KTR_COORDS = { lat: 12.8237, lng: 80.0444 };

// --- COMMANDER TELEMETRY SYNC ---
// How long SYNC_TELEMETRY waits for the server before saying it got no answer.
const TELEMETRY_SYNC_TIMEOUT_MS = 8000;
// What the server's refusals ('request-telemetry' in backend/server.js) mean to the Commander.
const TELEMETRY_SYNC_REFUSALS = {
  'not-owner': REFRESH_FAILED.notLead,
  'not-in-squad': REFRESH_FAILED.notInGroup,
};
// A telemetry value that is a real number, or null (never something toFixed() throws on).
// The square glass buttons down the map's right edge (recenter, locate, satellite, settings).
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
      return { text: `${percent}%`, color: percent < 20 ? 'text-warning' : 'text-success' }; // low: amber, never red
    }
  }
  return { text: 'UNKNOWN', color: 'text-text-secondary' };
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

// The roadmap's light and dark styles are in utils/mapStyles.js, chosen by the app's theme.

// --- LOADING AND SIGN-IN (redesign P3; words in src/copy/access.js) ---
// The loading screen is src/components/access/BootScreen.jsx.

// Which field a sign-in problem is about, so that field is outlined too. (A plain object:
// `Map` in this file is lucide's map icon.)
const PROBLEM_FIELD = {
  [AUTH_PROBLEMS.wrongCredentials]: 'password',
  [AUTH_PROBLEMS.weakPassword]: 'password',
  [AUTH_PROBLEMS.noAccount]: 'email',
  [AUTH_PROBLEMS.badEmail]: 'email',
  [AUTH_PROBLEMS.emailInUse]: 'email',
  [AUTH_PROBLEMS.missingEmailForReset]: 'email',
  [AUTH_PROBLEMS.missingName]: 'name',
};

// Sign in, create an account, and "reset link sent". A problem shows in an amber message above
// the fields, with the field it is about outlined; it used to be a notice in the corner that
// timed out. While signing in, the fields grey out and the button says so (it used to be a
// full-screen "LINKING..." overlay).
const AuthTerminal = ({
  email, setEmail, password, setPassword, showPassword, setShowPassword, executeAuthDirective, loginMethod, username, setUsername, latency
}) => {
  const [screen, setScreen] = useState('sign-in'); // 'sign-in' | 'create' | 'reset-sent'
  const [problem, setProblem] = useState(null);
  const busy = Boolean(loginMethod);
  const creating = screen === 'create';
  const problemField = problem ? PROBLEM_FIELD[problem] : undefined;
  const go = (next) => { setScreen(next); setProblem(null); };
  // Back from Create account or "reset link sent" returns to Sign in (it used to leave the app).
  const onSubScreen = screen !== 'sign-in';
  useEffect(() => {
    if (!onSubScreen) return undefined;
    return pushBackHandler(() => { setScreen('sign-in'); setProblem(null); return true; });
  }, [onSubScreen]);

  const handleForgotPassword = async () => {
    if (!email.trim()) {
      setProblem(AUTH_PROBLEMS.missingEmailForReset);
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email.trim());
      go('reset-sent');
    } catch (error) {
      console.error('Password reset error:', error.code);
      setProblem(authProblem(error, 'reset'));
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setProblem(null);
    setProblem(await executeAuthDirective('email', creating));
  };

  const words = creating ? CREATE_ACCOUNT : screen === 'reset-sent' ? RESET : SIGN_IN;
  const eye = (
    <IconButton
      label={showPassword ? SIGN_IN.hidePassword : SIGN_IN.showPassword}
      icon={showPassword ? EyeOff : Eye}
      onClick={() => setShowPassword(!showPassword)}
    />
  );

  return (
    <div
      className="relative min-h-[100dvh] bg-bg text-text font-ui px-5 flex flex-col"
      style={{ paddingTop: 'calc(env(safe-area-inset-top) + 3rem)', paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.5rem)' }}
    >
      {/* Round trip to the server, when one has been measured (after leaving a group). */}
      {latency > 0 && (
        <p className="absolute right-5 text-caption text-text-secondary tabular-nums" style={{ top: 'calc(env(safe-area-inset-top) + 1rem)' }}>
          {SIGN_IN.connection(latency)}
        </p>
      )}

      <main className="w-full max-w-md mx-auto flex-1">
        <BrandMark />
        <h1 className="mt-6 text-display">{words.title}</h1>
        <p className="mt-2 text-body text-text-secondary">{words.intro}</p>

        {screen === 'reset-sent' ? (
          <div className="mt-6 flex flex-col gap-5">
            <InlineMessage tone="success">
              {RESET.sent(email.trim()).map((part, i) => (i === 1 ? <strong key={i} className="font-semibold">{part}</strong> : part))}
            </InlineMessage>
            <TextField label={SIGN_IN.email} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            <Button block size="large" onClick={() => go('sign-in')}>{RESET.back}</Button>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-6 flex flex-col gap-5" noValidate>
            {problem && <InlineMessage>{problem}</InlineMessage>}
            {creating && (
              <TextField
                label={CREATE_ACCOUNT.name}
                hint={CREATE_ACCOUNT.nameHint}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                maxLength={15}
                autoComplete="name"
                invalid={problemField === 'name'}
                disabled={busy}
              />
            )}
            <TextField
              label={SIGN_IN.email}
              type="email"
              placeholder={SIGN_IN.emailPlaceholder}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              invalid={problemField === 'email'}
              disabled={busy}
            />
            <TextField
              label={SIGN_IN.password}
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={creating ? 'new-password' : 'current-password'}
              hint={creating ? CREATE_ACCOUNT.passwordHint : undefined}
              trailing={eye}
              invalid={problemField === 'password'}
              disabled={busy}
            />
            {!creating && (
              <div className="flex justify-end -mt-2">
                <Button variant="plain" onClick={handleForgotPassword} disabled={busy}>{SIGN_IN.forgotPassword}</Button>
              </div>
            )}
            <Button type="submit" block size="large" aria-busy={busy || undefined} icon={busy ? Loader2 : null} className={busy ? '[&>svg]:animate-spin' : ''}>
              {busy ? (creating ? CREATE_ACCOUNT.submitting : SIGN_IN.submitting) : words.submit}
            </Button>
          </form>
        )}
      </main>

      <p className="w-full max-w-md mx-auto mt-8 flex flex-wrap items-center justify-center gap-x-1 text-body text-text-secondary">
        {creating ? CREATE_ACCOUNT.haveAccount : SIGN_IN.newHere}
        <Button variant="plain" onClick={() => go(creating ? 'sign-in' : 'create')} disabled={busy}>
          {creating ? CREATE_ACCOUNT.toSignIn : SIGN_IN.toCreate}
        </Button>
      </p>

      {/* TACTICAL BYPASS: Google Auth Disabled for Mobile WebViews. Enforcing Email/Passkey only.
          (executeAuthDirective('google') still exists; nothing offers it.) */}
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
  const [optionsMemberId, setOptionsMemberId] = useState(null);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  // When the member list last came in from the server; null until it has, in this group.
  const [rosterAt, setRosterAt] = useState(null);
  // Phone layout and the squad/matrix sheet (see the Sidebar Panel below).
  const isMobile = useIsMobile();
  const reduceMotion = useReducedMotion();
  const sheetOpen = mobileView === 'matrix' || mobileView === 'squad';
  const sheetDragControls = useDragControls();
  const sheetRef = useRef(null);
  // The panel's resting height on a phone (utils/panelHeights.js): it opens at half.
  const [panelHeight, setPanelHeight] = useState('peek');
  const panelY = useMotionValue(0);
  const panelDragStartRef = useRef(0);
  const listTouchRef = useRef(null);
  const panelSwipeRef = useRef(null); // where a finger went down on the panel, for sectionSwipe
  const [panelGeometry, setPanelGeometry] = useState(null);
  const panelHeaderRef = useRef(null);
  const peekWrapRef = useRef(null);
  const peekLinesRef = useRef(null);
  const insetProbeRef = useRef(null);
  const sheetDraggedRef = useRef(false);
  // --- TACTICAL WAYPOINT STATE ---
  const [activeWaypoint, setActiveWaypoint] = useState(null);
  // Squad-wide SOS beacons this client hasn't acknowledged yet: a queue, one overlay
  // on screen at a time (see useIncomingSos). Live beacons arrive as 'sos-received';
  // ones missed while offline/reconnecting are replayed after requestSosSync().
  const {
    current: incomingSos,
    pendingCount: pendingSosCount,
    position: sosPosition,
    total: sosTotal,
    acknowledge: acknowledgeSosOnSocket,
    requestSync: requestSosSync,
    receive: receiveSos,
  } = useIncomingSos(socket);
  // SOS that was heard while the app was closed: a tapped notification arrives as an alert here,
  // the notification goes once the overlay shows it, and acknowledging reaches the server even
  // before this phone has rejoined its Group (hooks/useClosedAppSos.js).
  const acknowledgeSos = useClosedAppSos({ current: incomingSos, pendingCount: pendingSosCount, receive: receiveSos, acknowledge: acknowledgeSosOnSocket });

  // An Emergency alert held for want of a connection (utils/sosOutbox.js): the button reads
  // "Waiting for connection", and a notice says so until it goes, or can't.
  const [sosHeld, setSosHeld] = useState(false);
  const heldNoticeRef = useRef(null);
  const sentNoticeRef = useRef(null); // the "alert sent" notice, taken back if the server refuses
  useEffect(() => {
    sosOutbox.reset(); // a fresh app: nothing held, not in a group yet
    const unsubscribe = sosOutbox.subscribe(({ held, event, reason, late, withLocation }) => {
      setSosHeld(held);
      if (event === 'held') {
        heldNoticeRef.current = notify.warning(SOS_HELD.title, { body: SOS_HELD.body, duration: 0, safety: true });
        return;
      }
      if (heldNoticeRef.current !== null) dismissNotice(heldNoticeRef.current);
      heldNoticeRef.current = null;
      if (event === 'sent') {
        // Said only once it has gone (E3). No buzz of its own: sending feels as it always did.
        const mode = telemetryModeRef.current;
        const stillLine = mode === 'FROZEN' ? SOS_SENT.stillPaused : mode === 'GHOST' ? SOS_SENT.stillHidden : null;
        const body = [late ? SOS_SENT.late : null, withLocation ? SOS_SENT.withLocation : SOS_SENT.noLocation, stillLine].filter(Boolean).join(' ');
        sentNoticeRef.current = withLocation
          ? notify.success(SOS_SENT.title, { body, haptic: false })
          : notify.warning(SOS_SENT.noLocationTitle, { body, haptic: false });
      }
      if (event === 'dropped') notify.warning(reason === 'gone' ? SOS_DROPPED.gone : SOS_DROPPED.left, { duration: 0, safety: true });
    });
    return unsubscribe;
  }, []);

  // The Group's switches as the server last said (backend/groupSettings.js, 'group-settings'),
  // and its answer to each SOS this phone sent ('alert-result'). A refused SOS takes back the
  // "sent" notice and says why: the cooldown (with the time left), SOS switched off, or a class
  // zone. Neither was listened for before, so a refused alert still read as sent.
  const [groupSettings, setGroupSettings] = useState(null);
  useEffect(() => {
    const onSettings = (settings) => setGroupSettings(settings ?? null);
    const onResult = (result) => {
      if (result?.type !== 'sos' || result.allowed) return;
      if (sentNoticeRef.current !== null) dismissNotice(sentNoticeRef.current);
      sentNoticeRef.current = null;
      const body = result.reasonCode === 'COOLDOWN' ? SOS_REFUSED.cooldown(result.retryAfterSec ?? 1)
        : result.reasonCode === 'GROUP_DISABLED' ? SOS_REFUSED.disabled
          : result.reasonCode === 'QUIET_ZONE' ? SOS_REFUSED.quietZone
            : SOS_REFUSED.other;
      notify.warning(SOS_REFUSED.title, { body, safety: true });
    };
    socket.on('group-settings', onSettings);
    socket.on('alert-result', onResult);
    return () => {
      socket.off('group-settings', onSettings);
      socket.off('alert-result', onResult);
    };
  }, []);
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
  // A keyboard hidden with Back leaves its field focused, which can bring it back: let go of it.
  useBlurOnKeyboardHide();
  const [arTarget, setArTarget] = useState(null);
  // Back closes AR Scan (its permission screen and camera explainer too) and leaves the map
  // showing; it claims the press only while AR Scan is open, so Back means what it always did
  // everywhere else.
  const arOpen = Boolean(arTarget);
  useEffect(() => {
    if (!arOpen) return undefined;
    return pushBackHandler(() => { setArTarget(null); return true; });
  }, [arOpen]);
  // The camera explainer (components/CameraExplainer.jsx) shows before AR Scan only until the
  // camera has been allowed: known from this phone's note or the Permissions API. Continue
  // lets AR Scan open this time; the note is made once the camera actually starts.
  const [cameraAllowed, setCameraAllowed] = useState(cameraKnownAllowed);
  const [cameraExplained, setCameraExplained] = useState(false);
  const arScanReady = cameraAllowed || cameraExplained;
  useEffect(() => {
    let live = true;
    cameraPermissionGranted().then((granted) => {
      if (!live || !granted) return;
      rememberCameraAllowed();
      setCameraAllowed(true);
    });
    return () => { live = false; };
  }, []);
  // Each opening of AR Scan asks again until the camera is allowed.
  useEffect(() => { if (!arTarget) setCameraExplained(false); }, [arTarget]);
  // --- TARGETING MODE (Two-step Rally Point) ---
  const [isTargetingMode, setIsTargetingMode] = useState(false);
  // --- SYS_CONFIG STATE ---
  const [showAdminSettings, setShowAdminSettings] = useState(false);
  // The guide shows once, on first run, before sign-in; Skip and Get started both count, and
  // the phone remembers it (utils/guideSeen.js). It was shown on every cold start before.
  const [hasSeenGuide, setHasSeenGuide] = useState(guideSeen);
  const [sysConfig, setSysConfig] = useState({
    audio: true, // Settings' Alert sounds (ping and lost-connection sounds; never the Emergency alarm)
    polling: 'standard', // 'eco' | 'standard' | 'max'
    arFidelity: 'standard', // 'efficient' | 'standard' | 'realistic': AR Scan's main dial (see ARCompass)
    arFeatureOverrides: DEFAULT_AR_FEATURE_OVERRIDES // per feature; 'auto' follows arFidelity (see arFeatures.js)
  });

  // Alert sounds, for playSonarPing (called from socket handlers that are set up once).
  const alertSoundsRef = useRef(sysConfig.audio);
  alertSoundsRef.current = sysConfig.audio;
  // How LOCUS works, opened from Settings (the guide over everything else, until closed).
  const [guideOpen, setGuideOpen] = useState(false);

  // `key` is a setting's name, or 'group.name' for one entry of a nested setting
  // (arFeatureOverrides.roadLine), merged into the rest of its group.
  const toggleConfig = (key, value) => {
    const [group, name] = key.split('.');
    setSysConfig(prev => (name
      ? { ...prev, [group]: { ...prev[group], [name]: value } }
      : { ...prev, [key]: value }));
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
    if (!isoString) return { text: "NO_SIGNAL", color: "text-warning" }; // ordinary problems: amber, never red
    const seconds = Math.floor((new Date() - new Date(isoString)) / 1000);
    if (seconds < 10) return { text: "OPTIMAL (< 10s)", color: "text-success" };
    if (seconds < 60) return { text: `GOOD (${seconds}s ago)`, color: "text-text" };
    if (seconds < 300) return { text: `WARN (${Math.floor(seconds / 60)}m ago)`, color: "text-warning" };
    return { text: `STALE (> 5m)`, color: "text-warning" };
  };
  const memberSeenRef = useRef({}); // id -> { server: lastSeen, local: when this phone saw it change }

  const [offlineNodes, setOfflineNodes] = useState({}); // <-- NEW: Tracks dead signals
  const ghostFadeTimersRef = useRef({}); // targetId -> timeout, guards against double-scheduling a fade-out
  // Own stable identity, readable from socket callbacks that only subscribe once. Socket
  // ids change on every reconnect; this doesn't, so it's what "is this me?" is answered with.
  const myUidRef = useRef(null);

  // Shared 1Hz clock so every ghost's elapsed-time tag recomputes together instead of each
  // running its own interval. It only ticks while someone is lost, so it is set to now the moment
  // the first one is: it used to keep the time of the last tick (or of app start) until a second
  // later, and a fresh "lost connection" read short, or 0:00.
  const [ghostClockTick, setGhostClockTick] = useState(() => Date.now());
  const hasGhosts = Object.keys(offlineNodes).length > 0;
  useEffect(() => {
    if (!hasGhosts) return;
    setGhostClockTick(Date.now());
    const id = setInterval(() => setGhostClockTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasGhosts]);

  const ghostMembers = useMemo(
    () => deriveGhostMembers(offlineNodes, ghostClockTick),
    [offlineNodes, ghostClockTick]
  );

  // The place waiting on "Set as meeting point"'s confirmation, or null.
  useEffect(() => { logNavBuild(); }, []);
  const [meetingPointToConfirm, setMeetingPointToConfirm] = useState(null);
  const [rallyToClear, setRallyToClear] = useState(null); // the place whose rally point is being cleared

  // --- ADDED: ROUTING STATE ---
  const [routeStart, setRouteStart] = useState(null);
  const [routeEnd, setRouteEnd] = useState(null);
  const [routeData, setRouteData] = useState(null);
  // Full Google Maps-style turn-by-turn navigation session
  const [isNavigatingMode, setIsNavigatingMode] = useState(false);
  const leafletMapRef = useRef(null);

  // --- MODIFIED: FIREBASE AUTH STATE ---
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  // --- ADMIN PATH RECORDER STATE ---
  const ADMIN_EMAIL = "vithyakrish1402@gmail.com"; //  REPLACE WITH YOUR EXACT GOOGLE LOGIN EMAIL
  const isAdmin = user?.email === ADMIN_EMAIL;
  // Every place on the map: srmDatabase.js plus the ones the admin added in the app.
  const { places: campusPlaces, added: addedPlaces, add: addCampusPlace, remove: removeAddedPlace } = useCampusPlaces(user);
  // Add Place: the admin taps the map (placing), then fills the form for that spot (draftPlace).
  const [isPlacing, setIsPlacing] = useState(false);
  const [draftPlace, setDraftPlace] = useState(null);
  const [savingPlace, setSavingPlace] = useState(false);
  const [placeProblem, setPlaceProblem] = useState(null);

  // --- GREEN LIGHT PROTOCOL: Map readiness gate ---
  const [isMapReady, setIsMapReady] = useState(false);
  // --- MAP ENGINE ROUTING ---
  // The free Leaflet/OSM map is the map, every time the app opens. Google is loaded by one
  // thing only: the first tap on satellite. Satellite is never drawn from Google tiles by the
  // free engine (against Google's terms); it switches the visible engine to the Google map.
  // Google bills per map created, so it is created once per session: hidden, not destroyed,
  // when you go back to the normal map, and shown again (the same instance) on the next tap.
  // mapFailReason is why Google was given up on (null = usable, or not yet asked for), so
  // SYS_CONFIG can say why. First reason wins; one-way per session. With Google given up
  // on, satellite falls back to Leaflet with Esri imagery.
  const [mapFailReason, setMapFailReason] = useState(GOOGLE_MAPS_API_KEY ? null : 'no-key');
  const failMapEngine = (reason) => setMapFailReason((prev) => prev ?? reason);
  const googleUsable = mapFailReason === null;
  // Set by the first satellite tap, never cleared: it is what keeps the one Google map alive.
  const [googleRequested, setGoogleRequested] = useState(false);
  const googleMounted = googleUsable && (googleRequested || isSatellite);
  useEffect(() => {
    if (googleUsable && isSatellite) setGoogleRequested(true);
  }, [googleUsable, isSatellite]);
  // Google is the visible engine only once its map is up; until then the free map stays put
  // rather than going blank for the second Google takes to load.
  const googleShown = googleMounted && isSatellite && isMapReady;
  const mapEngineFailed = !googleShown; // i.e. Leaflet is the visible engine
  const mapStatus = mapEngineStatus(mapFailReason, googleShown);
  useEffect(() => {
    if (import.meta.env.DEV && mapFailReason) console.warn(`[SYS_MAP] Google unavailable, reason: ${mapFailReason}`);
  }, [mapFailReason]);
  // Google calls window.gm_authFailure when it loaded but refused the key (website
  // restriction, billing off, API not enabled). Listen only while Google is mounted.
  useEffect(() => {
    if (!googleMounted) return;
    const previous = window.gm_authFailure;
    const handler = () => failMapEngine('key-rejected');
    window.gm_authFailure = handler;
    return () => {
      if (window.gm_authFailure === handler) window.gm_authFailure = previous;
    };
  }, [googleMounted]);

  const [isRecordingPath, setIsRecordingPath] = useState(false);
  const [recordedCoords, setRecordedCoords] = useState([]);
  const [liveSecretRoutes, setLiveSecretRoutes] = useState({
    "Tech Park_Java Green": {
      distance: "450 M", eta: "4 MINS",
      path: [{ lat: 12.825020, lng: 80.045323 }, { lat: 12.824500, lng: 80.044900 }, { lat: 12.823900, lng: 80.044600 }, { lat: 12.823348, lng: 80.044489 }]
    }
  });
  const recordingPolylineRef = useRef(null);
  // The owner's path recorder (components/admin/AdminTools.jsx): Publish asks for the two
  // buildings' names and sends the route to the group; Abort throws the points away.
  const stopRecording = () => {
    setIsRecordingPath(false);
    setRecordedCoords([]);
    if (recordingPolylineRef.current) recordingPolylineRef.current.setMap(null);
    recordingPolylineRef.current = null;
  };
  const abortRecording = stopRecording;
  const publishRecordedRoute = () => {
    const startName = prompt("Enter START Building Name (e.g., Tech Park):");
    const endName = prompt("Enter END Building Name (e.g., Java Green):");
    if (startName && endName && recordedCoords.length > 1) {
      const newRouteData = { distance: "CUSTOM", eta: "TACTICAL", path: recordedCoords };
      setLiveSecretRoutes(prev => ({ ...prev, [`${startName}_${endName}`]: newRouteData }));
      socket.emit('publish-custom-route', { key: `${startName}_${endName}`, data: newRouteData, roomCode: squadCode });
      stopRecording();
      notify.success(NOTICES.routePublished(startName, endName));
    }
  };

  // Add Place (components/admin/AddPlace.jsx): saved to Firestore, so every phone gets it.
  const saveDraftPlace = async (fields) => {
    setSavingPlace(true);
    setPlaceProblem(null);
    try {
      const result = await addCampusPlace(fields);
      if (!result.ok) {
        setPlaceProblem(ADD_PLACE_PROBLEMS[result.reason] ?? ADD_PLACE_PROBLEMS.failed);
        return;
      }
      setDraftPlace(null);
      notify.success(NOTICES.placeAdded(String(fields.name).toUpperCase()));
    } catch (err) {
      setPlaceProblem(err?.code === 'permission-denied' ? ADD_PLACE_PROBLEMS.denied : ADD_PLACE_PROBLEMS.failed);
    } finally {
      setSavingPlace(false);
    }
  };
  const cancelAddPlace = () => { setIsPlacing(false); setDraftPlace(null); setPlaceProblem(null); };
  const removePlace = async (place) => {
    try {
      await removeAddedPlace(place.id);
      if (selectedItem?.id === place.id) setSelectedItem(null);
      notify.success(NOTICES.placeRemoved(place.name));
    } catch {
      notify.warning(NOTICES.placeNotRemoved);
    }
  };

  const [loginMethod, setLoginMethod] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [activeTab, setActiveTab] = useState('buildings');
  const [searchQuery, setSearchQuery] = useState('');
  // The campus dots. On a phone they always show: the map has no Members/Buildings tab, so the
  // dots used to vanish once the Group tab had set it to Members and never come back. On a
  // larger screen the sidebar's Members tab still hides them.
  const buildingDotsShown = isMobile || activeTab === 'buildings';
  // The top bar's search: which buildings and places the Buildings list shows.
  const [placeQuery, setPlaceQuery] = useState('');
  // The group panel's search box has focus, so on a phone the keyboard is up and the screen is
  // short: the panel's title and the Group Lead's buttons step aside until focus leaves, so the
  // box rises clear of the Emergency button (owner, Stop 2, keyboard option 1).
  const [searchFocused, setSearchFocused] = useState(false);
  const afterTap = (stillSo, focused) => {
    const apply = () => { if (stillSo()) setSearchFocused(focused); };
    window.addEventListener('click', apply, { once: true });
    setTimeout(apply, 400);
  };
  const [selectedItem, setSelectedItem] = useState(null);
  const [buildingCategoryFilter, setBuildingCategoryFilter] = useState('ALL');

  const [users, setUsers] = useState([]);
  // AR Scan aimed at a squad member follows them as they move, instead of pointing at
  // where they stood when it was opened. followArTarget returns the same object when
  // nothing moved, so this settles without a re-render.
  useEffect(() => {
    setArTarget(prev => followArTarget(prev, users));
  }, [users]);
  const [liveLocation, setLiveLocation] = useState(null);
  const [liveAccuracy, setLiveAccuracy] = useState(null);
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
  // The location explainer (components/LocationExplainer.jsx), before LOCUS first asks
  // Android for location, shown only until location is known to be allowed: from this
  // phone's note of a real fix, or the Permissions API. Until Continue, nothing asks for or
  // shares a location. Not now leaves it off, with the "Location is off" card to turn it on.
  const [locationAllowed, setLocationAllowed] = useState(locationKnownAllowed);
  // Whether the Permissions API has answered yet. Until it has, the explainer waits, so a
  // phone that already allows location never sees it flash up for a moment at launch.
  const [permissionChecked, setPermissionChecked] = useState(locationKnownAllowed);
  const [locationExplained, setLocationExplained] = useState(false);
  const [locationDeclined, setLocationDeclined] = useState(false);
  const [declinedCardDismissed, setDeclinedCardDismissed] = useState(false);
  // Bumped by "Turn on location": the location effect runs again and asks once more.
  const [locationRetry, setLocationRetry] = useState(0);
  const locationReady = locationAllowed || locationExplained;
  useEffect(() => {
    let live = true;
    locationPermissionGranted().then((granted) => {
      if (!live) return;
      setPermissionChecked(true);
      if (!granted) return;
      rememberLocationAllowed();
      setLocationAllowed(true);
    });
    return () => { live = false; };
  }, []);
  const noteRealFix = () => {
    if (locationKnownAllowed()) return;
    rememberLocationAllowed();
    setLocationAllowed(true);
  };
  const turnOnLocation = () => {
    setLocationDeclined(false);
    setDeclinedCardDismissed(false);
    setLocationExplained(true);
    setLocationError(null);
    setLocationRetry((n) => n + 1);
  };
  const onGeolocationError = (err) => {
    // Anything but a refusal (a timeout indoors, no position) means Android allowed location:
    // noted like a fix, so the explainer doesn't come back next time for want of one.
    if (err?.code !== 1) {
      rememberLocationAllowed();
      setLocationAllowed(true);
    }
    setLocationError(err?.code === 1 ? 'denied' : 'no-fix');
  };

  const [squadCode, setSquadCode] = useState('');
  const [squadMode, setSquadMode] = useState('create'); // 'create' or 'join'
  const [hasJoinedSquad, setHasJoinedSquad] = useState(false);
  // The Group this phone remembers from before the app was closed ({ code, role }), offered on
  // the way in: "Return to <Group>" or "Start fresh". Null when there is none, or once chosen.
  const [resumeOffer, setResumeOffer] = useState(null);
  // Out of the group, however it happened (left, removed, turned down, signed out): an
  // Emergency alert still held for it can't reach anyone now. (A group gone from the server
  // is dropped first, with its own words, in the 'squad-not-found' handler.)
  useEffect(() => {
    if (!hasJoinedSquad) sosOutbox.drop('left');
  }, [hasJoinedSquad]);
  // Why the lobby is showing again, when the server turned a request down (no live squad
  // under the code, the code already taken, the squad gone). Cleared by the next action.
  const [lobbyNotice, setLobbyNotice] = useState(null);
  // The code of a squad whose Commander just turned this user's request down: the lobby shows
  // "Request not approved" until they choose to try another code. (It used to be a notice.)
  const [deniedCode, setDeniedCode] = useState(null);
  // Let into a squad after waiting for approval: "You're in" shows over the map until
  // dismissed. Not for a squad you create, nor a reconnect into one you were already in.
  const [justApproved, setJustApproved] = useState(false);

  // --- MAP ENGINE FALLBACK WATCHDOG ---
  // Armed only once the map screen is actually about to render (past auth +
  // squad-join) — arming it at app boot meant the 8s clock usually expired
  // during login/registration, before <GoogleMapReact> ever got a chance to
  // mount, so it fell back to Leaflet on every real session regardless of
  // whether Google Maps would've loaded fine.
  useEffect(() => {
    // Google is only waited on once it has been asked for (a satellite tap).
    if (!user || !hasJoinedSquad || isMapReady || !googleMounted) return;
    const timeoutId = setTimeout(() => {
      if (!isMapReady) {
        console.warn('[SYS_MAP] Google Maps did not initialize in time — satellite falls back to Leaflet.');
        failMapEngine('timeout');
      }
    }, 8000);
    return () => clearTimeout(timeoutId);
  }, [user, hasJoinedSquad, isMapReady, googleMounted]);

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
  // This person's role in the Group, as the server last said ('group-role', backend/groupRoles.js):
  // { roomCode, role: 'admin' | 'moderator' | 'member', moderatorIds }. Whoever holds command
  // (squadRole OWNER) is the admin; a Group made before roles makes everyone else a member.
  const [groupRole, setGroupRole] = useState(null);
  const myRole = squadRole === 'OWNER' ? 'admin'
    : groupRole?.roomCode === squadCode && groupRole.role === 'moderator' ? 'moderator' : 'member';
  // The main admin and moderators: join requests, removing, the activity log. Blocking,
  // unblocking and Admit all are the main admin's only, and making moderators the Group's own
  // Commander's (not a stand-in's: `appoints`, from a server that says).
  const canModerate = myRole === 'admin' || myRole === 'moderator';
  const canBlock = myRole === 'admin';
  const appointsModerators = myRole === 'admin' && !(groupRole?.roomCode === squadCode && groupRole.appoints === false);
  const canModerateRef = useRef(false);
  canModerateRef.current = canModerate;
  const liveLocationRef = useRef(null);
  // Shared with ARCompass.jsx (src/hooks/useDeviceHeading.js) so both the AR
  // targeting view and this device's own map marker read the compass the same way.
  // `heading` is throttled for rendering; `headingRef` always holds the newest
  // (smoothed) bearing. The GPS-tracking effect below intentionally does NOT list `heading` as
  // a dependency (that would tear down and re-register the geolocation watch on
  // every compass tick), so it reads the ref instead and still emits a current value.
  const { heading, headingRef, hasReading: hasHeadingReading, requestHeadingPermission } = useDeviceHeading();
  // Mirrors telemetryMode in a ref so setInterval and watchPosition callbacks
  // always read the current value — they close over the ref, not the stale state.
  const telemetryModeRef = useRef('ACTIVE');
  // Paused (FROZEN): the position the squad keeps seeing, taken the moment sharing was
  // paused: { position (positionFor's result), heading, at (epoch ms) }, or null when there
  // was no fix to take. Nothing after that moment leaves this phone as a squad position.
  const pausedPositionRef = useRef(null);
  // Whether that paused position exists, for what the screen says: paused before any fix
  // shares no spot at all, so it mustn't say the group sees your last spot.
  const [pausedHasSpot, setPausedHasSpot] = useState(false);
  // WiFi Arc Stage 6: every update-location payload takes its lat/lng/positionSource from
  // positionFor(gps). Off by default (src/utils/positionSource.js), and then it is always
  // the GPS fix with positionSource 'gps'. Safety-ping stays on GPS.
  // Stable identity, so listing it in the telemetry effect's dependencies below never
  // re-runs that effect.
  //
  // Stage 7: `indoor` is the valid indoor reading behind it (null with the flag off). While
  // there is one, your own dot is drawn at the WiFi position - the one your squad is being
  // sent - with a confidence halo. indoorView is the floor picker's purely local state:
  // nothing in it reaches positionFor. The picker shows in any building your GPS fix is
  // inside, reading or not, so an unsurveyed building gets one too (saying it has no floors).
  const wifiActive = Boolean(user && hasJoinedSquad && accessStatus === 'granted');
  const { positionFor, indoor, lastCycle } = useWifiFusion(wifiActive);
  // Background sharing: keeps this person on the Group's map after the app is closed. Does nothing
  // unless this phone's app has the sharing service, the server has it on, and the person has
  // turned it on in Settings (after agreeing to what it does).
  const backgroundSharing = useBackgroundSharing({
    inGroup: wifiActive,
    hidden: telemetryMode === 'GHOST',
    roomCode: squadCode.trim().toUpperCase(),
    groupName: squadCode.trim().toUpperCase(),
    polling: sysConfig.polling,
    backendUrl: BACKEND_URL,
    getIdToken: () => auth.currentUser.getIdToken(),
    onGroupEnded: () => {
      // The Group is gone: nothing to go back to, so the lobby says so instead of offering it.
      forgetGroup();
      setResumeOffer(null);
      setLobbyNotice(LOBBY.groupEndedRestart);
    },
  });
  const gpsBuilding = useMemo(
    () => (WIFI_POSITIONING_ENABLED ? buildingAt(liveLocation)?.name ?? null : null),
    [liveLocation]
  );
  const indoorView = useIndoorView(WIFI_POSITIONING_ENABLED ? indoor : null, gpsBuilding);
  // Where your own dot goes. With an indoor reading it is shown only on your real floor's
  // tab: browsing another floor, you aren't on it.
  const selfIndoor = WIFI_POSITIONING_ENABLED && indoor ? indoor : null;
  const selfMarkerAt = selfIndoor ? { lat: selfIndoor.lat, lng: selfIndoor.lng } : liveLocation;
  const showSelfMarker = Boolean(selfMarkerAt) && !(selfIndoor && indoorView?.browsing);

  // Start listening for compass heading as soon as we're signed in — on Android
  // this needs no user gesture. On iOS 13+ this call is a silent no-op (that
  // platform requires the permission request to originate from a click handler,
  // which AR Scan's own "Start AR Scan" button still provides separately).
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
      //  INSTANT CLEARANCE FOR SQUAD CREATORS (0ms delay) — you can't need your
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
      setTelemetrySync({ status: 'error', message: REFRESH_FAILED.notConnected });
      return;
    }
    const attempt = {};
    pendingSyncRef.current = attempt;
    setTelemetrySync({ status: 'pending', message: null });
    socket.timeout(TELEMETRY_SYNC_TIMEOUT_MS).emit('request-telemetry', squadCode, (err, reply) => {
      if (pendingSyncRef.current !== attempt) return; // already settled by the telemetry itself
      pendingSyncRef.current = null;
      if (err) {
        setTelemetrySync({ status: 'error', message: REFRESH_FAILED.noResponse });
      } else if (reply?.ok) {
        setTelemetrySync({ status: 'idle', message: null });
      } else {
        setTelemetrySync({ status: 'error', message: TELEMETRY_SYNC_REFUSALS[reply?.reason] || REFRESH_FAILED.refused });
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

  // ---  NETWORK LATENCY TRACKER ---
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
  // ---  UPDATED: THE DEAD MAN'S SWITCH INTERCEPTOR ---
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

      // Store the last-known fix, undisturbed: the marker stays exactly there, marked as lost,
      // however long they are gone (deriveGhostMembers). Nothing guesses where they went.
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
          battery: lastKnownLocation.batteryLevel,
          // When they were last really reported: the server notices a dead phone up to ~45 s
          // late, and says how late (timeDelta), so "last seen" counts from the real report.
          lastSeenAt: Date.now() - Math.max(0, Number(timeDelta) || 0) * 1000,
        }
      }));

      // A notice that clears itself (it replaced a blocking alert(), which froze the whole UI
      // until someone clicked OK). Six seconds and no buzz, as the old banner had.
      notify.warning(NOTICES.signalLost.body, { title: NOTICES.signalLost.title(name), duration: OLD_BANNER_MS, haptic: false });
    });

    return () => {
      socket.off('member-signal-lost');
    };
  }, []);
  // ---  ADDITION 3: TELEMETRY DATA RECEIVER ---
  // --- TACTICAL TELEMETRY DATA RECEIVER ---
  useEffect(() => {
    socket.on('telemetry-sync-complete', (data) => {
      console.log(" [SYS_SYNC] Raw Telemetry Matrix Acquired:", data);
      // The telemetry settles the sync on its own: a server that predates acknowledgements
      // sends only this, and the timeout that follows must not then report a failure.
      pendingSyncRef.current = null;
      setTelemetrySync({ status: 'idle', message: null });
      setRawTelemetryData(data);
      setShowTelemetryModal(true); // Pop the Commander's Dashboard
    });
    return () => socket.off('telemetry-sync-complete');
  }, []);
  // ---  ADDITION: MUTINY LISTENER ---
  useEffect(() => {
    socket.on('exiled', ({ reason } = {}) => {
      // 1. Tell them why (a comms-feed notice; this used to be a blocking alert())
      if (reason === 'blocked') notify.error(NOTICES.removedByLead);
      else if (reason === 'kicked') notify.error(NOTICES.removedKicked);
      else notify.error(NOTICES.removedByVote);

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


  // ---  SYS_NOTIFY: REQUEST OS PERMISSIONS ---
  useEffect(() => {
    if (user && 'Notification' in window) {
      if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
        Notification.requestPermission().then(permission => {
          if (permission === 'granted') {
            console.log(" [SYS_NOTIFY] OS Notification link established.");
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
        icon: '/logo_mark.jpg', // Official LOCUS emblem
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
      // The in-app notice is for the others in the squad: not the one who placed it (the
      // server echoes it back to them), and not the server re-sending the rally point
      // already on the map after a reconnect.
      const shown = activeWaypointRef.current;
      const isRepeat = shown && shown.lat === waypointData?.lat && shown.lng === waypointData?.lng
        && shown.setBy === waypointData?.setBy;
      const placedByMe = Boolean(waypointData?.setBy) && waypointData.setBy === selfIdRef.current;
      setActiveWaypoint(waypointData);
      if (!isRepeat && !placedByMe) {
        const { lat, lng, setBy } = waypointData ?? {};
        notify.info(NOTICES.meetingPoint.body, {
          title: NOTICES.meetingPoint.title,
          onClick: () => focusRallyPointRef.current({ lat, lng, setBy }),
        });
      }
      triggerSystemNotification(OS_NOTICES.meetingPoint.title, OS_NOTICES.meetingPoint.body);
    });

    socket.on('remove-waypoint', () => {
      console.log(`[SYS_NET] Rally Point cleared.`);
      setActiveWaypoint(null);
    });

    socket.on('users-update', (activeUsers) => {
      // When the list last came in, for the panel's "Updated just now" (and its loading state).
      setRosterAt(Date.now());
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
      // a pure function of the previous state (React is free to call it more than once).
      // That reconciliation now lives in its own effect, keyed off the roster this produces.
      // Positions are shown as reported: no smoothing (the GPS Kalman filter that lagged them
      // behind, and moved them between reports, was removed in 2026-10).
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

          formattedUsers.push({
            id,
            uid: data.uid || null,
            name: data.name || 'Squad Node',
            photo: data.photo,
            role: data.role || null, // 'admin' | 'moderator' | 'member' (backend/groupRoles.js)
            hasFix,
            lat: hasFix ? data.lat : null,
            lng: hasFix ? data.lng : null,
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
    // The notice keeps the old ping banner's six seconds and, like it, doesn't buzz.
    socket.on('receive-ping', ({ senderName } = {}) => {
      // LOCUS's Do Not Disturb (utils/inAppDnd.js): the ping still shows, without a sound.
      const quiet = isInAppDnd();
      if (!quiet) playIncomingPing();

      if (document.hidden && !quiet) {
        triggerSystemNotification(OS_NOTICES.ping.title, OS_NOTICES.ping.body(senderName));
      }

      notify.info(NOTICES.ping(senderName), { kind: 'ping', duration: OLD_BANNER_MS, haptic: false });
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

  // Everything a squad session leaves on this client, cleared on the way back to the
  // lobby: by leaving, by logging out, or when the server turns the request down.
  // `nextCode` is what the lobby's code box shows next. The Commander's queue goes too: it
  // used to survive leaving, and GRANT on an old request then answered for whatever squad
  // the Commander was in by then.
  const endSquadSession = useCallback((nextCode = '') => {
    // Every way out of a Group by anyone's choice comes through here (leaving, signing out, being
    // removed, turned down, or the Group being gone): opening the app again must not offer it.
    forgetGroup();
    setHasJoinedSquad(false);
    setSquadCode(nextCode);
    setUsers([]);
    setRosterAt(null);
    setOfflineNodes({});
    // Cancel in-flight ghost fade-outs so a stray one can't fire after the squad's gone.
    Object.values(ghostFadeTimersRef.current).forEach(clearTimeout);
    ghostFadeTimersRef.current = {};
    setAccessStatus(null);
    setSquadRole(null);
    setGroupRole(null);
    setPendingRequests([]);
    setJustApproved(false);
  }, []);

  // Roles, the waiting count and the activity log (backend/groupRoles.js, joinNotify.js,
  // activityLog.js). Set up once: what they read of the moment comes through refs.
  const [activityLog, setActivityLog] = useState([]);
  const [showActivityLog, setShowActivityLog] = useState(false);
  const [blockedPeople, setBlockedPeople] = useState([]);
  const [showBlocked, setShowBlocked] = useState(false);
  const openRequestsRef = useRef(() => {});
  useEffect(() => {
    const onRole = (payload) => setGroupRole(payload ?? null);
    const onEntry = ({ entry } = {}) => { if (entry) setActivityLog((log) => [...log, entry]); };
    // A burst of requests, said once, to whoever may admit (one notice, not one per request).
    const onWaiting = ({ count } = {}) => {
      if (!canModerateRef.current || !(count > 0)) return;
      notify.info(NOTICES.joinWaiting(count), { onClick: () => openRequestsRef.current() });
    };
    socket.on('group-role', onRole);
    socket.on('activity-entry', onEntry);
    socket.on('join-requests-waiting', onWaiting);
    return () => {
      socket.off('group-role', onRole);
      socket.off('activity-entry', onEntry);
      socket.off('join-requests-waiting', onWaiting);
    };
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
      // Back in the group on this connection: an Emergency alert held while offline goes now.
      sosOutbox.markInGroup();
      if (accessStatus === 'pending') setJustApproved(true);
      setAccessStatus('granted');
      setSquadRole(payload?.role);
      // So that opening the app again, after a swipe or from the sharing notification, can offer
      // to come back here rather than start at "Create a group" with a new code.
      rememberGroup({ code: payload?.roomCode || currentRoom, role: payload?.role, uid: user?.uid });
      // Paused: a reconnect gives this phone a new socket, which the server has no position
      // for, so the squad would lose this member from map and roster. Hand it the paused
      // position again. (Live members do this with their next heartbeat.)
      // The position taken when they paused, never a newer one; same fields as ever.
      const paused = telemetryModeRef.current === 'FROZEN' ? pausedPositionRef.current : null;
      if (paused && user) {
        socket.emit('update-location', {
          name: user.displayName, photo: user.photoURL,
          ...paused.position,
          speed: 0, battery: 100,
          status: 'FROZEN',
          roomCode: payload?.roomCode || currentRoom,
          heading: paused.heading,
        });
      }
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
      forgetGroup();
      // Coming back to a Group that has since blocked this person: the sharing left running for it ends.
      if (accessStatus === 'returning') stopBackgroundSharing();
      setAccessStatus('denied');
      setHasJoinedSquad(false);
      setDeniedCode(currentRoom);
    });

    // A JOIN for a code no live squad has. Answered this way rather than by founding a new
    // squad with the joiner as its Commander. Also sent when the squad is deleted while
    // this client is still waiting to be let in, or after a reconnect finds it gone.
    socket.on('squad-not-found', (payload) => {
      if (!isAboutThisSquad(payload)) return;
      // A reconnect found the group gone: an alert held for it can never reach anyone.
      sosOutbox.drop('gone');
      // Coming back to a Group that has ended: so is any sharing still running for it.
      if (accessStatus === 'returning') stopBackgroundSharing();
      returnToLobby(accessStatus === 'granted' || accessStatus === 'returning' ? LOBBY.ended(currentRoom) : LOBBY.notFound);
    });

    // A CREATE under a code a live squad already has. Answered this way rather than by
    // queueing the creator for that stranger squad's approval.
    socket.on('squad-code-taken', (payload) => {
      if (!isAboutThisSquad(payload)) return;
      returnToLobby(LOBBY.codeTaken, generateRandomSquadCode());
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
      notify.info(NOTICES.leadIsBack);
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

  // What an update-location carries of where this phone is: nothing while Hidden. The status
  // still goes, so the group (and the activity log) know this member is hidden; the position
  // used to go too, every few seconds, and was relayed to everyone (2026-10 fix).
  const sharedPosition = (fix) => (telemetryModeRef.current === 'GHOST' ? {} : positionFor(fix));

  /// 2. Broadcast your live GPS data to the network
  // 2. Broadcast your live GPS data to the network
  useEffect(() => {
    if (!user || !hasJoinedSquad || accessStatus !== 'granted') return;
    // Not before the location explainer's Continue (or a known permission): see above.
    if (!locationReady) return;

    // --- ️ DYNAMIC POLLING TRANSLATOR ---
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

    // ---  FORCE INITIAL GPS LOCK ---
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        const fix = { lat: latitude, lng: longitude };
        setLiveLocation(fix);
        liveLocationRef.current = fix;
        setLiveAccuracy(accuracy || null);
        setLocationError(null);
        noteRealFix();

        // Paused: this effect re-runs on a settings change too, and must not leak a new fix.
        if (telemetryModeRef.current === 'FROZEN') return;
        socket.emit('update-location', {
          name: user.displayName, photo: user.photoURL,
          ...sharedPosition(fix),
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

    // ---  DYNAMIC HEARTBEAT ---
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

      // Paused: the heartbeat (which feeds the Commander's telemetry matrix) carries the
      // paused position and the time it was taken, and no GPS report goes out at all. Both
      // used to carry the live fix every beat, so "FROZEN" never froze anything.
      const paused = telemetryModeRef.current === 'FROZEN' ? pausedPositionRef.current : null;
      if (telemetryModeRef.current === 'ACTIVE' || paused) {
        socket.emit('safety-ping', {
          latitude: paused ? paused.position.lat : currentLoc.lat,
          longitude: paused ? paused.position.lng : currentLoc.lng,
          timestamp: new Date(paused ? paused.at : Date.now()).toISOString(),
          batteryLevel: `${currentBattery}%`,
        });
      }

      if (telemetryModeRef.current === 'ACTIVE') {
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

    // ---  LIVE GPS TRACKING ---
    const watchId = navigator.geolocation.watchPosition(
      async (position) => {
        const { latitude, longitude, speed, accuracy } = position.coords;
        const fix = { lat: latitude, lng: longitude };

        setLiveLocation(fix);
        liveLocationRef.current = fix;
        setLiveSpeed(speed || 0);
        setLiveAccuracy(accuracy || null);
        setLocationError(null);
        noteRealFix();

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
          ...sharedPosition(fix),
          speed: speed ? Math.round(speed * 3.6) : 0,
          battery: batteryLevel,
          status: telemetryModeRef.current,
          roomCode: squadCode,
          heading: headingRef.current,
        });
      },
      (error) => {
        console.error(' [SYS_ERROR] Geolocation lost:', error.message);
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
  }, [user, hasJoinedSquad, squadCode, accessStatus, sysConfig.polling, headingRef, positionFor, locationReady, locationRetry]); // <-- CRITICAL: ADDED TO DEPENDENCIES
  // ---  INSTANT MODE OVERRIDE ---
  // Fires the moment a telemetry button is clicked so the server gets the new
  // status immediately, without waiting for the next watchPosition tick.
  // Intentionally keyed only on telemetryMode — user/hasJoinedSquad/squadCode are
  // read for their current value at fire time, not meant to retrigger this effect
  // (the heartbeat/watchPosition effect above already re-broadcasts on those changes).
  useEffect(() => {
    const currentLoc = liveLocationRef.current;
    // Pausing takes the position the squad keeps seeing; any other mode drops it.
    if (telemetryMode !== 'FROZEN') pausedPositionRef.current = null;
    if (!currentLoc || !user || !hasJoinedSquad) {
      setPausedHasSpot(pausedPositionRef.current !== null);
      return;
    }

    const position = positionFor(currentLoc);
    if (telemetryMode === 'FROZEN') {
      pausedPositionRef.current = { position, heading: headingRef.current, at: Date.now() };
    }
    setPausedHasSpot(pausedPositionRef.current !== null);
    socket.emit('update-location', {
      name: user.displayName, photo: user.photoURL,
      ...(telemetryMode === 'GHOST' ? {} : position),
      speed: 0, battery: 100,
      status: telemetryMode, // use state here — this effect re-runs when it changes
      roomCode: squadCode,
      heading: headingRef.current,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [telemetryMode]);

  // A ping someone sent this phone: on a phone, natively at full alarm volume (utils/alertSound.js),
  // else the Web Audio blip below. Settings' Alert sounds switch silences it, as it always has.
  const playIncomingPing = () => {
    if (!alertSoundsRef.current) return;
    if (!hasNativeAlertSound()) {
      playSonarPing();
      return;
    }
    playAlertSound('ping').then((played) => { if (!played) playSonarPing(); });
  };

  // LOCUS's Do Not Disturb, handed to native code once at start (it is kept on the phone), and the
  // one-time word about letting an SOS ring through the phone's own Do Not Disturb.
  useEffect(() => { shareInAppDnd(isInAppDnd()); }, []);
  useEffect(() => {
    if (accessStatus !== 'granted') return undefined;
    let live = true;
    dndAccessGranted().then((granted) => {
      if (!live || granted !== false || dndExplainedBefore()) return;
      rememberDndExplained();
      notify.info(NOTICES.dndAccess.title, { body: NOTICES.dndAccess.body, duration: 0, onClick: openDndAccessSettings });
    });
    return () => { live = false; };
  }, [accessStatus]);

  // --- PING SOUND ---
  // The short blip for a ping (sent or received) and for someone losing connection. Settings'
  // Alert sounds switch silences it. The Emergency alarm is SosOverlay's own (useAlertAudio)
  // and always plays. Read through a ref: the socket handlers that call this are set up once.
  const playSonarPing = () => {
    if (!alertSoundsRef.current) return;
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

  openRequestsRef.current = () => {
    setShowRequestsModal(true);
  };

  // A tapped "N people waiting to join" notification (raised while the app was closed, by the
  // sharing service: android/.../JoinNotifications.java) opens the Group tab and, for whoever may
  // let them in, Join requests.
  const openGroupFromNotificationRef = useRef(() => {});
  openGroupFromNotificationRef.current = () => {
    setActiveTab('users');
    setSelectedItem(null);
    setMobileView('squad');
    if (canModerate) setShowRequestsModal(true);
  };
  useEffect(() => {
    let handle = null;
    let gone = false;
    try {
      Promise.resolve(LocusBackground.addListener('groupOpened', () => openGroupFromNotificationRef.current()))
        .then((h) => { if (gone) h?.remove?.(); else handle = h; })
        .catch(() => {});
    } catch {
      // not available in this shell
    }
    return () => { gone = true; handle?.remove?.(); };
  }, []);

  // Commander-only screens close when the role goes: a stand-in handing the squad back
  // to its returning Commander could otherwise be left looking at the join queue, or the
  // telemetry matrix, with every action on them refused. A moderator keeps the join queue
  // and the log; a member has none of them.
  useEffect(() => {
    if (squadRole === 'OWNER') return;
    setShowTelemetryModal(false);
    setShowBlocked(false);
    if (canModerate) return;
    setShowRequestsModal(false);
    setShowActivityLog(false);
    setShowBlocked(false);
  }, [squadRole, canModerate]);

  // The Group Lead's and moderators' actions. Each is checked again by the server, which says
  // when it refuses (the person acted on is the Group Lead or a moderator, or the role changed),
  // and why.
  const refused = (answer) => { if (answer && !answer.ok) notify.warning(answer.message || ROLE_REFUSED); };
  const kickMember = (targetId) => socket.emit('kick-member', { roomCode: squadCode, targetId }, refused);
  const setMemberModerator = (member, on) => socket.emit('set-moderator', { roomCode: squadCode, targetId: member.id, moderator: on }, refused);
  const admitAll = () => socket.emit('admit-all', { roomCode: squadCode }, refused);
  const openActivityLog = () => {
    setShowActivityLog(true);
    socket.emit('get-activity-log', { roomCode: squadCode }, (answer) => {
      if (answer?.ok) setActivityLog(answer.log ?? []);
      else refused(answer);
    });
  };
  const openBlocked = () => {
    setShowBlocked(true);
    socket.emit('get-blocked', { roomCode: squadCode }, (answer) => {
      if (answer?.ok) setBlockedPeople(answer.blocked ?? []);
      else refused(answer);
    });
  };
  const unblock = (uid) => socket.emit('unblock-user', { roomCode: squadCode, uid }, (answer) => {
    if (answer?.ok) setBlockedPeople(answer.blocked ?? []);
    else refused(answer);
  });
  // Trusted friends (hooks/useFriends.js): who hears this person's SOS, and whose they hear.
  const friends = useFriends(user, socket);
  const [showFriendRequests, setShowFriendRequests] = useState(false);
  const friendAction = (done) => done.then((ok) => { if (!ok) notify.warning(FRIENDS.failed); });
  // A member someone can be trusted friends with: signed in (a uid), and not a lost connection.
  const friendFor = (member) => (member?.uid && member.status !== 'GHOST' ? {
    status: friends.statusOf(member.uid),
    onAdd: (m) => friendAction(friends.ask(m)),
    onAccept: (m) => friendAction(friends.accept(m.uid)),
    onRemove: (m) => friendAction(friends.remove(m.uid)),
  } : undefined);

  const exportLog = async () => {
    const outcome = await exportActivityLog(activityLog, squadCode);
    if (outcome === 'copied') notify.info(ACTIVITY_LOG.copied);
    else if (outcome === 'failed') notify.warning(ACTIVITY_LOG.exportFailed);
  };
  // Whether this person may remove `member` (the server has the same rule): the Group Lead
  // anyone but themself, a moderator only members; nobody the Group Lead.
  const mayRemove = (member) => Boolean(member) && member.role !== 'admin'
    && (myRole === 'admin' || (myRole === 'moderator' && member.role !== 'moderator'));

  const [mapProps, setMapProps] = useState({ center: SRM_KTR_COORDS, zoom: 17 });
  const mapRef = useRef(null);

  // Tracks the map's actual on-screen zoom (pinch/scroll), separately from
  // mapProps.zoom which is only the value WE last programmatically set (e.g.
  // handleFocus jumping to zoom 19) — LiveLocationMarker's near/far state
  // needs the real thing, not just our own last command.
  const [currentZoom, setCurrentZoom] = useState(mapProps.zoom);

  // ---  TACTICAL MAP OVERRIDE: FORCE 2D TOP-DOWN ---
  // Moved here so mapProps and mapRef are declared before this runs
  useEffect(() => {
    if (mapRef.current) {
      mapRef.current.setTilt(0);
    }
  }, [isSatellite, mapProps.zoom]);

  // ---  THE MASTER AUTH ENGINE ---
  // Signs in or creates the account. Returns the problem to show on the screen (an
  // AUTH_PROBLEMS sentence), or null; the screen shows it in place, not as a notice.
  const executeAuthDirective = async (method, isRegistering = false) => {
    setLoginMethod(method);

    try {
      if (method === 'google') {
        //  OAUTH OVERRIDE
        await signInWithPopup(auth, googleProvider);
      }
      else if (method === 'email') {
        // ️ SECURE ENCRYPTED CHANNEL
        if (!email || !password) {
          setLoginMethod(null);
          return AUTH_PROBLEMS.missingEmailAndPassword;
        }

        if (isRegistering) {
          // 1. Enforce Username Requirement
          if (!username.trim()) {
            setLoginMethod(null);
            return AUTH_PROBLEMS.missingName;
          }

          // 2. Create the Node in the Mainframe
          const userCredential = await createUserWithEmailAndPassword(auth, email, password);

          // 3. Generate a unique Tactical Bot Avatar based on their username
          const generatedAvatar = `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(username)}&backgroundColor=000000`;

          // 4. Attach the data to their Firebase Profile. The name is saved as typed. Accounts
          // made before the redesign keep the capitals they were saved with; nothing compares
          // names (members, blocks and approvals all go by uid), so the two can sit side by side.
          await updateProfile(userCredential.user, {
            displayName: username.trim(),
            photoURL: generatedAvatar
          });

          // 5. Force React to recognize the newly attached data immediately
          setUser({ ...userCredential.user, displayName: username.trim(), photoURL: generatedAvatar });

        } else {
          // VERIFY EXISTING CREDENTIALS
          await signInWithEmailAndPassword(auth, email, password);
        }
      }
    } catch (error) {
      console.error('Sign-in error:', error.code);
      setLoginMethod(null);
      return authProblem(error, isRegistering ? 'create' : 'sign-in');
    }
    return null;
  };

  // ---  KILL SWITCH LOGOUT HANDLER ---
  const handleLogout = () => {
    stopBackgroundSharing();
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
    stopBackgroundSharing();
    socket.emit('leave-squad');
    endSquadSession();
  };

  // Opened again (after a swipe, or from the sharing notification) by the person who was in a
  // Group: offer it back. Read once per sign-in, and only from the lobby.
  useEffect(() => {
    if (!user?.uid || hasJoinedSquad) return;
    setResumeOffer(rememberedGroup(user.uid));
    // Only on signing in (or opening the app signed in): leaving a Group forgets it anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  // "Return to <Group>": always asks to JOIN the Group that exists. Never a create, and never
  // 'resume' (which re-creates a Group the server lost): a Group that has ended is reported as
  // ended, in the lobby. The server still knows the person: their Group Lead role comes straight
  // back, an approved member skips approval, someone blocked is refused, someone who left asks again.
  const returnToGroup = () => {
    const offer = resumeOffer;
    if (!offer || !user) return;
    setResumeOffer(null);
    setDeniedCode(null);
    setLobbyNotice(null);
    setSquadMode('join');
    setSquadCode(offer.code);
    setAccessStatus('returning');
    setHasJoinedSquad(true);
    socket.emit('request-join', {
      roomCode: offer.code,
      user: { name: user.displayName, photo: user.photoURL, uid: user.uid },
      intent: 'join',
    });
  };

  // "Start fresh": the lobby, with no Group and no sharing left running for the old one. Nothing is
  // said to the server about the Group itself, so the code still lets the person back in later.
  const startFresh = () => {
    stopBackgroundSharing();
    forgetGroup();
    setResumeOffer(null);
    setSquadMode('create'); // the lobby as on a first launch (Return switched it to joining)
    // A pause taken over from the old Group's sharing (opened again while it was paused) ends with it.
    if (telemetryModeRef.current === 'FROZEN') {
      telemetryModeRef.current = 'ACTIVE';
      setTelemetryMode('ACTIVE');
    }
    if (hasJoinedSquad) {
      socket.emit('cancel-join', { roomCode: squadCode.trim().toUpperCase() });
      endSquadSession();
    }
  };

  // Live, Paused or Hidden, chosen in the app. Background sharing follows, so the notification,
  // this screen and the Group always agree (Hidden stops it: see useBackgroundSharing).
  const changeSharingMode = (mode) => {
    telemetryModeRef.current = mode;
    setTelemetryMode(mode);
    if (mode === 'FROZEN') backgroundSharing.pause();
    else if (mode === 'ACTIVE') backgroundSharing.resume();
  };

  // ... and the other way: Pause, Resume, or a pause running out, on the sharing notification.
  // The app's own mode follows, so its connection stops sending live positions over the pause
  // (it used to keep sending Live every few seconds, and the Group never saw Paused).
  const backgroundState = backgroundSharing.serviceState;
  const previousBackgroundState = useRef(backgroundState);
  useEffect(() => {
    const before = previousBackgroundState.current;
    previousBackgroundState.current = backgroundState;
    const mode = telemetryModeRef.current;
    if (backgroundState === 'paused' && mode === 'ACTIVE') {
      telemetryModeRef.current = 'FROZEN';
      setTelemetryMode('FROZEN');
    } else if (backgroundState === 'running' && mode === 'FROZEN') {
      if (before === 'paused') {
        telemetryModeRef.current = 'ACTIVE';
        setTelemetryMode('ACTIVE');
      } else {
        // Sharing has just started while the app is paused: the service pauses too.
        backgroundSharing.pause();
      }
    }
    // Keyed on the service's state only; the mode is read at the moment it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backgroundState]);

  // The Group Lead's SOS switch and cooldown. The server sends everyone the new settings; a
  // stand-in (not the Group's own Commander) is refused, and told so.
  const changeGroupSettings = (change) => {
    socket.emit('set-group-settings', { roomCode: squadCode, ...change }, (answer) => {
      if (answer && !answer.ok) notify.warning(SOS_CONTROLS.notCommander);
    });
  };

  const sendPing = (targetId) => {
    socket.emit('ping-user', {
      targetId: targetId,
      senderName: user ? user.displayName : "Ghost_Node"
    });

    playSonarPing();
    console.log(`>> Signal transmitted to Node: ${targetId}`);
  };

  const toggleBlock = (userId) => {
    setBlockedUserIds(prev => {
      if (prev.includes(userId)) return prev.filter(id => id !== userId);
      // Tell the server too — this actually removes them from the squad and bans
      // their account from rejoining, not just hiding them on this screen.
      if (canBlock) {
        socket.emit('block-user', { roomCode: squadCode, targetId: userId }, refused);
      }
      return [...prev, userId];
    });
  };

  // What the squad-wide socket handler (declared earlier, bound once per squad) needs to
  // read at tap time rather than at the time it was created.
  const activeWaypointRef = useRef(null);
  activeWaypointRef.current = activeWaypoint;
  const selfIdRef = useRef(null);
  selfIdRef.current = user?.uid || socket.id;
  const focusRallyPointRef = useRef(() => { });

  // Glides the map to a point; if no map engine has registered yet, jumps instead. Either way
  // mapProps ends up at the target, so the controlled `center`/`zoom` stay in step.
  const glideTo = (coords, zoom) => {
    const commit = () => setMapProps({ center: { lat: coords.lat, lng: coords.lng }, zoom });
    if (!focusMapOn({ lat: coords.lat, lng: coords.lng, zoom }, { onDone: commit })) commit();
  };

  // Closes the phone sheet (it covers the map) and glides to a matrix building. Shared by the
  // row tap and the row's waypoint button.
  const showBuildingOnMap = (building) => {
    if (!Number.isFinite(building?.lat) || !Number.isFinite(building?.lng)) {
      if (import.meta.env.DEV) console.warn('[matrix] building has no coordinates', building?.id);
      return false;
    }
    setMobileView('grid');
    glideTo(building, MAP_FOCUS_BUILDING_ZOOM);
    return true;
  };

  const handleBuildingTap = (building) => {
    if (!showBuildingOnMap(building)) return;
    setSelectedItem(building);
  };

  // The rally notice's tap. Looks the rally point up now, not from the notice: it may have
  // been cleared or replaced since (there is one rally point per squad, and no id to match).
  focusRallyPointRef.current = ({ lat, lng }) => {
    const live = activeWaypointRef.current;
    if (!live || live.lat !== lat || live.lng !== lng) {
      notify.info(NOTICES.meetingPoint.gone);
      return;
    }
    setMobileView('grid');
    glideTo(live, MAP_FOCUS_RALLY_ZOOM);
  };

  // The google-map-react engine's driver for utils/mapFocus.js. Leaflet registers its own.
  const googleDriverRef = useRef(null);
  useEffect(() => {
    if (!googleShown || !googleDriverRef.current) return undefined;
    return registerMapDriver(googleDriverRef.current);
  }, [googleShown]);

  // Both maps are driven by mapProps, but panning and pinching move only the visible one, so
  // on a switch the map coming up is put where the map going away was left (zoom whole for
  // Google, whose raster map takes no fraction). Nothing is rebuilt: markers and routes are
  // drawn from the same state on both.
  const wasGoogleShownRef = useRef(false);
  useEffect(() => {
    if (wasGoogleShownRef.current === googleShown) return;
    wasGoogleShownRef.current = googleShown;
    const from = googleShown ? leafletMapRef.current : mapRef.current;
    if (!from) return;
    const c = googleShown ? from.getCenter?.() : { lat: from.getCenter?.().lat?.(), lng: from.getCenter?.().lng?.() };
    const zoom = from.getZoom?.();
    if (!c || !Number.isFinite(c.lat) || !Number.isFinite(c.lng) || !Number.isFinite(zoom)) return;
    setMapProps({ center: { lat: c.lat, lng: c.lng }, zoom: googleShown ? Math.round(zoom) : zoom });
  }, [googleShown]);

  // --- FOCUS A MEMBER: the person being looked for ---
  // One action for a tapped member card (and its peek row, and "Show on map"), and for the sender
  // of an incoming SOS: the panel gets out of the way on a phone, the map glides and zooms to them
  // (utils/mapFocus.js drives whichever map engine is showing, and a touch on the map stops the
  // glide, so the user's own pan is never pulled back), and their marker is ringed on both
  // engines. The ring goes after FOCUS_HIGHLIGHT_MS, counted once no SOS is on screen, or on the
  // next tap on the map. Nothing follows them afterwards: the camera stays where it ended.
  const [focusedMemberId, setFocusedMemberId] = useState(null);
  const focusMember = (member, at = member) => {
    if (!member) return;
    if (isMobile) setMobileView('grid');
    setFocusedMemberId(member.id ?? null);
    if (Number.isFinite(at?.lat) && Number.isFinite(at?.lng)) glideTo(at, FOCUS_ZOOM_LEVEL);
  };
  useEffect(() => {
    if (!focusedMemberId || incomingSos) return undefined;
    const timer = setTimeout(() => setFocusedMemberId(null), FOCUS_HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [focusedMemberId, incomingSos]);
  // An SOS someone sends: their last position (sent with the alert) and their marker. Once per
  // alert: useIncomingSos hands over a new object only for a new alert, never on a re-render.
  useEffect(() => {
    if (!incomingSos) return;
    focusMember({ id: incomingSos.senderId }, { lat: incomingSos.lat, lng: incomingSos.lng });
    // Keyed on the alert only: focusMember reads the rest at the time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingSos]);

  const handleFocus = (coords, item) => {
    setMapProps({ center: coords, zoom: 19 });
    if (item) {
      // The place card shows for the Buildings tab; a dot tapped while Members was the tab
      // (the dots show on a phone whatever the tab) must switch to it or no card appears.
      setActiveTab('buildings');
      setSelectedItem(item);
    }
  };

  // ---  MODIFIED: INTERCEPTS CLICKS FOR ADMIN RECORDER ---
  const handleMapClick = ({ lat, lng }) => {
    // A tap on the map lets go of the member being looked for.
    setFocusedMemberId(null);
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

    // 1. If Admin is recording a path, save the coordinate and draw it
    if (isAdmin && isRecordingPath) {
      const newCoords = [...recordedCoords, { lat, lng }];
      setRecordedCoords(newCoords);

      // The recording line is drawn on the Google map; on the free map the points are still
      // recorded (and published) without it, rather than throwing on a missing window.google.
      if (!window.google?.maps || !mapRef.current) {
        // no Google map to draw on
      } else if (!recordingPolylineRef.current) {
        recordingPolylineRef.current = new window.google.maps.Polyline({
          path: newCoords, strokeColor: '#eab308', // Yellow for recording
          strokeOpacity: 1.0, strokeWeight: 4, map: mapRef.current
        });
      } else {
        recordingPolylineRef.current.setPath(newCoords);
      }
      return; // Stop normal click behavior
    }

    // 1b. If Admin is choosing the spot for a new place, the tap is that spot.
    if (isAdmin && isPlacing) {
      setDraftPlace({ lat, lng });
      setIsPlacing(false);
      setPlaceProblem(null);
    }
  };

  // --- TACTICAL ROUTING ENGINE ---
  // Sets the group's meeting point (publish-waypoint): only from the place card's "Set as
  // meeting point", once confirmed. Navigate used to do this too (8602d13, 2026-08-03, from
  // when it was the only way to share a place); since the redesign (P5c) it starts only
  // your own route.
  const publishSquadWaypoint = (destination) => {
    const waypoint = { lat: destination.lat, lng: destination.lng, name: destination.name };
    setActiveWaypoint(waypoint);
    if (squadCode) {
      socket.emit('publish-waypoint', { roomCode: squadCode, waypoint });
    }
  };

  const handleWaypointSelect = (targetCoords) => {
    if (!targetCoords) return;
    if (!locationReady) {
      turnOnLocation();
    }
    const origin = liveLocation || SRM_KTR_COORDS;
    setRouteStart({ name: "MY_LOCATION", ...origin });
    setRouteEnd(targetCoords);
    calculateActualRoute({ name: "MY_LOCATION", ...origin }, targetCoords);
    setSelectedItem(null);
    setIsNavigatingMode(true);
    setMobileView('grid');
    navigationController.handleRecenter();
    if (leafletMapRef.current) {
      leafletMapRef.current.flyTo([origin.lat, origin.lng], 19, { duration: 1.0 });
    }
  };

  // Keep routeStart synchronized when live GPS location updates
  useEffect(() => {
    if (liveLocation && routeStart?.name === 'MY_LOCATION') {
      setRouteStart((prev) => (prev ? { ...prev, lat: liveLocation.lat, lng: liveLocation.lng } : null));
    }
  }, [liveLocation?.lat, liveLocation?.lng]);

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
    setIsNavigatingMode(false);
  };

  // The route card's "End route" ends your own route and nothing else. It used to clear the
  // group's meeting point as well (2ec4aa8), back when Navigate was what set it; now the
  // meeting point goes only by Remove on its marker or the Group Lead's clear.



  // --- LIVE LOCATION MARKER STATE ---
  // The theme on screen, and the colours the map's lines are drawn in: Google's Polyline and
  // Leaflet's path options take literal colours, so they are read from the theme here.
  const resolvedTheme = useResolvedTheme();
  const routeColor = ROUTE_COLOR;
  const casingColor = ROUTE_CASING_COLOR;
  // How far a member is from you, for their plate on the map ("Meera · 120 m").
  const memberDistance = (u) => {
    const where = locateTarget(liveLocation, u);
    return where && !where.here ? distanceLabel(where.shownDistance) : null;
  };
  // A lost-connection member, tapped: their card says who and when they were last seen.
  const ghostFocusItem = (ghost) => ({
    name: ghost.phase === 'expired' ? MARKERS.lastSeenTitle(ghost.name) : MARKERS.lostConnectionTitle(ghost.name),
    info: MARKERS.lastBattery(ghost.battery ?? 0),
  });
  // Movement alone (no waypoint needed) already counts as "navigating" —
  // drop the speed clause here if that should require an explicit waypoint instead.
  // Your own destination (Navigate, from where you are), or null. Building-to-building routes
  // without a fix have no live start, so no walking line.
  const personalTarget = routeStart?.name === 'MY_LOCATION' && routeEnd ? routeEnd : null;
  const isNavigating = Boolean(activeWaypoint || personalTarget) || liveSpeed > NAVIGATING_SPEED_MPS;
  const liveHeading = useLiveHeading({
    lat: liveLocation?.lat,
    lng: liveLocation?.lng,
    speedMps: liveSpeed,
    compassHeading: heading,
  });

  // Dedicated Turn-by-Turn Pedestrian Navigation Controller
  const activeNavTarget = isNavigatingMode ? (personalTarget || activeWaypoint) : null;
  const navigationController = useNavigationController({
    isNavigating: Boolean(activeNavTarget),
    destination: activeNavTarget,
    liveLocation,
    liveHeading,
    speedMps: liveSpeed,
    mapEngine: googleShown ? 'google' : 'leaflet',
    mapInstance: googleShown ? mapRef.current : leafletMapRef.current,
  });

  const userInteractionHandlerRef = useRef(() => {});
  userInteractionHandlerRef.current = () => {
    if (isNavigatingMode) navigationController.handleUserMapInteraction();
  };

  // Live walking route to the active squad waypoint — real routed path from
  // Google Directions (or OSRM on the Leaflet fallback) when available,
  // throttled so it isn't recomputed on every GPS tick, straight-line "best
  // effort" fallback otherwise. Single source of truth consumed by both the
  // Google engine's imperative Polyline below and TacticalLeafletMap's
  // declarative one, so there's only one throttling clock, not two.
  const walkingRoute = useWalkingRoute({
    engine: 'leaflet', // the route does not depend on which map is showing, or switching would redraw it
    liveLocation,
    activeWaypoint,
  });
  // The same walking route, to your own destination while you have one: the map shows that
  // line instead of the meeting point's, and so does AR Scan's road line (arRoutePathFor).
  const personalRoute = useWalkingRoute({
    engine: 'leaflet', // the route does not depend on which map is showing, or switching would redraw it
    liveLocation,
    activeWaypoint: personalTarget,
  });
  const shownRoute = (isNavigatingMode && navigationController.activeRoute)
    ? navigationController.activeRoute
    : personalTarget
      ? personalRoute
      : walkingRoute;

  // While navigating, the line behind you disappears as you walk: only what is still ahead is
  // drawn (display only; navigation keeps the whole route).
  const drawnRoute = useMemo(() => {
    if (!isNavigatingMode || !shownRoute?.path) return shownRoute;
    return { ...shownRoute, path: trimRouteBehind(shownRoute.path, liveLocation) };
  }, [isNavigatingMode, shownRoute, liveLocation?.lat, liveLocation?.lng]);

  // Live navigation line from the operative's own position to the active
  // squad waypoint — same "no-op on Leaflet/before mount" gating as above.
  useWaypointNavigationLine(
    googleMounted && isMapReady ? mapRef.current : null,
    drawnRoute?.path,
    drawnRoute?.isRealRoute,
    routeColor,
    casingColor
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

  // Your own route (Navigate) is yours alone: it no longer closes when the group's meeting
  // point is removed, since choosing a destination no longer sets one.

  const isTrackingSquadWaypoint = Boolean(
    routeEnd && activeWaypoint && routeEnd.lat === activeWaypoint.lat && routeEnd.lng === activeWaypoint.lng
  );

  // The place card's Rally button. Any member can set the rally point (the server's rule); it is
  // cleared by the Commander, or by the member who set it (canClearWaypoint above).
  const rallyIsHere = (place) => rallyIsAt(activeWaypoint, place);
  const onCardRally = (place) => {
    const action = rallyAction({
      inGroup: hasJoinedSquad && Boolean(squadCode),
      isHere: rallyIsHere(place),
      canClear: canClearWaypoint,
    });
    if (action === 'join-first') notify.info(NOTICES.rally.joinFirst);
    else if (action === 'set') setMeetingPointToConfirm(place);
    else if (action === 'clear') setRallyToClear(place);
    else notify.info(NOTICES.rally.cannotClear);
  };
  // Navigate waits for a fix: a route from a made-up start is worse than none.
  const onCardNavigate = (place) => {
    if (!liveLocation) {
      turnOnLocation();
      notify.info(NOTICES.navigate.waitingForLocation);
      return;
    }
    handleWaypointSelect(place);
  };

  const displayedRouteData =
    (isNavigatingMode && navigationController.activeRoute)
      ? {
        distance: { text: formatDistanceMeters(navigationController.remainingDistanceMeters) },
        duration: { text: formatDurationMinutes(navigationController.remainingTimeMinutes) },
        isRealRoute: navigationController.activeRoute.isRealRoute,
        steps: navigationController.activeRoute.steps,
      }
      : (personalTarget && personalRoute) || (isTrackingSquadWaypoint && walkingRoute) || routeData;

  // --- TACTICAL MAP RENDERING ENGINE ---
  // Memoised on exactly the inputs that can change the map's configuration.
  // google-map-react shallow-compares this prop, so returning a fresh object (or a
  // freshly-built `styles` array) on every render made it call map.setOptions() —
  // a full restyle — on every render, which is what made the map flicker and feel
  // unresponsive to drags while the compass was ticking.
  // "Location is off" after the explainer's Not now, until location is turned on or the card
  // is dismissed.
  const showDeclinedCard = locationDeclined && !locationReady && !declinedCardDismissed;
  // The group panel's heights (utils/panelHeights.js). Until it has been measured (and in
  // tests, with no layout) closed is the screen's height and every open height is full.
  const atPeek = isMobile && sheetOpen && panelHeight === 'peek';
  // On a phone, a focused search box means the keyboard is up (see searchFocused).
  const keyboardUp = isMobile && searchFocused;
  const panelStopsNow = panelGeometry ?? { full: 0, half: 0, peek: 0, closed: typeof window === 'undefined' ? 1000 : window.innerHeight };
  const panelTarget = !isMobile ? 0 : sheetOpen ? panelStopsNow[panelHeight] : panelStopsNow.closed;
  // The peek line's counts: who is live, paused, waiting for a location, or lost.
  const peekCounts = (() => {
    const listed = users.filter(u => !blockedUserIds.includes(u.id));
    return {
      live: listed.filter(u => u.status !== 'FROZEN' && u.hasFix).length,
      paused: listed.filter(u => u.status === 'FROZEN' && u.hasFix).length,
      waiting: listed.filter(u => !u.hasFix).length,
      lost: ghostMembers.length,
    };
  })();
  // Everyone, for the peek row: you first, then the members by distance, then those who lost signal.
  const peekMembers = [
    { id: 'self', name: user?.displayName || 'You', photo: user?.photoURL || null, self: true, state: telemetryMode === 'ACTIVE' ? 'live' : telemetryMode === 'FROZEN' ? 'paused' : 'hidden' },
    ...sortByDistance(users.filter(u => !blockedUserIds.includes(u.id)), liveLocation).map(u => ({
      id: u.id,
      name: u.name || '?',
      photo: u.photo || null,
      state: !u.hasFix ? 'waiting' : u.status === 'FROZEN' ? 'paused' : 'live',
    })),
    ...ghostMembers.map(g => ({ id: g.id, name: g.name || '?', photo: g.photo || null, state: 'lost' })),
  ];
  // Measures the heights: the panel at full height, and how much shows at peek, which is its
  // header with the peek lines plus room under them for the Emergency button (5 rem tall,
  // standing 5 rem above the tab bar's 4 rem, plus the gesture bar's inset), so the buttons
  // that float above the panel never cover any of it.
  useLayoutEffect(() => {
    if (!isMobile || !hasJoinedSquad) return undefined;
    const measure = () => {
      const panel = sheetRef.current;
      const header = panelHeaderRef.current;
      // The header steps aside while the search box has focus: keep the heights it gave.
      if (!panel || !header || !panel.offsetHeight || !header.offsetHeight) return;
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const inset = insetProbeRef.current?.offsetHeight ?? 0;
      // The tab bar as tall as it really is: the group panel stands on it.
      const bar = document.querySelector('nav[aria-label="Main"]');
      const tabBar = bar?.offsetHeight || 5 * rem + inset;
      const room = 10 * rem + inset - tabBar + 0.5 * rem;
      const headerAtPeek = header.offsetHeight - (peekWrapRef.current?.offsetHeight ?? 0) + (peekLinesRef.current?.scrollHeight ?? 0);
      const next = panelStops({ viewport: window.innerHeight, panelHeight: panel.offsetHeight, peekHeight: headerAtPeek + room, tabBar });
      setPanelGeometry((prev) => (prev && ['full', 'half', 'peek', 'closed'].every((k) => prev[k] === next[k]) ? prev : next));
    };
    measure();
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(panelHeaderRef.current);
    const bar = document.querySelector('nav[aria-label="Main"]');
    if (bar) observer?.observe(bar);
    observer?.observe(sheetRef.current);
    return () => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [isMobile, hasJoinedSquad]);
  // Moves the panel to its resting height on the sheet spring (placed at once the first time,
  // and with reduced motion).
  const panelPlacedRef = useRef(false);
  useEffect(() => {
    if (!panelPlacedRef.current || reduceMotion) {
      panelY.set(panelTarget);
      panelPlacedRef.current = true;
      return undefined;
    }
    const controls = animateMotion(panelY, panelTarget, SHEET_SPRING);
    return () => controls.stop();
  }, [panelTarget, panelY, reduceMotion]);
  // Whose options sheet is open: an id, so it follows their live updates and closes if they go.
  const optionsMember = optionsMemberId
    ? users.find((u) => u.id === optionsMemberId) ??
    (() => {
      const ghost = ghostMembers.find((g) => g.id === optionsMemberId);
      if (!ghost) return null;
      return {
        id: ghost.id,
        name: ghost.name,
        lat: ghost.position?.lat,
        lng: ghost.position?.lng,
        battery: ghost.battery,
        status: 'GHOST',
        hasFix: true,
        phase: ghost.phase,
        elapsedLabel: ghost.elapsedLabel,
      };
    })()
    : null;
  // The group panel's search box, above the members. (Buildings are searched from the top bar.)
  const groupSearch = (
    <label className="relative block">
      <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none" size={18} aria-hidden="true" />
      <input
        type="search"
        aria-label={GROUP_TABS.searchMembers}
        placeholder={GROUP_TABS.searchMembers}
        className="w-full min-h-11 h-11 rounded-full glass-input pl-11 pr-10 font-ui text-[13px] text-text placeholder:text-text-secondary shadow-sm"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        // The panel steps aside, and back, only once the tap that moved focus has finished:
        // moving it under the finger would send that tap's click to whatever slid under it.
        onFocus={(e) => { const box = e.currentTarget; afterTap(() => document.activeElement === box, true); }}
        onBlur={(e) => { const box = e.currentTarget; afterTap(() => document.activeElement !== box, false); }}
      />
    </label>
  );
  // The members search above.
  const matchesSearch = (name) => (name || '').toLowerCase().includes(searchQuery.trim().toLowerCase());
  // A place matches on its name or any short name students use for it. The top bar's search.
  const matchesPlaceSearch = (place) => placeMatches(place, placeQuery);
  // Typing in the top bar's search brings the places list up: the panel opens on Buildings at
  // full height, where the results can be read.
  const searchPlaces = (text) => {
    setPlaceQuery(text);
    if (!text.trim()) return;
    setActiveTab('buildings'); setSelectedItem(null);
    if (isMobile) { setMobileView('matrix'); setPanelHeight('full'); }
  };
  // "You're in" says live only once there is a fix to share (Map batch fixes).
  // Paused says no spot is shared when the pause took none (Map batch fixes, owner's wording).
  const youreInKey = telemetryMode === 'ACTIVE' && !liveLocation ? 'waiting'
    : telemetryMode === 'FROZEN' && !pausedHasSpot ? 'pausedNoSpot'
      : telemetryMode;

  // The roadmap follows the app's theme (light or dark); satellite is photos either way.
  const mapOptions = useMemo(() => ({
    ...(isSatellite ? SATELLITE_MAP_OPTIONS : BASE_MAP_OPTIONS),
    ...(isSatellite ? {} : { styles: mapStylesFor(resolvedTheme) }),
    // Google renders its own clickable POI icons (hospitals, colleges, etc.)
    // straight onto the map tiles. Tapping one pops up Google's native white
    // InfoWindow on top of this app's own custom SYS_NODE panel — two
    // competing overlays stacked with clashing borders. This app already has
    // its own complete building database + marker/panel system, so Google's
    // built-in POI layer is pure UI collision here, not a needed feature.
    clickableIcons: false,
    draggableCursor: (isAdmin && (isRecordingPath || isPlacing)) ? 'crosshair' : 'grab',
  }), [isSatellite, resolvedTheme, isAdmin, isRecordingPath, isPlacing]);

  // A theme switch shows the Google map only once it has redrawn its tiles in the new style
  // (theme.js registerThemeSettle): under the switch's cover, or veiled in the new theme
  // until then, so the map never shows the old theme under the new one. Satellite photos
  // and the backup map don't restyle that way.
  // The restyle starts when the switch starts, under the cover's fade-in, rather than once the
  // theme is swapped: the tiles then have ~180 ms more to arrive before the cover has to lift.
  // The tiles-loaded wait is made here too, as the event may fire before the swap.
  const preparedTilesRef = useRef(null);
  useEffect(() => registerThemePrepare((theme) => {
    preparedTilesRef.current = null;
    const map = mapRef.current;
    const events = window.google?.maps?.event;
    if (!map || !events || isSatellite || mapEngineFailed) return;
    preparedTilesRef.current = new Promise((resolve) => { events.addListenerOnce(map, 'tilesloaded', () => resolve()); });
    map.setOptions({ styles: mapStylesFor(theme) });
  }), [isSatellite, mapEngineFailed]);

  useEffect(() => registerThemeSettle(() => {
    const map = mapRef.current;
    const events = window.google?.maps?.event;
    if (!map || !events || isSatellite || mapEngineFailed) return null;
    const prepared = preparedTilesRef.current;
    preparedTilesRef.current = null;
    return {
      ready: prepared || new Promise((resolve) => { events.addListenerOnce(map, 'tilesloaded', () => resolve()); }),
      veil: map.getDiv?.() ?? null,
    };
  }), [isSatellite, mapEngineFailed]);

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
      receivedAt={incomingSos.receivedAt}
      pendingCount={pendingSosCount}
      position={sosPosition}
      total={sosTotal}
      me={liveLocation}
      heading={heading}
      headingLive={hasHeadingReading}
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
      {/* Under the open group panel on a phone, so a notice never covers or takes the taps
          meant for the Group Lead's buttons there (as the old ping and lost-connection
          banners did, z-[850]); everywhere else, and over AR Scan, on top. */}
      <CommsFeed overArScan={Boolean(arTarget) && arScanReady} coveredBy={hasJoinedSquad && isMobile && sheetOpen ? sheetRef : null} />
    </>
  );

  // --- ANDROID BACK: one ladder for the whole app (hooks/useBackButtonGuard.js runs it) ---
  // Each press does the first of these that applies, top-most first: close an overlay (the
  // guide, Settings, admin tools, a sheet, a confirmation, a dialog), then step back a level
  // (choosing a meeting point, navigation, a place card, a route), then from any other tab or
  // the open group panel back to the map. Only with none of them left does Back reach the
  // "press again to exit" step. AR Scan registers its own handler above this one while it is
  // open. While an SOS is on screen Back does nothing at all (useBackButtonGuard's `blocked`),
  // so an alert can never be dismissed by an accidental Back.
  const backLadderRef = useRef(null);
  backLadderRef.current = () => {
    const steps = [
      [guideOpen, () => setGuideOpen(false)],
      [isSettingsOpen(), () => setSettingsOpen(false)],
      [showAdminSettings, () => setShowAdminSettings(false)],
      [isPlacing || Boolean(draftPlace), cancelAddPlace],
      [Boolean(optionsMemberId), () => setOptionsMemberId(null)],
      [showLeaveConfirm, () => setShowLeaveConfirm(false)],
      [Boolean(meetingPointToConfirm), () => setMeetingPointToConfirm(null)],
      [Boolean(rallyToClear), () => setRallyToClear(null)],
      [showRequestsModal, () => setShowRequestsModal(false)],
      [showActivityLog, () => setShowActivityLog(false)],
      [showBlocked, () => setShowBlocked(false)],
      [showFriendRequests, () => setShowFriendRequests(false)],
      [showTelemetryModal, () => setShowTelemetryModal(false)],
      [Boolean(deniedCode) && !hasJoinedSquad, () => { setSquadMode('join'); setSquadCode(deniedCode); setDeniedCode(null); }],
      [justApproved, () => setJustApproved(false)],
      [isTargetingMode, () => setIsTargetingMode(false)],
      [isNavigatingMode, () => setIsNavigatingMode(false)],
      [Boolean(selectedItem), () => setSelectedItem(null)],
      [Boolean(routeStart || routeData), clearRoute],
      [hasJoinedSquad && sheetOpen, () => setMobileView('grid')],
    ];
    const step = steps.find(([applies]) => applies);
    if (!step) return false;
    step[1]();
    return true;
  };
  useEffect(() => pushBackHandler(() => backLadderRef.current()), []);

  // Everything that sits over the screens before the map (boot, guide, sign-in, the lobby): the
  // update overlays, and an incoming SOS. A tapped SOS notification starts LOCUS cold into one of
  // these, and the alert must be the first thing seen there, not something waiting behind a lobby.
  const beforeMapOverlay = (
    <>
      {updateOverlay}
      {sosOverlay}
    </>
  );

  if (authLoading) return (
    <>
      {beforeMapOverlay}
      <BootScreen />
    </>
  );

  if (!user) {
    if (!hasSeenGuide) {
      return (
        <>
          {beforeMapOverlay}
          <Guide onDone={() => { rememberGuideSeen(); setHasSeenGuide(true); }} />
        </>
      );
    }
    return (
      <>
        {beforeMapOverlay}
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
    // Turned down: say so, and offer another try (the join tab, with the code kept to edit).
    if (deniedCode) {
      return (
        <>
          {beforeMapOverlay}
          <StatusScreen
            testId="not-approved"
            tone="warning"
            icon={<AlertCircle size={40} />}
            title={NOT_APPROVED.title}
            action={(
              <Button
                block
                size="large"
                onClick={() => { setSquadMode('join'); setSquadCode(deniedCode); setDeniedCode(null); setLobbyNotice(null); }}
              >
                {NOT_APPROVED.tryAnother}
              </Button>
            )}
          >
            <p>{NOT_APPROVED.body(deniedCode)}</p>
          </StatusScreen>
        </>
      );
    }

    // Opened again by someone who was in a Group: back to it, or the lobby. Never joined for them.
    if (resumeOffer) {
      return (
        <>
          {beforeMapOverlay}
          <StatusScreen
            testId="resume"
            icon={<Undo2 size={40} />}
            title={RESUME.title}
            action={(
              <div className="flex flex-col gap-3">
                <Button block size="large" onClick={returnToGroup}>{RESUME.returnButton(resumeOffer.code)}</Button>
                <Button block size="large" variant="secondary" onClick={startFresh}>{RESUME.freshButton}</Button>
              </div>
            )}
          >
            <p>{RESUME.body(resumeOffer.code, resumeOffer.role)}</p>
            <p>{RESUME.freshHelp}{backgroundSharing.on ? ` ${RESUME.sharingNote}` : ''}</p>
          </StatusScreen>
        </>
      );
    }

    // The lobby (redesign P3; words in src/copy/access.js): create a group, or join one by
    // its code. Why the server turned a request down (no group under that code, the group
    // ended, the code taken) shows in the card, in amber.
    const joining = squadMode === 'join';
    const lobbyProblemId = 'lobby-problem';
    return (
      <div
        className="min-h-[100dvh] bg-bg text-text font-ui px-5 flex flex-col"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 3rem)', paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}
      >
        {beforeMapOverlay}
        <main className="w-full max-w-md mx-auto flex-1">
          <p className="text-body text-text-secondary">{LOBBY.hello(firstNameOf(user.displayName))}</p>
          <h1 className="mt-1 text-display">{LOBBY.title}</h1>

          <SegmentedControl
            className="mt-6"
            label={LOBBY.modes}
            value={squadMode}
            onChange={(mode) => {
              if (mode === squadMode) return;
              setSquadMode(mode);
              setSquadCode(mode === 'create' ? generateRandomSquadCode() : '');
              setLobbyNotice(null);
            }}
            options={[
              { value: 'create', label: LOBBY.createTab },
              { value: 'join', label: LOBBY.joinTab },
            ]}
          />

          <Card className="mt-5">
            {joining ? (
              <>
                <p className="mb-3 text-secondary font-semibold text-text-secondary">{LOBBY.joinCode}</p>
                <CodeInput
                  value={squadCode}
                  onChange={(code) => { setSquadCode(code); setLobbyNotice(null); }}
                  onSubmit={handleJoinSquad}
                  problem={Boolean(lobbyNotice)}
                  describedBy={lobbyNotice ? lobbyProblemId : undefined}
                />
                {lobbyNotice && (
                  <p id={lobbyProblemId} role="alert" className="mt-4 flex items-start gap-2 text-body text-text">
                    <AlertCircle size={20} className="shrink-0 mt-0.5 text-warning" aria-hidden="true" />
                    {lobbyNotice}
                  </p>
                )}
                <p className="mt-4 text-secondary text-text-secondary">{LOBBY.joinHelp}</p>
              </>
            ) : (
              <>
                <p className="mb-3 text-secondary font-semibold text-text-secondary">{LOBBY.yourCode}</p>
                {lobbyNotice && (
                  <InlineMessage tone={lobbyNotice === LOBBY.codeTaken ? 'info' : 'warning'} className="mb-4">{lobbyNotice}</InlineMessage>
                )}
                <CodeTiles code={squadCode} onNewCode={() => { setSquadCode(generateRandomSquadCode()); setLobbyNotice(null); }} />
                <p className="mt-4 text-secondary text-text-secondary">{LOBBY.createHelp}</p>
              </>
            )}
          </Card>
        </main>

        <div className="w-full max-w-md mx-auto mt-6">
          <Button block size="large" onClick={handleJoinSquad} disabled={!squadCode.trim()}>
            {joining ? LOBBY.joinButton : LOBBY.createButton}
          </Button>
          {/* Settings opens only from the map, so the lobby has its own way to sign out. */}
          <Button variant="plain" onClick={handleLogout} block className="mt-2">
            {LOBBY.signOut}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-full bg-bg flex overflow-hidden text-text font-inter selection:bg-accent-soft bg-dots">

      {/* Top bar and sharing chip (components/map/TopBar.jsx) */}
      {!isNavigatingMode && (
        <TopBar
          isSatellite={isSatellite}
          query={placeQuery}
          onQuery={hasJoinedSquad ? searchPlaces : undefined}
          // With the keyboard up the panel's header steps aside, so the results show above it.
          onSearchFocus={setSearchFocused}
        />
      )}

      {/* Sidebar Panel — visible on desktop always; on a phone, a sheet that is open when
          mobileView is 'matrix' or 'squad' and can be dragged down by its handle strip. */}
      {!isNavigatingMode && (
        <motion.div
          // Its y is panelY, moved to the resting height by the effect on panelTarget, and by
          // the finger while dragged (the handle strip and header start the drag).
          data-height={isMobile ? (sheetOpen ? panelHeight : 'closed') : undefined}
          drag={isMobile && sheetOpen ? 'y' : false}
          dragListener={false}
          dragControls={sheetDragControls}
          dragConstraints={{ top: 0, bottom: panelStopsNow.closed }}
          // Follows the finger almost 1:1 between the heights, and rubber-bands above full.
          dragElastic={{ top: 0.06, bottom: 0.2 }}
          dragMomentum={false}
          onDragStart={() => { sheetDraggedRef.current = true; panelDragStartRef.current = panelTarget; }}
          onDragEnd={(_event, info) => {
            // Decide from where the throw is GOING, not where the finger let go: project the
            // release velocity forward (Apple's scroll-deceleration projection), and settle at
            // the nearest height to that: peek, half, full, or closed. Where it was let go is
            // where the drag started plus how far it went, kept on the panel.
            const letGo = Math.min(panelStopsNow.closed, Math.max(0, panelDragStartRef.current + info.offset.y));
            const next = snapPanel(letGo, info.velocity.y, panelStopsNow);
            haptic('snap');
            animateMotion(panelY, panelStopsNow[next], reduceMotion ? { duration: 0 } : SHEET_SPRING);
            if (next === 'closed') setMobileView('grid');
            else setPanelHeight(next);
          }}
          ref={sheetRef}
          className={`${isMobile
              ? `fixed inset-x-0 z-[900] flex flex-col glass-solid text-text rounded-t-[28px] ${sheetOpen ? 'pointer-events-auto' : 'pointer-events-none invisible'
              }`
              : 'hidden md:flex w-84 glass-floating text-text rounded-3xl fixed z-[900] flex-col pointer-events-auto top-20 left-6 bottom-6 h-auto'
            }`}
          // Starts under the header instead of behind it (it used to start at the very top, so
          // its handle and MATRIX/SQUAD indicator were hidden under the header).
          style={isMobile ? { top: BELOW_TOP_BAR, bottom: 'var(--tab-bar-height)', y: panelY } : undefined}
          // A clearly sideways swipe changes section (utils/panelSwipe.js); a scroll of the list,
          // however it drifts sideways, never does.
          onTouchStart={(e) => {
            const list = e.currentTarget.querySelector('[data-testid="group-panel-list"]');
            panelSwipeRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, scrollTop: list?.scrollTop ?? 0 };
          }}
          onTouchEnd={(e) => {
            const start = panelSwipeRef.current;
            panelSwipeRef.current = null;
            const list = e.currentTarget.querySelector('[data-testid="group-panel-list"]');
            const scrolled = Boolean(start) && (list?.scrollTop ?? 0) !== start.scrollTop;
            const direction = sectionSwipe(start, { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY }, scrolled);
            if (direction === 'left') {
              // Swiped LEFT → go to Squad
              setActiveTab('users'); setSelectedItem(null);
              if (isMobile) setMobileView('squad');
            } else if (direction === 'right') {
              // Swiped RIGHT → go to Matrix
              setActiveTab('buildings'); setSelectedItem(null);
              if (isMobile) setMobileView('matrix');
            }
          }}
        >
          {/* The header (components/group/GroupHeader.jsx): "Your group", your role, the code and
            Copy. On a phone it is the panel's drag handle too: pressing anywhere on it starts the
            drag, and a plain tap still closes the panel, as the handle did. */}
          <div
            className={`${keyboardUp ? 'hidden ' : ''}shrink-0 select-none pt-3 md:pt-4 touch-none md:touch-auto cursor-grab active:cursor-grabbing md:cursor-auto`}
            data-testid="group-panel-header"
            data-no-ping
            onPointerDown={(e) => { if (!isMobile) return; sheetDraggedRef.current = false; sheetDragControls.start(e); }}
            // A drag that snapped back still ends in a click; only a real tap closes.
            // At peek a tap opens it to half; at half or full it closes, as the handle did.
            onClick={() => {
              if (!isMobile || sheetDraggedRef.current) return;
              if (panelHeight === 'peek') setPanelHeight('half');
              else setMobileView('grid');
            }}
            ref={panelHeaderRef}
          >
            {/* The three-point slider: peek shows the members, half the options, full everything. */}
            {isMobile && sheetOpen ? (
              <PanelStops height={panelHeight} onChange={setPanelHeight} />
            ) : (
              <div className="md:hidden w-10 h-1 rounded-full bg-[var(--glass-border)] mx-auto mb-3" aria-hidden="true" />
            )}
            <GroupHeader isLead={squadRole === 'OWNER'} code={squadCode}>
              {/* The peek height's lines: laid out always on a phone (so peek's height is known
                at every height), shown only at peek. */}
              {isMobile && (
                <div ref={peekWrapRef} className="grid" style={{ gridTemplateRows: atPeek ? '1fr' : '0fr' }} inert={!atPeek} aria-hidden={!atPeek}>
                  <div ref={peekLinesRef} className="overflow-hidden min-h-0">
                    <PeekLines
                      requests={pendingRequests.length}
                      onRequests={canModerate ? () => setShowRequestsModal(true) : null}
                      members={peekMembers}
                      onMember={(id) => {
                        const member = users.find((u) => u.id === id);
                        if (member?.hasFix) focusMember(member);
                        else setOptionsMemberId(id);
                      }}
                      counts={peekCounts}
                    />
                  </div>
                </div>
              )}
            </GroupHeader>
            {/* Measures the gesture bar's inset, for the room left under the buttons at peek. */}
            <div ref={insetProbeRef} aria-hidden="true" className="absolute w-0 invisible pointer-events-none" style={{ height: 'env(safe-area-inset-bottom)' }} />
          </div>


          {/* List Content */}
          {/* Room at the bottom on a phone under the last row: SHEET_BOTTOM_PADDING_PX, one tab bar's
            measured height and 2 rem (utils/panelHeights.js). The panel ends at the top of the tab
            bar; the spacer at the end of the list is what makes room for the part of the panel
            that lies below the screen at half and peek. */}
          {/* At half, the first scroll through the list (members or places) lifts the panel to
            full: there is little of the list to read through at half, so the panel makes room. */}
          <div
            data-testid="group-panel-list"
            onTouchStart={(e) => { listTouchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
            onTouchMove={(e) => {
              const from = listTouchRef.current;
              if (!from || !isMobile || !sheetOpen || panelHeight !== 'half') return;
              const dx = e.touches[0].clientX - from.x;
              const dy = e.touches[0].clientY - from.y;
              // A mostly vertical move; a finger dragging down only scrolls the list once it is
              // below its top.
              if (Math.abs(dy) < 8 || Math.abs(dy) < Math.abs(dx)) return;
              if (dy > 0 && e.currentTarget.scrollTop <= 0) return;
              listTouchRef.current = null;
              setPanelHeight('full');
            }}
            onWheel={(e) => { if (isMobile && sheetOpen && panelHeight === 'half' && e.deltaY !== 0) setPanelHeight('full'); }}
            className={`${atPeek ? 'invisible ' : ''}flex-1 overflow-y-auto overscroll-contain p-4 pt-1 md:pb-4 custom-scrollbar ${activeTab === 'buildings' ? 'space-y-3' : 'space-y-1'}`}
            style={isMobile ? { paddingBottom: SHEET_BOTTOM_PADDING_PX } : undefined}
          >
            <SegmentedControl
              label={GROUP_TABS.label}
              value={activeTab === 'buildings' ? 'buildings' : 'users'}
              onChange={(tab) => {
                setActiveTab(tab); setSelectedItem(null);
                if (isMobile) setMobileView(tab === 'buildings' ? 'matrix' : 'squad');
              }}
              options={[
                { value: 'users', label: GROUP_TABS.members },
                { value: 'buildings', label: GROUP_TABS.buildings },
              ]}
            />
            {/* Buildings: no search box here; it is the search icon beside LOCUS in the top bar.
              (Members: it sits above the members list, under the controls, so a Group Lead's
              tools come higher at half height.) */}

            {/* Category Filter Pills (Minimalist Apple/Glass Design) */}
            {activeTab === 'buildings' && (
              <div className="flex items-center gap-2 overflow-x-auto pb-1 pt-0.5 no-scrollbar -mx-1 px-1">
                {[
                  { id: 'ALL', label: 'All' },
                  { id: 'ACADEMIC', label: 'Academic' },
                  { id: 'ENGINEERING', label: 'Engineering' },
                  { id: 'MEDICAL', label: 'Medical' },
                  { id: 'RESIDENTIAL', label: 'Hostels' },
                  { id: 'LOGISTICS', label: 'Cafes & Hubs' },
                  ...(campusPlaces.some(b => isGrounds(b)) ? [{ id: 'GROUNDS', label: 'Grounds' }] : []),
                ].map((cat) => {
                  const isSelected = buildingCategoryFilter === cat.id;
                  const count = cat.id === 'ALL'
                    ? campusPlaces.length
                    : campusPlaces.filter(b => b.category === cat.id).length;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setBuildingCategoryFilter(cat.id)}
                      className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium font-ui transition-all duration-150 flex items-center gap-1.5 cursor-pointer border ${isSelected
                          ? 'bg-accent text-accent-on border-accent shadow-sm'
                          : 'glass-pill text-text-secondary hover:text-text'
                        }`}
                    >
                      <span>{cat.label}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-normal ${isSelected ? 'bg-white/20 text-accent-on' : 'bg-sunken text-text-secondary'}`}>
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Nearby Places Section Header */}
            {activeTab === 'buildings' && (
              <div className="flex items-center justify-between pt-1 pb-0.5">
                <h3 className="text-sm font-semibold font-ui text-text flex items-center gap-2 tracking-tight">
                  <span>Nearby Places</span>
                  <span className="text-xs font-normal text-text-secondary">
                    ({campusPlaces.filter(b => matchesPlaceSearch(b) && (buildingCategoryFilter === 'ALL' || b.category === buildingCategoryFilter)).length})
                  </span>
                </h3>
              </div>
            )}

            {activeTab === 'buildings' && placeQuery.trim() && !campusPlaces.some(b => matchesPlaceSearch(b)) && (
              <p className="py-3 font-ui text-secondary text-text-secondary" data-testid="buildings-no-match">{GROUP_BUILDINGS_LIST.noMatch(placeQuery.trim())}</p>
            )}
            {/* The Group Lead's tools come first, before Your location (the design has them after):
              at half height on a 360 px phone they would otherwise sit under the Emergency button,
              which stays above the panel. */}
            {activeTab === 'users' && canModerate && !keyboardUp && (
              <LeadTools
                moderatorOnly={myRole !== 'admin'}
                onActivityLog={openActivityLog}
                onBlocked={canBlock ? openBlocked : undefined}
                requests={pendingRequests.length}
                onRequests={() => setShowRequestsModal(true)}
                refresh={telemetrySync}
                onRefresh={requestTelemetrySync}
                choosing={isTargetingMode}
                onMeetingPoint={() => {
                  const choosing = !isTargetingMode;
                  setIsTargetingMode(choosing);
                  // On a phone the open panel covers the map the spot is chosen on.
                  if (choosing && isMobile) setMobileView('grid');
                }}
                hasMeetingPoint={Boolean(activeWaypoint)}
                onRemoveMeetingPoint={() => socket.emit('clear-waypoint', squadCode)}
                sos={groupSettings?.roomCode === squadCode && Array.isArray(groupSettings.sosCooldownPresetsMs) ? {
                  enabled: groupSettings.sosEnabled !== false,
                  cooldownMs: groupSettings.sosCooldownMs,
                  presetsMs: groupSettings.sosCooldownPresetsMs,
                  onEnabled: (on) => changeGroupSettings({ sosEnabled: on }),
                  onCooldown: (ms) => changeGroupSettings({ sosCooldownMs: ms }),
                } : undefined}
              />
            )}
            {/* Your location: Live, Paused or Hidden (components/group/SharingControl.jsx). */}
            {activeTab === 'users' && (
              <SharingControl
                mode={telemetryMode}
                onChange={changeSharingMode}
                waiting={!liveLocation}
                pausedNoSpot={!pausedHasSpot}
                polling={sysConfig.polling}
              />
            )}
            {/* The members list's heading and its states (components/group/MembersHeading.jsx). */}
            {activeTab === 'users' && (
              <MembersHeading count={users.filter(u => !blockedUserIds.includes(u.id)).length + ghostMembers.length + 1} updatedAt={rosterAt} />
            )}
            {/* Friend requests waiting for this person, above the members (FriendRequests.jsx). */}
            {activeTab === 'users' && friends.incoming.length > 0 && (
              <Button variant="secondary" block onClick={() => setShowFriendRequests(true)}>
                {FRIENDS.requestsButton(friends.incoming.length)}
              </Button>
            )}
            {activeTab === 'users' && groupSearch}
            {activeTab === 'users' && rosterAt === null && <MembersLoading />}
            {activeTab === 'users' && rosterAt !== null && !users.some(u => !blockedUserIds.includes(u.id)) && ghostMembers.length === 0 && (
              <MembersEmpty code={squadCode} isLead={squadRole === 'OWNER'} />
            )}
            {activeTab === 'users' && searchQuery.trim() && !users.some(u => !blockedUserIds.includes(u.id) && matchesSearch(u.name)) && !ghostMembers.some(g => matchesSearch(g.name)) && (users.length > 0 || ghostMembers.length > 0) && (
              <p className="py-3 font-ui text-secondary text-text-secondary" data-testid="members-no-match">{GROUP_MEMBERS_LIST.noMatch(searchQuery.trim())}</p>
            )}
            <AnimatePresence mode="popLayout" initial={false}>
              {activeTab === 'buildings' ? (
                campusPlaces
                  .filter(b => matchesPlaceSearch(b) && (buildingCategoryFilter === 'ALL' || b.category === buildingCategoryFilter))
                  .map((building, idx) => (
                    <motion.div
                      layout
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.98 }}
                      transition={{
                        opacity: { duration: 0.22, ease: [0.22, 1, 0.36, 1] },
                        y: { duration: 0.24, ease: [0.22, 1, 0.36, 1], delay: Math.min(idx, 5) * 0.03 },
                        scale: { duration: 0.18, ease: [0.22, 1, 0.36, 1] },
                        layout: { duration: 0.25, ease: [0.22, 1, 0.36, 1] },
                      }}
                      key={building.id}
                    >
                      <BuildingRow
                        building={building}
                        me={liveLocation}
                        onOpen={() => handleBuildingTap(building)}
                        onArScan={() => setArTarget({ lat: building.lat, lng: building.lng, name: building.name })}
                        onNavigate={() => handleWaypointSelect(building)}
                      />
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
                  ...ghostMembers.filter(g => matchesSearch(g.name)).map(ghost => (
                    <motion.div
                      layout
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      key={`ghost-row-${ghost.id}`}
                      data-testid="lost-member-row"
                      onClick={() => {
                        focusMember(ghost, ghost.position);
                        setOptionsMemberId(ghost.id);
                      }}
                      className="flex items-center gap-3 p-3 rounded-2xl glass-panel font-ui text-text cursor-pointer hover:bg-surface/90 transition-all duration-150"
                    >
                      <Avatar name={ghost.name || '?'} dashed className="opacity-70" />
                      <div className="flex-1 min-w-0">
                        <h4 className="text-heading truncate text-text-secondary">{ghost.name}</h4>
                        <p className="mt-0.5 text-secondary text-text-secondary">
                          {ghost.phase === 'expired' ? GROUP_MEMBERS.lastSeen(ghost.elapsedLabel) : GROUP_MEMBERS.lostConnection(ghost.elapsedLabel)}
                        </p>
                      </div>
                      <WifiOff size={20} className="text-text-secondary shrink-0" aria-hidden="true" />
                    </motion.div>
                  )),
                  // Nearest first (by straight-line distance from this phone); members with no
                  // fix yet go last. See SquadMemberCard for the dial and freshness line.
                  ...sortByDistance(users.filter(u => !blockedUserIds.includes(u.id) && matchesSearch(u.name)), liveLocation).map(user => (
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
                        onOptions={(m) => setOptionsMemberId(m.id)}
                        onFocus={focusMember}
                        isFriend={Boolean(user.uid) && friends.friends.has(user.uid)}
                      />
                    </motion.div>
                  )),
                ]
              )}
            </AnimatePresence>
            {activeTab === 'users' && <LeaveGroupButton onClick={() => setShowLeaveConfirm(true)} />}
            {/* The panel rests lower than full by this much: room to scroll the last rows up into
              view at half. */}
            {isMobile && sheetOpen && panelStopsNow[panelHeight] > 0 && <div aria-hidden="true" style={{ height: panelStopsNow[panelHeight] }} />}
          </div>
        </motion.div>
      )}

      {/* --- WAITING FOR APPROVAL, AND "YOU'RE IN" (redesign P3) --- */}
      {/* Full screens over the map and its tab bar, under the Emergency button (see
          StatusScreen). Waiting used to be a dark overlay with the tab bar still on top. */}
      {hasJoinedSquad && accessStatus === 'returning' && (
        <StatusScreen
          testId="returning"
          icon={<Loader2 size={40} className="animate-spin motion-reduce:animate-none" />}
          title={RESUME.returningTitle}
          emergencyNote={WAITING.emergency}
          action={(
            <Button variant="secondary" block size="large" onClick={startFresh}>{RESUME.freshButton}</Button>
          )}
        >
          <p>{RESUME.returningBody(squadCode)}</p>
        </StatusScreen>
      )}
      {hasJoinedSquad && accessStatus !== 'granted' && accessStatus !== 'returning' && (
        <StatusScreen
          testId="waiting"
          icon={<Loader2 size={40} className="animate-spin motion-reduce:animate-none" />}
          title={WAITING.title}
          emergencyNote={WAITING.emergency}
          action={(
            <Button
              variant="secondary"
              block
              size="large"
              onClick={() => {
                // Tell the server too. It used to go on holding the request, and a Commander
                // who tapped GRANT later pulled this user into their squad, wherever they had
                // gone since (see resolve-access in backend/server.js).
                socket.emit('cancel-join', { roomCode: squadCode.trim().toUpperCase() });
                setHasJoinedSquad(false);
                setAccessStatus(null);
              }}
            >
              {WAITING.cancel}
            </Button>
          )}
        >
          <p>{WAITING.body(squadCode)}</p>
        </StatusScreen>
      )}
      {justApproved && accessStatus === 'granted' && (
        <StatusScreen
          testId="youre-in"
          tone="success"
          icon={<Check size={40} />}
          title={YOURE_IN.title}
          action={<Button block size="large" onClick={() => setJustApproved(false)}>{YOURE_IN.openMap}</Button>}
        >
          {/* Says what is actually happening to their location: the mode is kept from their
              last group, so this isn't always "live", and live with no fix yet shares nothing. */}
          <p>{YOURE_IN.body[youreInKey]}</p>
          <span className="inline-flex items-center gap-2 min-h-10 px-4 rounded-full bg-surface border border-border shadow-[var(--shadow-1)] text-label text-text">
            <span
              aria-hidden="true"
              className={`w-2.5 h-2.5 rounded-full ${youreInKey === 'waiting' ? 'bg-border-control' : telemetryMode === 'ACTIVE' ? 'bg-success' : telemetryMode === 'FROZEN' ? 'bg-warning' : 'border border-dashed border-border-control'}`}
            />
            {YOURE_IN.chip[youreInKey]}
          </span>
        </StatusScreen>
      )}
      {/* ---  TACTICAL GEOFENCE HUD --- */}
      {/* The stack under the top bar (redesign Map batch, pieces 1, 6 and 7): the sharing chip,
          or a banner in its place (choosing a meeting point, the location problem), then your
          route. One column, so none of them lands on another. On a phone it sits under the
          open group panel (z-[850] < 900) and lets taps through except on its own buttons:
          the location banner used to cover the Group Lead's buttons there. */}
      <div
        data-testid="map-top-stack"
        className={`absolute inset-x-3 z-[850] md:z-[1000] md:left-1/2 md:right-auto ${isNavigatingMode ? 'md:w-[32rem]' : 'md:w-[28rem]'
          } md:-translate-x-1/2 pointer-events-none flex flex-col gap-2`}
        style={isNavigatingMode ? { top: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)' } : { top: BELOW_TOP_BAR }}
      >
        {/* Always mounted, only hidden while a banner stands in its place: coming and going with
            every location hiccup made it open afresh each time (components/map/TopBar.jsx). */}
        <SharingChip
          mode={telemetryMode}
          waiting={!liveLocation}
          pausedNoSpot={!pausedHasSpot}
          hidden={isNavigatingMode || (isTargetingMode && isMobile) || Boolean(locationError) || showDeclinedCard}
        />
        <AnimatePresence initial={false}>
          {/* Choosing a meeting point (a phone's meeting point button). */}
          {isTargetingMode && (
            <motion.div key="choosing-meeting-point" className="md:hidden" {...fade()}>
              <MeetingPointBanner onCancel={() => setIsTargetingMode(false)} />
            </motion.div>
          )}
          {/* Persistent (not auto-dismissing): the problem doesn't go away on its own, so this
              stays until a real fix clears it or it is dismissed. Without it, someone with
              location refused just sees no marker anywhere, with no word of why. */}
          {locationError && (
            <motion.div key="location-problem" {...fade()}>
              <LocationProblemCard
                kind={locationError}
                onDismiss={() => setLocationError(null)}
                onTurnOn={locationError === 'denied' ? turnOnLocation : null}
              />
            </motion.div>
          )}
          {/* Location left off at the explainer (Not now). */}
          {!locationError && showDeclinedCard && (
            <motion.div key="location-declined" {...fade()}>
              <LocationProblemCard kind="denied" onDismiss={() => setDeclinedCardDismissed(true)} onTurnOn={turnOnLocation} />
            </motion.div>
          )}
          {isNavigatingMode && activeNavTarget ? (
            <motion.div key="turn-instruction-card" className="pointer-events-auto w-full" {...fade()}>
              <TurnInstructionCard
                currentStep={navigationController.currentStep}
                nextStep={navigationController.nextStep}
                distanceToNextMeters={navigationController.distanceToNextStepMeters}
                isRerouting={navigationController.isRerouting}
                rerouteError={navigationController.rerouteError}
                onRetryReroute={navigationController.retryReroute}
                onEnd={() => {
                  setIsNavigatingMode(false);
                  clearRoute();
                }}
                destinationName={activeNavTarget.name}
                remainingMeters={navigationController.remainingDistanceMeters}
                remainingMinutes={navigationController.remainingTimeMinutes}
              />
            </motion.div>
          ) : (routeStart || routeData) ? (
            <motion.div key="route-card" className="pointer-events-auto" {...fade()}>
              <RouteCard
                start={routeStart}
                end={routeEnd}
                data={displayedRouteData}
                onEnd={clearRoute}
                onStartNavigation={() => {
                  if (!locationReady) {
                    turnOnLocation();
                  }
                  setIsNavigatingMode(true);
                  if (routeEnd) {
                    handleFocus(routeStart?.name === 'MY_LOCATION' && liveLocation ? liveLocation : routeEnd, null);
                  }
                }}
              />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
      {/* "Finding your location…" while the first fix is on its way. */}
      {locationReady && !liveLocation && !locationError && <FindingLocation />}

      {/* The location explainer, once you are on the map, until location is allowed. */}
      <LocationExplainer
        open={permissionChecked && !locationReady && !locationDeclined && !justApproved}
        onContinue={() => setLocationExplained(true)}
        onNotNow={() => setLocationDeclined(true)}
      />
      {/* FULLSCREEN MAP */}
      <div className="absolute inset-0 z-0 bg-[var(--color-map-land)]">
        {/* The free map is always mounted and is the normal map. Google, once asked for by a
            satellite tap, stays mounted for the session and is only hidden and shown. */}
        <div
          className="absolute inset-0"
          style={{ visibility: googleShown ? 'hidden' : 'visible' }}
          aria-hidden={googleShown}
          data-testid="free-map-layer"
        >
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
              onMapInstance={(map) => { leafletMapRef.current = map; }}
              driverActive={!googleShown}
              onUserInteraction={() => {
                if (isNavigatingMode) navigationController.handleUserMapInteraction();
              }}
              liveLocation={showSelfMarker ? selfMarkerAt : null}
              liveIndoor={selfIndoor}
              indoorView={indoorView}
              liveIsNavigating={isNavigating || isNavigatingMode}
              liveHeading={liveHeading}
              currentZoom={currentZoom}
              currentRoadName={isNavigatingMode ? navigationController.currentStep?.instruction : null}
              routeSteps={isNavigatingMode ? navigationController.activeRoute?.steps : null}
              users={users}
              blockedUserIds={blockedUserIds}
              ghostMembers={ghostMembers}
              activeTab={activeTab}
              showBuildings={buildingDotsShown}
              places={campusPlaces}
              draftPlace={isAdmin ? draftPlace : null}
              activeWaypoint={activeWaypoint}
              walkingRoute={drawnRoute}
              canClearWaypoint={canClearWaypoint}
              highlightBuildingId={(activeTab === 'buildings' && selectedItem?.id) || routeEnd?.id || null}
              onSelectMember={setOptionsMemberId}
              onClearWaypoint={() => socket.emit('clear-waypoint', squadCode)}
              onArTrack={setArTarget}
              isSatellite={isSatellite && !googleUsable}
              routeColor={routeColor}
              casingColor={casingColor}
              memberDistance={memberDistance}
              ghostFocusItem={ghostFocusItem}
              focusedMemberId={focusedMemberId}
            />
          </Suspense>
        </div>
        {googleMounted && (
        <div
          className="absolute inset-0"
          style={{ visibility: googleShown ? 'visible' : 'hidden', pointerEvents: googleShown ? 'auto' : 'none' }}
          aria-hidden={!googleShown}
          data-testid="google-map-layer"
        >
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
              // Registered as the live camera driver only while Google is the visible map
              // (the effect on googleShown); the free map owns it the rest of the time.
              googleDriverRef.current = {
                element: map.getDiv?.(),
                getView: () => ({ lat: map.getCenter().lat(), lng: map.getCenter().lng(), zoom: map.getZoom() }),
                // Fractional zoom only exists on vector maps (moveCamera); raster maps take whole levels.
                setView: ({ lat, lng, zoom }) => {
                  if (typeof map.moveCamera === 'function') map.moveCamera({ center: { lat, lng }, zoom });
                  else { map.setCenter({ lat, lng }); map.setZoom(Math.round(zoom)); }
                },
              };

              // Listen for user manual drag/zoom to disable automatic camera follow
              map.addListener('dragstart', () => userInteractionHandlerRef.current());
              map.addListener('drag', () => userInteractionHandlerRef.current());
              const div = map.getDiv?.();
              if (div) {
                div.addEventListener('touchstart', () => userInteractionHandlerRef.current(), { passive: true });
                div.addEventListener('mousedown', () => userInteractionHandlerRef.current(), { passive: true });
              }

              //  GREEN LIGHT: Map canvas is live — safe to draw saved zones now
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
                  isNavigating={isNavigating || isNavigatingMode}
                  heading={liveHeading}
                  accuracy={liveAccuracy}
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
            {buildingDotsShown && campusPlaces.map(b => (
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
            {/* Add Place: the spot the admin just chose, until it is saved or cancelled. */}
            {isAdmin && draftPlace && (
              <div lat={draftPlace.lat} lng={draftPlace.lng}>
                <BuildingMarker highlighted />
              </div>
            )}
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
                onClick={(e) => {
                  e?.stopPropagation?.();
                  handleFocus({ lat: u.lat, lng: u.lng }, null);
                  setOptionsMemberId(u.id);
                }}
                style={{
                  cursor: 'pointer',
                  pointerEvents: 'auto',
                  zIndex: u.id === focusedMemberId ? 46 : 45,
                  animation: 'locus-member-fade-in 0.6s ease',
                  // Stage 7: on another floor of the building you're viewing - dimmed, never hidden.
                  ...(SHOW_INDOOR_POSITION_TO_SQUAD && isOnOtherFloor(u, indoorView) ? { opacity: 0.35 } : {}),
                }}
              >
                <MemberMarker
                  name={u.name}
                  paused={u.status === 'FROZEN'}
                  isNavigating={Boolean(activeWaypoint) || (u.speed / 3.6) > NAVIGATING_SPEED_MPS}
                  heading={u.heading}
                  distance={memberDistance(u)}
                  highlighted={u.id === focusedMemberId}
                  lastSeen={u.lastSeen}
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
                onClick={(e) => {
                  e?.stopPropagation?.();
                  handleFocus(ghost.position, ghostFocusItem(ghost));
                  setOptionsMemberId(ghost.id);
                }}
                style={{
                  cursor: 'pointer',
                  pointerEvents: 'auto',
                  zIndex: 44,
                  opacity: ghost.fading ? 0 : 1,
                  transition: `opacity ${GHOST_FADE_MS}ms ease`
                }}
              >
                <GhostMemberMarker name={ghost.name} phase={ghost.phase} elapsedLabel={ghost.elapsedLabel} highlighted={ghost.id === focusedMemberId} />
              </div>
            ))}


            {/* ... Your existing users.filter map loop stays exactly the same below this ... */}
          </GoogleMapReact>
        </div>
        )}
        {/* PHASE 3: Satellite toggle pill removed — function reassigned to Bottom HUD GRID button */}
      </div>

      {/* The bar on the map while the owner records a path (components/admin/AdminTools.jsx). */}
      {isAdmin && isRecordingPath && (
        <RecordingBar points={recordedCoords.length} onPublish={publishRecordedRoute} onAbort={abortRecording} />
      )}

      {/* Map Interactive Layers */}
      {/* WiFi Arc Stage 7: floor picker, in whatever building you're in. */}
      {WIFI_POSITIONING_ENABLED && indoorView && <FloorPicker view={indoorView} />}
      {/* Owner-only field-test readout: every scan cycle's numbers, for judging the estimates. */}
      {WIFI_POSITIONING_ENABLED && isAdmin && <WifiReadout lastCycle={lastCycle} active={wifiActive} />}

      {/* Right-hand map controls (components/map/MapControls.jsx) */}
      <MapControls
        onCampus={() => handleFocus(SRM_KTR_COORDS, null)}
        onLocate={selfMarkerAt ? () => {
          if (isNavigatingMode) {
            // Re-center while navigating
            navigationController.handleRecenter();
            if (liveLocation) {
              setMapProps((prev) => ({ ...prev, center: { lat: liveLocation.lat, lng: liveLocation.lng }, zoom: 19 }));
            }
          } else {
            handleFocus(selfMarkerAt, null);
          }
        } : null}
        isSatellite={isSatellite}
        onToggleSatellite={() => setIsSatellite(!isSatellite)}
        onSettings={() => setSettingsOpen(true)}
        autoFollow={navigationController.autoFollow}
        onToggleAutoFollow={isNavigatingMode ? navigationController.toggleAutoFollow : null}
      />

      {/* The place card (components/PlaceCard.jsx). On a phone it sits above the floating SOS
          button (80 px tall, 80 px up, plus the safe area): it used to start at 96 px, so SOS -
          drawn on top - covered the card's first button. 11rem clears it with a gap. */}
      <AnimatePresence>
        {selectedItem && activeTab === 'buildings' && (
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.98 }}
            transition={reduceMotion ? { duration: 0.15 } : { type: 'spring', stiffness: 400, damping: 34, mass: 0.85 }}
            data-testid="location-card"
            className="absolute inset-x-3 bottom-[calc(11rem+env(safe-area-inset-bottom))] md:inset-x-auto md:bottom-6 md:right-6 z-[600] md:w-96 max-h-[60vh] md:max-h-[80vh] overflow-y-auto rounded-card pointer-events-auto"
          >
            <PlaceCard
              place={selectedItem}
              onClose={() => setSelectedItem(null)}
              onNavigate={() => onCardNavigate(selectedItem)}
              onArScan={() => setArTarget({ lat: selectedItem.lat, lng: selectedItem.lng, name: selectedItem.name })}
              rally={{ active: rallyIsHere(selectedItem), onPress: () => onCardRally(selectedItem) }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* "Set as meeting point" asks first: it moves the meeting point on everyone's map. */}
      <MeetingPointConfirm
        place={meetingPointToConfirm}
        onConfirm={() => {
          publishSquadWaypoint(meetingPointToConfirm);
          notify.success(NOTICES.rally.set(meetingPointToConfirm.name));
          setMeetingPointToConfirm(null);
        }}
        onCancel={() => setMeetingPointToConfirm(null)}
      />
      <MeetingPointConfirm
        clearing
        place={rallyToClear}
        onConfirm={() => {
          socket.emit('clear-waypoint', squadCode);
          notify.success(NOTICES.rally.cleared);
          setRallyToClear(null);
        }}
        onCancel={() => setRallyToClear(null)}
      />

      {/* The Group Lead's join requests (components/group/JoinRequests.jsx): Waiting only. */}
      <JoinRequests
        open={showRequestsModal && canModerate}
        onClose={() => setShowRequestsModal(false)}
        requests={pendingRequests}
        code={squadCode}
        onAdmitAll={myRole === 'admin' ? admitAll : undefined}
        onAnswer={(request, approved) => {
          // The squad the request was made to, not merely the one on screen.
          socket.emit('resolve-access', { targetId: request.targetId, roomCode: request.roomCode || squadCode, approved });
          setPendingRequests(prev => prev.filter(p => p.targetId !== request.targetId));
        }}
      />

      <FriendRequests
        open={showFriendRequests}
        onClose={() => setShowFriendRequests(false)}
        requests={friends.incoming}
        onAccept={(uid) => friendAction(friends.accept(uid))}
        onDecline={(uid) => friendAction(friends.remove(uid))}
      />

      {/* The activity log, for the Group Lead and moderators; blocked people, the Group Lead's. */}
      <ActivityLog
        open={showActivityLog && canModerate}
        onClose={() => setShowActivityLog(false)}
        entries={activityLog}
        onExport={exportLog}
      />
      <BlockedList
        open={showBlocked && canBlock}
        onClose={() => setShowBlocked(false)}
        blocked={blockedPeople}
        onUnblock={unblock}
      />

      {/* The Group Lead's locations table (components/group/LocationsTable.jsx). */}
      <LocationsTable
        open={showTelemetryModal && Boolean(rawTelemetryData)}
        members={users}
        rowFor={(member) => {
          const cacheData = rawTelemetryData?.[member.id];
          // Read defensively: a server that predates normalised records sends a member's raw
          // cache entry, which has lat/lng/lastSeen/battery until their first heartbeat adds
          // latitude/longitude/timestamp/batteryLevel. A bare `latitude.toFixed()` took the
          // whole app down on one.
          return {
            latitude: finiteOrNull(cacheData?.latitude) ?? finiteOrNull(cacheData?.lat),
            longitude: finiteOrNull(cacheData?.longitude) ?? finiteOrNull(cacheData?.lng),
            battery: batteryReading(cacheData),
            freshness: getSignalFreshness(cacheData?.timestamp ?? cacheData?.lastSeen),
          };
        }}
        sync={telemetrySync}
        onRefresh={requestTelemetrySync}
        onClose={() => setShowTelemetryModal(false)}
      />

      {/* --- SETTINGS (components/settings/SettingsHost.jsx) --- its open flag is not App's state. */}
      <SettingsHost
        polling={sysConfig.polling}
        onPolling={(v) => toggleConfig('polling', v)}
        arFidelity={sysConfig.arFidelity}
        onArFidelity={(v) => toggleConfig('arFidelity', v)}
        alertSounds={sysConfig.audio}
        onAlertSounds={(on) => toggleConfig('audio', on)}
        isSatellite={isSatellite}
        onSatellite={setIsSatellite}
        mapStatus={mapStatus}
        arFeatureOverrides={sysConfig.arFeatureOverrides}
        onArFeatureOverride={(feature, v) => toggleConfig(`arFeatureOverrides.${feature}`, v)}
        update={{
          installedVersion: appUpdate.installedVersion,
          supported: appUpdate.supported,
          status: appUpdate.status,
          onCheck: () => appUpdate.check({ manual: true }),
        }}
        onOpenGuide={() => setGuideOpen(true)}
        backgroundSharing={backgroundSharing}
        group={squadCode}
        onSignOut={handleLogout}
        onAdmin={isAdmin ? () => setShowAdminSettings(true) : undefined}
      />
      {/* How LOCUS works, from Settings: the guide over Settings, until it is closed. */}
      {guideOpen && <Guide zIndex={SETTINGS_Z + 1} onDone={() => setGuideOpen(false)} />}
      {/* --- END OF MODALS --- */}

      {/* The owner's admin tools (components/admin/AdminTools.jsx). */}
      <AdminTools
        open={showAdminSettings && isAdmin}
        email={user?.email}
        name={user?.displayName}
        recording={isRecordingPath}
        points={recordedCoords.length}
        onRecord={() => { setIsRecordingPath(true); setShowAdminSettings(false); }}
        onPublish={publishRecordedRoute}
        onAbort={abortRecording}
        onClose={() => setShowAdminSettings(false)}
        added={addedPlaces}
        onAddPlace={() => { setIsPlacing(true); setShowAdminSettings(false); }}
        onRemovePlace={removePlace}
      />
      {/* Add Place: choose the spot on the map, then name it (components/admin/AddPlace.jsx). */}
      {isAdmin && isPlacing && <PlacingBar onCancel={cancelAddPlace} />}
      {isAdmin && (
        <AddPlaceSheet
          key={draftPlace ? `${draftPlace.lat},${draftPlace.lng}` : 'none'}
          open={Boolean(draftPlace)}
          lat={draftPlace?.lat}
          lng={draftPlace?.lng}
          saving={savingPlace}
          problem={placeProblem}
          onSave={(fields) => saveDraftPlace({ ...fields, lat: draftPlace.lat, lng: draftPlace.lng })}
          onCancel={cancelAddPlace}
        />
      )}

      {/* --- TURN-BY-TURN NAVIGATION OVERLAYS --- */}
      {/* Arrival Panel when destination is reached */}
      <AnimatePresence>
        {isNavigatingMode && navigationController.hasArrived && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed inset-x-4 bottom-24 md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-96 z-[1000] pointer-events-auto"
          >
            <ArrivalPanel
              destinationName={activeNavTarget?.name}
              onDismiss={() => {
                setIsNavigatingMode(false);
                clearRoute();
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ========== MOBILE BOTTOM BAR (src/components/BottomTabBar.jsx) ========== */}
      {!isNavigatingMode && (
        <BottomTabBar
          keyboardUp={keyboardUp}
          activeId={arTarget ? 'scan' : sheetOpen ? 'squad' : 'grid'}
          tabs={[
            // Map only navigates. It used to toggle satellite on every tap as well, so coming
            // back to the map from Group or Scan flipped the map style; satellite has its own
            // control on the map.
            { id: 'grid', label: TABS.map, Icon: Map, flourish: 'lift' },
            { id: 'scan', label: TABS.scan, Icon: Scan, flourish: 'turn' },
            // The people waiting to join, on Group, for whoever may let them in.
            { id: 'squad', label: TABS.group, Icon: Users, flourish: 'pop', badge: canModerate ? { count: pendingRequests.length, label: LEAD_TOOLS.waiting(pendingRequests.length) } : undefined },
          ]}
          sosTrigger={
            accessStatus === 'granted' ? (
              <SosTrigger
                socket={socket}
                getLocation={() => liveLocationRef.current}
                roomCode={squadCode}
                senderName={user.displayName}
                outbox={sosOutbox}
                held={sosHeld}
                sharingMode={telemetryMode}
                layout="tab"
              />
            ) : null
          }
          onSelect={(id) => {
            const current = arTarget ? 'scan' : sheetOpen ? 'squad' : 'grid';
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
                ? arTargetForMember(scanNode)
                : { lat: SRM_KTR_COORDS.lat, lng: SRM_KTR_COORDS.lng, name: 'SRM_HQ' });
            } else {
              setMobileView('squad'); setActiveTab('users'); setSelectedItem(null); setPanelHeight('peek');
            }
          }}
        />
      )}

      {/* The meeting point button (two steps: tap it, then tap the map) */}
      {!isNavigatingMode && !keyboardUp && !(isMobile && sheetOpen && panelHeight !== 'peek') && !(selectedItem && activeTab === 'buildings') && (
        <MeetingPointButton choosing={isTargetingMode} onToggle={() => setIsTargetingMode(!isTargetingMode)} />
      )}

      {/* Leaving, confirmed (components/group/LeaveGroup.jsx). */}
      <LeaveGroupConfirm
        open={showLeaveConfirm && hasJoinedSquad}
        code={squadCode}
        isLead={squadRole === 'OWNER'}
        alone={users.length === 0 && ghostMembers.length === 0}
        onCancel={() => setShowLeaveConfirm(false)}
        onLeave={() => { setShowLeaveConfirm(false); handleLeaveSquad(); }}
      />

      {/* A member's options (components/group/MemberOptions.jsx): Ping, Show on map, Find with
          AR Scan, and the Group Lead's Remove and block behind its confirmation. */}
      <MemberOptions
        member={optionsMember}
        me={liveLocation}
        heading={heading}
        headingLive={hasHeadingReading}
        isLead={mayRemove(optionsMember)}
        onRemove={kickMember}
        friend={friendFor(optionsMember)}
        moderator={appointsModerators && optionsMember?.role && optionsMember.role !== 'admin' && optionsMember.status !== 'GHOST'
          ? { is: optionsMember.role === 'moderator', onChange: setMemberModerator }
          : undefined}
        onClose={() => setOptionsMemberId(null)}
        onNavigate={(m) => {
          handleWaypointSelect({ lat: m.lat, lng: m.lng, name: m.name, id: m.id });
          handleFocus({ lat: m.lat, lng: m.lng }, null);
          if (isMobile) setMobileView('grid');
        }}
        onPing={sendPing}
        onShowOnMap={(m) => {
          setOptionsMemberId(null);
          focusMember(m);
        }}
        onArScan={(m) => setArTarget(arTargetForMember(m))}
        onRemoveAndBlock={canBlock ? toggleBlock : undefined}
      />

      {/* The camera explainer, before AR Scan opens, only until the camera has been allowed.
          Not now leaves AR Scan closed, as AR Scan's own Cancel does. */}
      <CameraExplainer
        open={Boolean(arTarget) && !arScanReady}
        onContinue={() => setCameraExplained(true)}
        onNotNow={() => setArTarget(null)}
      />

      {arTarget && arScanReady && (
        <ARCompass
          target={arTarget}
          liveLocation={liveLocation}
          speedMps={liveSpeed}
          squadMembers={users.filter(u => !blockedUserIds.includes(u.id))}
          buildings={campusPlaces.filter(b => !isGrounds(b))}
          selfUid={user?.uid ?? null}
          routePath={arRoutePathFor(arTarget, { personalTarget, personalRoute, activeWaypoint, walkingRoute })}
          fidelity={sysConfig.arFidelity}
          overrides={sysConfig.arFeatureOverrides}
          onClose={() => setArTarget(null)}
          onChooseTarget={setArTarget}
          meetingPoint={activeWaypoint}
          onCameraStarted={() => { rememberCameraAllowed(); setCameraAllowed(true); }}
        />
      )}

      {/* ========== DESKTOP FLOATING SOS TRIGGER (Mobile is inside BottomTabBar) ========== */}
      {!isNavigatingMode && accessStatus === 'granted' && (
        <div className="hidden md:block fixed bottom-6 left-[23rem] z-[10001] pointer-events-auto">
          <SosTrigger
            socket={socket}
            getLocation={() => liveLocationRef.current}
            roomCode={squadCode}
            senderName={user.displayName}
            outbox={sosOutbox}
            held={sosHeld}
            sharingMode={telemetryMode}
            layout="floating"
          />
        </div>
      )}

      {/* ========== UPDATES: APK modal + JS-only restart strip (mandatory is gated far above) ========== */}
      {updateOverlay}

      {/* ========== INCOMING SOS (stays up until acknowledged) ========== */}
      {sosOverlay}
    </div>
  );
};

export default App;