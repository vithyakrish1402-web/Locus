// Dev-only screen gallery for the redesign: the app's real components, fed sample data, each
// drawn in a phone-sized frame, once in light and once in dark. Open /preview.html on
// `npm run dev`; ?screen=<id> picks a screen, ?sound=1 lets the SOS alarm play.
//
// Never part of a release: preview.html is not a build input (see its comment). This page's
// own chrome uses inline styles only, so Tailwind (which scans src/ for class names when it
// builds the app's stylesheet) picks up nothing from it.
//
// Each frame sets data-theme="light" / "dark" on its <html>, which the design tokens
// (src/theme/tokens.css) key off. Screens not yet converted to the tokens look the same in both.
// An entry point that nothing imports, so react-refresh has no module boundary to keep.
/* eslint-disable react-refresh/only-export-components */
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../index.css';
import { MotionGlobalConfig } from 'framer-motion';
import { Ban, Map, MapPinOff, Navigation, Radio, Scan, ScanLine, Share2, ShieldCheck, Users, X, Search, Sliders } from 'lucide-react';
import BuildingRow from '../../components/map/BuildingRow';
import {
  Avatar, Badge, Button, Card, Chip, IconButton, ListRow, NoticeCard, RadioList, SectionLabel,
  SegmentedControl, Sheet, Skeleton, StatusDot, Switch, TextField,
} from '../../components/ui';
import SosTrigger from '../../components/SosTrigger';
import LocationsTable from '../../components/group/LocationsTable';
import AdminTools, { RecordingBar } from '../../components/admin/AdminTools';
import SosOverlay from '../../components/SosOverlay';
import CommsFeed from '../../components/CommsFeed';
import UpdateModal from '../../components/UpdateModal';
import LiveUpdateToast from '../../components/LiveUpdateToast';
import SquadMemberCard from '../../components/SquadMemberCard';
import { CodeTiles, CodeInput } from '../../components/SquadCode';
import BottomTabBar from '../../components/BottomTabBar';
import PlaceCard from '../../components/PlaceCard';
import MeetingPointConfirm from '../../components/MeetingPointConfirm';
import SettingsScreen from '../../components/settings/SettingsScreen';
import { DEFAULT_AR_FEATURE_OVERRIDES } from '../../utils/arFeatures';
import { SRM_MASTER_DATABASE } from '../../srmDatabase';
import ARTag from '../../components/ARTag';
import ARCompass from '../../ARCompass';
import CameraExplainer from '../../components/CameraExplainer';
import Guide from '../../components/guide/Guide';
import BootScreen from '../../components/access/BootScreen';
import { notify, __resetNotifications } from '../../utils/notify';
import { UpdateStatus } from '../../hooks/useAppUpdate';
import { LiveUpdateStatus } from '../../hooks/useLiveUpdate';
import { AR_TAGS, ME, MEMBERS, NOTICES, SOS, appUpdate, liveUpdate } from './sampleData';

const params = new URLSearchParams(window.location.search);

// Frames show every screen at rest: framer-motion animations jump to their end if motion=0.
// ?motion=0 disables animations for static screenshot tests; default allows interactive preview animations.
if (params.get('frame') === '1' && params.get('motion') === '0') MotionGlobalConfig.skipAnimations = true;

// The SOS alarm and vibration start the moment SosOverlay mounts; silence them unless asked.
if (params.get('sound') !== '1') {
  window.AudioContext = undefined;
  window.webkitAudioContext = undefined;
  if (navigator.vibrate) navigator.vibrate = () => false;
}

const PHONE = { width: 390, height: 844 };

function Notices() {
  useEffect(() => {
    __resetNotifications();
    // Long enough to stay up while you look, with the countdown line showing.
    NOTICES.forEach((n) => notify[n.severity](n.message, { title: n.title, kind: n.kind, duration: 10 * 60 * 1000, haptic: false }));
  }, []);
  return <CommsFeed />;
}

const TABS = [
  { id: 'grid', label: 'GRID', Icon: Map, flourish: 'lift' },
  { id: 'scan', label: 'SCAN', Icon: Scan, flourish: 'turn' },
  { id: 'squad', label: 'SQUAD', Icon: Users, flourish: 'pop' },
];

const pad = { padding: 16, display: 'flex', flexDirection: 'column', gap: 16 };

// Each screen: what a frame shows (see Frame).
const SCREENS = {
  tokens: { label: 'Design tokens', render: () => <TokenSheet /> },
  loading: { label: 'Loading (cold start)', render: () => <BootScreen /> },
  components: { label: 'Components', render: () => <ComponentSheet /> },
  sheet: { label: 'Sheet (member options)', render: () => <SheetDemo /> },
  'emergency-button': {
    label: 'Emergency button (resting)',
    render: () => <SosTrigger socket={null} getLocation={() => ME} roomCode="K7M2QX" senderName="ALPHA" />,
  },
  'emergency-received': {
    label: 'Emergency alert received (2 queued)',
    render: () => <SosOverlay {...SOS} onAcknowledge={() => {}} />,
  },
  notifications: {
    label: 'Notifications (all four types)',
    render: () => <div style={{ height: '100%', background: 'var(--color-bg)' }}><Notices /></div>,
  },
  'update-available': {
    label: 'Update available',
    render: () => <UpdateModal update={appUpdate(UpdateStatus.AVAILABLE)} />,
  },
  'update-downloading': {
    label: 'Update downloading',
    render: () => <UpdateModal update={appUpdate(UpdateStatus.DOWNLOADING)} />,
  },
  'update-verifying': {
    label: 'Update being checked',
    render: () => <UpdateModal update={appUpdate(UpdateStatus.VERIFYING, { progress: { percent: 100, loaded: 14.2 * 1024 * 1024, total: 14.2 * 1024 * 1024 } })} />,
  },
  'update-ready': {
    label: 'Update ready to install',
    render: () => <UpdateModal update={appUpdate(UpdateStatus.READY)} />,
  },
  'update-install-permission': {
    label: 'Update needs install permission',
    render: () => <UpdateModal update={appUpdate(UpdateStatus.PERMISSION_REQUIRED)} />,
  },
  'update-safety-check-failed': {
    label: 'Update safety check failed',
    render: () => <UpdateModal update={appUpdate(UpdateStatus.ERROR, { error: { code: 'CHECKSUM_MISMATCH', message: 'raw' } })} />,
  },
  'update-network-failed': {
    label: "Couldn't check for updates (no connection)",
    render: () => <UpdateModal update={appUpdate(UpdateStatus.ERROR, { error: { code: 'NETWORK', message: 'raw' } })} />,
  },
  'update-mandatory': {
    label: 'Mandatory update',
    render: () => <UpdateModal update={appUpdate(UpdateStatus.AVAILABLE, { mandatory: true })} />,
  },
  'update-mandatory-downloading': {
    label: 'Mandatory update downloading',
    render: () => <UpdateModal update={appUpdate(UpdateStatus.DOWNLOADING, { mandatory: true })} />,
  },
  'update-strip-ready': {
    label: 'Small update ready (strip)',
    render: () => <LiveUpdateToast live={liveUpdate(LiveUpdateStatus.READY)} />,
  },
  'update-strip-failed': {
    label: "Small update didn't install (strip)",
    render: () => <LiveUpdateToast live={liveUpdate(LiveUpdateStatus.ERROR, { error: { message: 'checksum mismatch' } })} />,
  },
  'update-strip-downloading': {
    label: 'Small update downloading (strip)',
    render: () => <LiveUpdateToast live={liveUpdate(LiveUpdateStatus.DOWNLOADING)} />,
  },
  'member-cards': {
    label: 'Group member cards',
    render: () => (
      <div style={{ ...pad, overflowY: 'auto', height: '100%', boxSizing: 'border-box' }}>
        {MEMBERS.map((m) => (
          <SquadMemberCard key={m.id} member={m} me={ME} heading={0} headingLive isOwner onPing={() => {}} onBlock={() => {}} onAR={() => {}} onTrack={() => {}} />
        ))}
      </div>
    ),
  },
  'group-code': {
    label: 'Group code (create and join)',
    render: () => (
      <div style={{ ...pad, paddingTop: 120 }}>
        <CodeTiles code="K7M2QX" />
        <CodeInput value="K7M" onChange={() => {}} />
      </div>
    ),
  },
  'tab-bar': {
    label: 'Bottom tab bar',
    render: () => <BottomTabBar tabs={TABS} activeId="grid" onSelect={() => {}} />,
  },
  'buildings-list': { label: 'Nearby Places (Buildings list)', render: () => <BuildingsListDemo /> },
  'place-card': { label: 'Place card', render: () => <PlaceOnMap place={campusPlace(2)} /> },
  'place-card-more': { label: 'Place card, more about this place', render: () => <PlaceOnMap place={campusPlace(2)} expanded /> },
  'place-card-no-details': { label: 'Place card, no more details', render: () => <PlaceOnMap place={campusPlace(39)} expanded /> },
  'place-card-second-step': { label: 'Place card, choosing a destination (no GPS)', render: () => <PlaceOnMap place={campusPlace(2)} me={null} choosingDestination /> },
  'camera-explainer': {
    label: 'Allow the camera for AR Scan',
    render: () => (
      <>
        <PlaceOnMap place={campusPlace(2)} />
        <CameraExplainer open onContinue={() => {}} onNotNow={() => {}} />
      </>
    ),
  },
  'ar-start': {
    label: "AR Scan's start screen",
    render: () => <ARCompass target={{ lat: campusPlace(2).lat, lng: campusPlace(2).lng, name: campusPlace(2).name }} liveLocation={ME} onClose={() => {}} />,
  },
  'locations-table': {
    label: "Group Lead's locations table",
    render: () => (
      <LocationsTable
        open
        members={[{ id: 'a', name: 'Aarav Shah' }, { id: 'r', name: 'Rohan Das' }, { id: 'i', name: 'Ishita Rao' }, { id: 'm', name: 'Meera Iyer' }]}
        rowFor={(m) => ({
          a: { latitude: 12.82351, longitude: 80.04462, battery: { text: '77%', color: 'text-success' }, freshness: { text: 'OPTIMAL (< 10s)', color: 'text-success' } },
          r: { latitude: 12.82212, longitude: 80.04358, battery: { text: '15%', color: 'text-warning' }, freshness: { text: 'WARN (3m ago)', color: 'text-warning' } },
          i: { latitude: null, longitude: null, battery: { text: 'UNKNOWN', color: 'text-text-secondary' }, freshness: { text: 'NO_SIGNAL', color: 'text-warning' } },
          m: { latitude: 12.82401, longitude: 80.04511, battery: { text: '54%', color: 'text-success' }, freshness: { text: 'GOOD (24s ago)', color: 'text-text' } },
        })[m.id]}
        sync={{ status: 'idle', message: null }}
        onRefresh={() => {}}
        onClose={() => {}}
      />
    ),
  },
  'admin-tools': {
    label: 'Admin tools (owner only)',
    render: () => <AdminTools open email="owner@example.com" name="Krish" recording={false} points={0} onRecord={() => {}} onPublish={() => {}} onAbort={() => {}} onClose={() => {}} />,
  },
  'admin-tools-recording': {
    label: 'Admin tools, recording a path',
    render: () => <AdminTools open email="owner@example.com" name="Krish" recording points={12} onRecord={() => {}} onPublish={() => {}} onAbort={() => {}} onClose={() => {}} />,
  },
  'recording-bar': {
    label: 'Recording a path: the bar on the map',
    render: () => <div style={{ position: 'absolute', inset: 0, background: 'var(--color-map-land)' }}><RecordingBar points={12} onPublish={() => {}} onAbort={() => {}} /></div>,
  },
  settings: { label: 'Settings', render: () => <SettingsDemo /> },
  'settings-about': { label: 'Settings, Notifications and About (scrolled)', render: () => <SettingsDemo scrollTo="Notifications" /> },
  'settings-more': { label: 'Settings, More (scrolled)', render: () => <SettingsDemo scrollTo="More" /> },
  'meeting-point-confirm': {
    label: 'Set as meeting point (confirm)',
    render: () => (
      <>
        <PlaceOnMap place={campusPlace(2)} />
        <MeetingPointConfirm place={campusPlace(2)} onConfirm={() => {}} onCancel={() => {}} />
      </>
    ),
  },
  'ar-tags-bright': { label: 'AR Scan labels over a bright scene', render: () => <ArTags scene="bright" /> },
  'ar-tags-dark': { label: 'AR Scan labels over a dark scene', render: () => <ArTags scene="dark" /> },
  'guide-1': { label: 'Guide 1 of 5: your group', render: () => <Guide initialStep={0} onDone={() => {}} /> },
  'guide-2': { label: 'Guide 2 of 5: the map', render: () => <Guide initialStep={1} onDone={() => {}} /> },
  'guide-3': { label: 'Guide 3 of 5: AR Scan', render: () => <Guide initialStep={2} onDone={() => {}} /> },
  'guide-4': { label: 'Guide 4 of 5: what the group sees', render: () => <Guide initialStep={3} onDone={() => {}} /> },
  'guide-5': { label: 'Guide 5 of 5: Emergency alert', render: () => <Guide initialStep={4} onDone={() => {}} /> },
};

// Settings with the app's defaults, working: every choice changes what it shows. As on an
// installed phone (version 1.1.0, up to date), so About reads as it would there.
function SettingsDemo({ scrollTo = null }) {
  const [polling, setPolling] = useState('standard');
  const [arFidelity, setArFidelity] = useState('standard');
  const [alertSounds, setAlertSounds] = useState(true);
  const [isSatellite, setSatellite] = useState(false);
  const [overrides, setOverrides] = useState(DEFAULT_AR_FEATURE_OVERRIDES);
  useEffect(() => {
    if (!scrollTo) return;
    const screenEl = document.querySelector('[data-testid="settings"]');
    const more = [...screenEl.querySelectorAll('h2')].find((h) => h.textContent === scrollTo);
    screenEl.scrollTop = more.offsetTop - 16;
  }, [scrollTo]);
  return (
    <SettingsScreen
      onClose={() => {}}
      polling={polling}
      onPolling={setPolling}
      arFidelity={arFidelity}
      onArFidelity={setArFidelity}
      alertSounds={alertSounds}
      onAlertSounds={setAlertSounds}
      isSatellite={isSatellite}
      onSatellite={setSatellite}
      mapStatus={{ engine: 'google', reason: 'ok' }}
      arFeatureOverrides={overrides}
      onArFeatureOverride={(feature, v) => setOverrides((o) => ({ ...o, [feature]: v }))}
      update={{ installedVersion: '1.1.0', supported: true, status: 'up-to-date', onCheck: () => {} }}
      onOpenGuide={() => {}}
    />
  );
}

// A place from the campus data, as the app has it.
const campusPlace = (id) => SRM_MASTER_DATABASE.find((b) => b.id === id);

// The place card where the app puts it: above the Emergency button's spot, on the screen's
// background (the map behind it is the Map batch's).
function PlaceOnMap({ place, expanded = false, me = ME, choosingDestination = false }) {
  const [open, setOpen] = useState(expanded);
  return (
    <div style={{ position: 'absolute', inset: 0, background: 'var(--color-bg)' }}>
      <div style={{ position: 'absolute', left: 12, right: 12, bottom: 'calc(11rem)', maxHeight: '60vh', overflowY: 'auto', borderRadius: 16 }}>
        <PlaceCard
          place={place}
          me={me}
          heading={330}
          headingLive
          choosingDestination={choosingDestination}
          expanded={open}
          onToggleExpanded={() => setOpen((v) => !v)}
          onClose={() => {}}
          onNavigate={() => {}}
          onArScan={() => {}}
          onSetMeetingPoint={() => {}}
          onShowOnMap={() => {}}
        />
      </div>
    </div>
  );
}

function BuildingsListDemo() {
  const [selectedCat, setSelectedCat] = useState('ALL');
  const [query, setQuery] = useState('');
  const [selectedPlace, setSelectedPlace] = useState(null);

  const filtered = SRM_MASTER_DATABASE.filter(b => {
    const matchesCat = selectedCat === 'ALL' || b.category === selectedCat;
    const matchesQ = !query.trim() || b.name.toLowerCase().includes(query.toLowerCase());
    return matchesCat && matchesQ;
  });

  return (
    <div style={{ position: 'absolute', inset: 0, background: '#F8FAFC', display: 'flex', flexDirection: 'column' }}>
      {/* Search & Header (Minimalist Android UI) */}
      <div className="p-4 pb-3 flex flex-col gap-2.5 shrink-0 bg-white border-b border-[#E2E8F0] font-ui">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-[#172B4D] tracking-tight">SRM Campus</h2>
          <span className="text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-[#EFF6FF] text-[#287FE8] border border-[#BFDBFE]">
            Kattankulathur
          </span>
        </div>

        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#64748B]" size={17} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search buildings, places, facilities..."
            className="w-full h-10 rounded-xl bg-[#F8FAFC] pl-10 pr-10 font-ui text-xs text-[#172B4D] placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#287FE8]/20 focus:border-[#287FE8] border border-[#E2E8F0] transition-all"
          />
          <Sliders className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#94A3B8]" size={16} />
        </div>

        {/* Category Filter Chips */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 pt-0.5 no-scrollbar -mx-1 px-1">
          {[
            { id: 'ALL', label: 'All' },
            { id: 'ACADEMIC', label: 'Academic' },
            { id: 'ENGINEERING', label: 'Engineering' },
            { id: 'MEDICAL', label: 'Medical' },
            { id: 'RESIDENTIAL', label: 'Hostels' },
            { id: 'LOGISTICS', label: 'Dining & Hubs' },
          ].map((cat) => {
            const isSelected = selectedCat === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setSelectedCat(cat.id)}
                className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium font-ui transition-colors flex items-center gap-1 cursor-pointer border ${
                  isSelected
                    ? 'bg-[#287FE8] text-white border-[#287FE8] shadow-sm'
                    : 'bg-white text-[#475569] border-[#E2E8F0] hover:bg-[#F1F5F9] hover:text-[#172B4D]'
                }`}
              >
                {cat.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Buildings List Content */}
      <div className="flex-1 overflow-y-auto p-3.5 sm:p-4 space-y-3 font-ui">
        <div className="flex items-center justify-between pb-0.5">
          <h3 className="text-sm font-semibold text-[#172B4D] tracking-tight">Nearby Places</h3>
          <span className="text-xs text-[#64748B] font-normal">{filtered.length} places</span>
        </div>

        {filtered.map((b) => (
          <BuildingRow
            key={b.id}
            building={b}
            me={ME}
            onOpen={() => setSelectedPlace(b)}
            onArScan={() => {}}
            onNavigate={() => {}}
          />
        ))}
      </div>

      {/* Place Detail Overlay if selected */}
      {selectedPlace && (
        <div className="absolute inset-x-2 bottom-3 z-50 max-h-[85vh] overflow-y-auto shadow-2xl">
          <PlaceCard
            place={selectedPlace}
            me={ME}
            heading={330}
            headingLive
            expanded
            onToggleExpanded={() => {}}
            onClose={() => setSelectedPlace(null)}
            onNavigate={() => {}}
            onArScan={() => {}}
            onShowOnMap={() => {}}
          />
        </div>
      )}
    </div>
  );
}

// The tokens themselves (src/theme/tokens.css), drawn with var() so each frame shows its
// own theme's values.
const SWATCHES = [
  ['bg', 'Background'], ['surface', 'Surface'], ['raised', 'Raised'], ['sunken', 'Sunken'],
  ['border', 'Divider'], ['border-control', 'Control outline'], ['text', 'Text'], ['text-secondary', 'Supporting text'],
  ['accent', 'Accent'], ['accent-pressed', 'Accent pressed'], ['accent-soft', 'Accent soft'], ['accent-halo', 'Accent halo'],
  ['success', 'Success'], ['success-soft', 'Success soft'], ['warning', 'Warning'], ['warning-soft', 'Warning soft'],
  ['danger', 'Danger'], ['danger-soft', 'Danger soft'], ['emergency', 'Emergency band'], ['backdrop', 'Backdrop'],
  ['map-land', 'Map land'], ['map-road', 'Map road'], ['map-green', 'Map green'], ['map-water', 'Map water'],
];
const TYPE = ['display', 'title', 'heading', 'body', 'label', 'secondary', 'caption', 'numeric'];
const tokenType = (name) => ({
  fontFamily: 'var(--font-ui)',
  fontSize: `var(--text-${name})`,
  lineHeight: `var(--text-${name}--line-height)`,
  fontWeight: `var(--text-${name}--font-weight)`,
});

function TokenSheet() {
  const c = (name) => `var(--color-${name})`;
  const section = { font: '600 11px system-ui, sans-serif', letterSpacing: 0.4, color: c('text-secondary'), margin: '20px 0 8px' };
  return (
    <div style={{ height: '100%', overflowY: 'auto', background: c('bg'), color: c('text'), padding: 16, boxSizing: 'border-box', fontFamily: 'var(--font-ui)' }}>
      <div style={{ ...tokenType('title') }}>Design tokens</div>
      <div style={{ ...tokenType('secondary'), color: c('text-secondary') }}>
        {document.documentElement.dataset.theme === 'dark' ? 'Dark' : 'Light'} theme, from src/theme/tokens.css
      </div>

      <p style={section}>Colour roles</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        {SWATCHES.map(([name, label]) => (
          <div key={name}>
            <div style={{ height: 36, borderRadius: 'var(--radius-fill)', background: c(name), boxShadow: `inset 0 0 0 1px ${c('border')}` }} />
            <div style={{ ...tokenType('caption'), marginTop: 4, color: c('text-secondary') }}>{label}</div>
          </div>
        ))}
      </div>

      <p style={section}>Card on the background, with text</p>
      <div style={{ background: c('surface'), borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-1)', padding: 16 }}>
        <div style={tokenType('heading')}>Tech Park</div>
        <div style={{ ...tokenType('secondary'), color: c('text-secondary') }}>180 m · 2 o&apos;clock</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <span style={{ ...tokenType('label'), background: c('accent'), color: c('accent-on'), borderRadius: 999, padding: '10px 16px' }}>Navigate</span>
          <span style={{ ...tokenType('label'), background: c('accent-soft'), color: c('accent'), borderRadius: 999, padding: '10px 16px' }}>AR Scan</span>
        </div>
        <div style={{ ...tokenType('secondary'), marginTop: 12, padding: '8px 12px', borderRadius: 'var(--radius-input)', background: c('warning-soft'), color: c('warning') }}>
          Location is off, so your group can&apos;t see you.
        </div>
      </div>

      <p style={section}>Type scale (Inter)</p>
      {TYPE.map((name) => (
        <div key={name} style={tokenType(name)}>{name === 'numeric' ? '340 m' : name[0].toUpperCase() + name.slice(1)}</div>
      ))}

      <p style={section}>Corners and shadows</p>
      <div style={{ display: 'flex', gap: 12, paddingBottom: 24 }}>
        {[['fill', 'shadow-1'], ['input', 'shadow-1'], ['card', 'shadow-2'], ['sheet', 'shadow-3']].map(([r, s]) => (
          <div key={r} style={{ flex: 1, height: 56, background: c('raised'), borderRadius: `var(--radius-${r})`, boxShadow: `var(--${s})`, display: 'grid', placeItems: 'center', ...tokenType('caption') }}>
            {r}
          </div>
        ))}
      </div>
    </div>
  );
}

// The shared parts (src/components/ui), with working state so they can be tried here.
function ComponentSheet() {
  const [mode, setMode] = useState('live');
  const [rate, setRate] = useState('standard');
  const [sounds, setSounds] = useState(true);
  const modeHelp = {
    live: 'The squad sees your movement in real time, updated every 5 seconds.',
    paused: 'Your squad sees your last known anchor before pausing.',
    hidden: 'You are completely masked from other squad members’ radar.',
  };

  return (
    <div className="relative h-full overflow-y-auto font-ui p-4 box-border flex flex-col gap-5 select-none" style={{ background: 'var(--color-bg)' }}>
      {/* Apple Ambient Light Orbs for Glass Refraction */}
      <div className="pointer-events-none absolute -top-24 -left-20 w-72 h-72 rounded-full bg-accent/20 blur-3xl opacity-60" aria-hidden="true" />
      <div className="pointer-events-none absolute top-1/3 -right-20 w-80 h-80 rounded-full bg-emerald-500/10 blur-3xl opacity-50" aria-hidden="true" />
      <div className="pointer-events-none absolute bottom-10 left-10 w-80 h-80 rounded-full bg-indigo-500/15 blur-3xl opacity-40" aria-hidden="true" />

      {/* Hero Island / Identity Card */}
      <Card className="relative z-10 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Avatar name="Meera Iyer" />
            <div>
              <div className="flex items-center gap-2">
                <span className="font-ui text-heading font-semibold text-text">Meera Iyer</span>
                <Badge count={2} label="2 join requests" />
              </div>
              <p className="text-secondary text-text-secondary flex items-center gap-1.5 mt-0.5">
                <span className="w-2 h-2 rounded-full bg-success inline-block shadow-[0_0_6px_rgba(30,123,60,0.4)]" />
                Squad Lead · SRM Campus
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <IconButton label="Share group code" icon={Share2} variant="tonal" size={18} />
            <IconButton label="Close" icon={X} variant="plain" size={18} />
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Chip icon={ShieldCheck}>Group Lead</Chip>
          <Chip tone="neutral">Planned Session</Chip>
        </div>

        <div className="grid grid-cols-2 gap-2.5 pt-1">
          <Button icon={Navigation} variant="primary" size="medium">Navigate</Button>
          <Button icon={ScanLine} variant="tonal" size="medium">AR Scan</Button>
        </div>
      </Card>

      {/* Location Privacy */}
      <div className="relative z-10">
        <SectionLabel>Location Privacy</SectionLabel>
        <Card className="flex flex-col gap-3">
          <SegmentedControl
            label="Location sharing"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'live', label: 'Live', leading: mode === 'live' ? <StatusDot status="live" /> : null },
              { value: 'paused', label: 'Paused' },
              { value: 'hidden', label: 'Hidden' },
            ]}
          />
          <p className="font-ui text-secondary text-text-secondary flex items-center gap-2 px-1">
            <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-accent" />
            {modeHelp[mode]}
          </p>
        </Card>
      </div>

      {/* Transmission Frequency */}
      <div className="relative z-10">
        <SectionLabel>Transmission Frequency</SectionLabel>
        <Card padded={false}>
          <RadioList
            label="Location refresh rate"
            value={rate}
            onChange={setRate}
            options={[
              { value: 'eco', label: 'Battery saver', description: 'Every 15 seconds · High battery life' },
              { value: 'standard', label: 'Standard', description: 'Every 5 seconds · Recommended' },
              { value: 'max', label: 'Fast', description: 'Every second · Uses more battery' },
            ]}
          />
        </Card>
      </div>

      {/* Notifications & Sound Controls */}
      <div className="relative z-10">
        <SectionLabel>Notifications & Alerts</SectionLabel>
        <Card padded={false}>
          <div className="divide-y divide-[var(--glass-border-subtle)]">
            <Switch label="Alert sounds" description="Audible sonar pings on member proximity" checked={sounds} onChange={setSounds} />
            <Switch label="Emergency alerts" description="High-priority distress broadcast · Always on" checked locked />
          </div>
        </Card>
      </div>

      {/* Squad Telemetry */}
      <div className="relative z-10">
        <SectionLabel>Squad Telemetry (3 Active)</SectionLabel>
        <Card padded={false}>
          <div className="divide-y divide-[var(--glass-border-subtle)]">
            <ListRow leading={<Avatar name="Meera Iyer" />} title="Meera Iyer" description={<StatusDot status="live">Live now</StatusDot>} trailing={<span className="text-secondary font-medium text-text tabular-nums px-2.5 py-1 rounded-full bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5">120 m</span>} />
            <ListRow leading={<Avatar name="Rohan Das" dashed />} title="Rohan Das" description={<StatusDot status="paused">Paused · 6m ago</StatusDot>} trailing={<span className="text-secondary font-medium text-text tabular-nums px-2.5 py-1 rounded-full bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5">520 m</span>} />
            <ListRow leading={<Avatar name="Ishita Rao" dashed />} title="Ishita Rao" description={<StatusDot status="hidden">Masked from radar</StatusDot>} />
          </div>
        </Card>
      </div>

      {/* Secure Credentials */}
      <div className="relative z-10 flex flex-col gap-3">
        <SectionLabel>Identification</SectionLabel>
        <TextField label="Campus Email" type="email" defaultValue="meera.iyer@srmist.edu.in" />
        <TextField label="Group Code" defaultValue="K7M2Q" problem="No group uses this code. Verify with Group Lead." />
        <div className="flex items-center justify-between pt-1 px-1">
          <Button variant="plain">Forgot password?</Button>
          <Button variant="secondary">Cancel</Button>
        </div>
      </div>

      {/* System Tactical Feed */}
      <div className="relative z-10 flex flex-col gap-3">
        <SectionLabel>System Notices</SectionLabel>
        <NoticeCard tone="success" title="Meera joined the group" onDismiss={() => {}}>You approved her join request.</NoticeCard>
        <NoticeCard tone="info" icon={Radio} title="Aarav is pinging you" onDismiss={() => {}}>He is 340 m away, bearing 045°.</NoticeCard>
        <NoticeCard tone="warning" icon={MapPinOff} title="Location is off" action={<Button variant="tonal" block>Turn on location</Button>}>
          Turn it on so your squad can locate you on campus.
        </NoticeCard>
      </div>

      {/* Destructive Governance */}
      <div className="relative z-10 pb-8">
        <SectionLabel>Squad Governance</SectionLabel>
        <Card className="flex flex-col gap-3">
          <p className="text-secondary text-text-secondary px-0.5">Disavow connection and permanently isolate this member.</p>
          <Button variant="danger" block>Remove and block member</Button>
        </Card>
      </div>
    </div>
  );
}

// The member options sheet, open over a stand-in for the group panel.
function SheetDemo() {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ position: 'absolute', inset: 0, background: 'var(--color-bg)', padding: 16 }}>
      <Button variant="secondary" onClick={() => setOpen(true)}>Open the sheet again</Button>
      <Sheet open={open} onClose={() => setOpen(false)} label="Options for Meera Iyer">
        <ListRow leading={<Avatar name="Meera Iyer" />} title="Meera Iyer" description="Live now · 120 m · 11 o'clock" />
        <div className="divide-y divide-border border-t border-border">
          <ListRow leading={<Radio size={22} />} title="Ping Meera" onClick={() => {}} />
          <ListRow leading={<Navigation size={22} />} title="Navigate to Meera" onClick={() => {}} />
          <ListRow leading={<ScanLine size={22} />} title="Find with AR Scan" onClick={() => {}} />
          <ListRow leading={<Ban size={22} />} title="Remove and block" danger onClick={() => {}} />
        </div>
        <div className="px-4 pt-2">
          <Button variant="secondary" block onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      </Sheet>
    </div>
  );
}

// Stand-ins for a camera picture: a sunlit sky over a pale building, and dusk.
const SCENES = {
  bright: 'linear-gradient(180deg, #cfe6ff 0%, #eef5fb 45%, #d9d4c7 46%, #bfb8a8 100%)',
  dark: 'linear-gradient(180deg, #0b1220 0%, #1b2433 45%, #2a2622 46%, #14110e 100%)',
};

function ArTags({ scene }) {
  return (
    <div style={{ position: 'absolute', inset: 0, background: SCENES[scene] }}>
      {AR_TAGS.map((t) => <ARTag key={t.name} {...t} />)}
    </div>
  );
}

// One phone: an iframe of this same page in frame mode, at a phone's width, so the app's
// phone/desktop breakpoints and position: fixed behave exactly as they do on a phone.
function Frame({ id, theme }) {
  return (
    <figure style={{ margin: 0 }}>
      <figcaption style={{ font: '600 13px system-ui, sans-serif', color: '#555', marginBottom: 8 }}>
        {theme === 'light' ? 'Light' : 'Dark'}
      </figcaption>
      <iframe
        title={`${id} (${theme})`}
        src={`?frame=1&screen=${id}&theme=${theme}${params.get('sound') === '1' ? '&sound=1' : ''}${params.get('motion') === '1' ? '&motion=1' : ''}`}
        style={{ ...PHONE, display: 'block', border: 0, borderRadius: 28, background: '#000', boxShadow: '0 0 0 1px #c9ced6, 0 12px 32px rgba(0,0,0,0.18)' }}
      />
    </figure>
  );
}

// Inside a frame: just the screen, filling the phone. (Its theme is set on <html> before the
// first render; see the bottom of this file.)
function FrameContent({ id }) {
  // &button=1 draws the real Emergency button over the screen, as the app does on every screen but
  // the mandatory update; &text=130 scales the text as the phone's font-size setting does.
  const withButton = params.get('button') === '1';
  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden', background: 'var(--color-bg)' }}>
      {SCREENS[id].render()}
      {withButton && <SosTrigger socket={null} getLocation={() => ME} roomCode="K7M2QX" senderName="ALPHA" />}
    </div>
  );
}

function Gallery() {
  const id = SCREENS[params.get('screen')] ? params.get('screen') : 'tokens';
  const themes = params.get('theme') === 'light' ? ['light'] : params.get('theme') === 'dark' ? ['dark'] : ['light', 'dark'];
  const screen = SCREENS[id];

  return (
    <div style={{ minHeight: '100vh', background: '#eef0f3', padding: 24, boxSizing: 'border-box', font: '14px system-ui, sans-serif', color: '#14181f' }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ font: '700 20px system-ui, sans-serif', margin: '0 0 4px' }}>LOCUS preview — {screen.label}</h1>
        <p style={{ margin: '0 0 12px', color: '#566070' }}>
          Dev-only. Real components with sample data. Screens not yet converted to the design tokens look the same in light and dark.
        </p>
        <nav style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {Object.entries(SCREENS).map(([key, s]) => (
            <a
              key={key}
              href={`?screen=${key}`}
              style={{
                padding: '4px 10px',
                borderRadius: 999,
                textDecoration: 'none',
                background: key === id ? '#1f4fb8' : '#fff',
                color: key === id ? '#fff' : '#14181f',
                boxShadow: '0 0 0 1px #dce1e7',
              }}
            >
              {s.label}
            </a>
          ))}
        </nav>
      </header>
      <main style={{ display: 'flex', gap: 32, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {themes.map((theme) => (
          <Frame key={theme} id={id} theme={theme} />
        ))}
      </main>
    </div>
  );
}

const frameId = SCREENS[params.get('screen')] ? params.get('screen') : 'tokens';
if (params.get('text')) document.documentElement.style.fontSize = `${Number(params.get('text'))}%`;
if (params.get('frame') === '1') document.documentElement.dataset.theme = params.get('theme') === 'light' ? 'light' : 'dark';
createRoot(document.getElementById('preview-root')).render(
  params.get('frame') === '1'
    ? <FrameContent id={frameId} />
    : <Gallery />,
);
