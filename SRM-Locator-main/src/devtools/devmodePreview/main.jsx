// Dev-only (see /devmode-preview.html): the Developer mode screens fed sample data, so they can
// be looked at in a 360 x 800 frame at any font scale. Never part of a release.
/* eslint-disable react-refresh/only-export-components */
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../index.css';
import { MotionGlobalConfig } from 'framer-motion';
import AdvancedSection from '../../components/devmode/AdvancedSection';
import DeveloperScreen from '../../components/devmode/DeveloperScreen';
import PreviousRecordings from '../../components/devmode/PreviousRecordings';
import ReadyCheck from '../../components/devmode/ReadyCheck';
import ResultsScreen from '../../components/devmode/ResultsScreen';
import WalkingScreen from '../../components/devmode/WalkingScreen';
import { createFloor7Tracker } from '../../utils/floor7Demo';
import { toGeo } from '../../utils/floor7Frame';
import { TOUR_PLACES, doneDoor, imHere, shortestTour, startPassage, startWalk } from '../../utils/floor7Guided';
import { createMemoryStore, createRecorder } from '../../utils/floor7Recorder';

MotionGlobalConfig.skipAnimations = true;
const params = new URLSearchParams(window.location.search);
const screenId = params.get('screen') ?? 'home';
const scale = Number(params.get('scale') ?? 1);
document.documentElement.style.fontSize = `${16 * scale}px`;
if (params.get('theme')) document.documentElement.dataset.theme = params.get('theme');

const NOW = Date.now();
const store = createMemoryStore();
const rec = createRecorder({ store, attachLifecycle: () => () => {}, setTimer: () => 0, clearTimer: () => {} });

// A track near Room 701 for the plan.
const tracker = createFloor7Tracker({ staleMs: 70_000 });
tracker.reset();
[[-9, 6], [-9, 8], [-9, 10.5], [-9, 12]].forEach(([x, y], i) => {
  tracker.apply({ ...toGeo(x, y), building: 'TECH PARK', floor: 7, confidence: 0.9 }, NOW - (4 - i) * 5000);
});
const trail = (await import('../../utils/floor7Demo')).getTrail();

const doors = shortestTour('r701', TOUR_PLACES);
const row = (door, place, walkM, rawWalkM, shown = true) => ({ door, place, shown, walkM, rawWalkM, from: 1, fixesInWindow: 2, status: 'tracking' });
const report = {
  doorRows: [
    row('r701', 'Room 701', 2.4, 6.1), row('r702', 'Room 702', 4.9, 8.2), row('r703', 'Room 703', 7.3, 12.8),
    row('rW', 'New ladies restroom (\'W\')', 21.4, 24.9), row('r706A', 'Room 706A (staff room)', 0, 0, false),
  ],
  walkRows: [{ from: 'Lift lobby A', to: 'Lift lobby B', shown: true, lagM: 14.2, catchUpS: 40, startAt: 1, endAt: 2, seconds: 61 }],
};

function Walking({ phase }) {
  const [walk, setWalk] = useState(() => {
    rec.start();
    let w = startWalk(doors.slice(0, 5));
    w = doneDoor(imHere(w));
    w = doneDoor(imHere(w));
    if (phase === 'door') return w;
    if (phase === 'standing') { rec.markDoor(w.doors[w.index]); return imHere(w); }
    for (let i = 0; i < 3; i++) w = doneDoor(imHere(w));
    return startPassage(w);
  });
  return <WalkingScreen rec={rec} walk={walk} setWalk={setWalk} trail={trail} onStop={() => {}} />;
}

function Previous() {
  const [ready, setReady] = useState(false);
  React.useEffect(() => {
    (async () => { rec.start(); await rec.stop(); setReady(true); })();
  }, []);
  return ready ? <PreviousRecordings rec={rec} trail={[]} onBack={() => {}} /> : null;
}

const SCREENS = {
  home: () => <DeveloperScreen open onClose={() => {}} overlayOn={false} onOverlay={() => {}} inGroup lastCycle={null} />,
  ready: () => <ReadyCheck inGroup={false} lastCycle={null} trail={[]} onStart={() => {}} onBack={() => {}} onPrevious={() => {}} />,
  'ready-ok': () => <ReadyCheck inGroup lastCycle={{ outcome: 'estimate', at: NOW }} trail={[{ at: NOW - 3000, filtered: { x: 0, y: 0 } }]} onStart={() => {}} onBack={() => {}} onPrevious={() => {}} />,
  walking: () => <Walking phase="door" />,
  standing: () => <Walking phase="standing" />,
  passage: () => <Walking phase="passage" />,
  results: () => <ResultsScreen id="floor7_20261014_164710" report={report} trail={trail} onShare={() => {}} onDownloads={() => {}} onAnother={() => {}} onPrevious={() => {}} onBack={() => {}} backLabel="Close" />,
  previous: () => <Previous />,
  advanced: () => <div className="p-4 bg-bg min-h-screen"><AdvancedSection trail={trail} /></div>,
};
const Screen = SCREENS[screenId] ?? SCREENS.home;

createRoot(document.getElementById('preview-root')).render(
  <div style={{ position: 'fixed', inset: 0 }} className="bg-bg"><Screen /></div>,
);
if (screenId === 'advanced') setTimeout(() => document.querySelector('details')?.setAttribute('open', ''), 100);
