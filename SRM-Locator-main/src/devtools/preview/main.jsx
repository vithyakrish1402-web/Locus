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
import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import '../../index.css';
import { Map, Scan, Users } from 'lucide-react';
import SosTrigger from '../../components/SosTrigger';
import SosOverlay from '../../components/SosOverlay';
import CommsFeed from '../../components/CommsFeed';
import UpdateModal from '../../components/UpdateModal';
import LiveUpdateToast from '../../components/LiveUpdateToast';
import SquadMemberCard from '../../components/SquadMemberCard';
import { CodeTiles, CodeInput } from '../../components/SquadCode';
import BottomTabBar from '../../components/BottomTabBar';
import BuildingInfo from '../../components/BuildingInfo';
import ARTag from '../../components/ARTag';
import LocusGuide from '../../LocusGuide';
import { notify, __resetNotifications } from '../../utils/notify';
import { UpdateStatus } from '../../hooks/useAppUpdate';
import { LiveUpdateStatus } from '../../hooks/useLiveUpdate';
import { AR_TAGS, BUILDING, ME, MEMBERS, NOTICES, SOS, appUpdate, liveUpdate } from './sampleData';

const params = new URLSearchParams(window.location.search);

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
    NOTICES.forEach((n) => notify[n.severity](n.message, { title: n.title, duration: 0 }));
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
  'emergency-button': {
    label: 'Emergency button (resting)',
    render: () => <SosTrigger socket={null} getLocation={() => ME} roomCode="K7M2QX" senderName="ALPHA" />,
  },
  'emergency-received': {
    label: 'Emergency alert received (2 queued)',
    render: () => <SosOverlay {...SOS} onAcknowledge={() => {}} />,
  },
  notifications: { label: 'Notifications (all four types)', render: () => <Notices /> },
  'update-available': {
    label: 'Update available',
    render: () => <UpdateModal update={appUpdate(UpdateStatus.AVAILABLE)} />,
  },
  'update-downloading': {
    label: 'Update downloading',
    render: () => <UpdateModal update={appUpdate(UpdateStatus.DOWNLOADING)} />,
  },
  'update-install-permission': {
    label: 'Update needs install permission',
    render: () => <UpdateModal update={appUpdate(UpdateStatus.PERMISSION_REQUIRED)} />,
  },
  'update-safety-check-failed': {
    label: 'Update safety check failed',
    render: () => <UpdateModal update={appUpdate(UpdateStatus.ERROR, { error: { message: 'The download did not match its published checksum.' } })} />,
  },
  'update-mandatory': {
    label: 'Mandatory update',
    render: () => <UpdateModal update={appUpdate(UpdateStatus.AVAILABLE, { mandatory: true })} />,
  },
  'update-strip-ready': {
    label: 'Small update ready (strip)',
    render: () => <LiveUpdateToast live={liveUpdate(LiveUpdateStatus.READY)} />,
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
  'place-details': {
    label: 'More about this place',
    render: () => (
      <div style={{ paddingTop: 120 }}>
        <BuildingInfo building={BUILDING} me={ME} heading={0} headingLive onTakeMeThere={() => {}} onShowOnMap={() => {}} />
      </div>
    ),
  },
  'ar-tags-bright': { label: 'AR Scan labels over a bright scene', render: () => <ArTags scene="bright" /> },
  'ar-tags-dark': { label: 'AR Scan labels over a dark scene', render: () => <ArTags scene="dark" /> },
  guide: { label: 'Guide (signed-out landing page)', render: () => <LocusGuide onInitialize={() => {}} /> },
};

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
        src={`?frame=1&screen=${id}&theme=${theme}${params.get('sound') === '1' ? '&sound=1' : ''}`}
        style={{ ...PHONE, display: 'block', border: 0, borderRadius: 28, background: '#000', boxShadow: '0 0 0 1px #c9ced6, 0 12px 32px rgba(0,0,0,0.18)' }}
      />
    </figure>
  );
}

// Inside a frame: just the screen, filling the phone. (Its theme is set on <html> before the
// first render; see the bottom of this file.)
function FrameContent({ id }) {
  return <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>{SCREENS[id].render()}</div>;
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
if (params.get('frame') === '1') document.documentElement.dataset.theme = params.get('theme') === 'light' ? 'light' : 'dark';
createRoot(document.getElementById('preview-root')).render(
  params.get('frame') === '1'
    ? <FrameContent id={frameId} />
    : <Gallery />,
);
