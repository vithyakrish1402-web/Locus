import React, { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { recorder } from '../../utils/floor7Recorder.js';
import { Switch } from '../ui';
import { DevButton, Page } from './ui';
import WalkTest from './WalkTest';

const DEVELOPER_Z = 5100;

/**
 * The options Developer mode offers. Add a card here and it appears on the screen: `render`
 * draws the card's body; `collapsed` cards open on tap.
 */
const OPTIONS = [
  {
    id: 'walk-test',
    title: 'Floor 7 walk test',
    description: 'Check how accurate indoor positioning is on Floor 7.',
    action: 'Open the walk test',
  },
  {
    id: 'map-overlay',
    title: 'Floor 7 map overlay',
    description: 'Show the Floor 7 plan and your position on the main map screen.',
    collapsed: true,
  },
];

function OptionCard({ option, children }) {
  const body = (
    <div className="flex flex-col gap-3">
      <p>{option.description}</p>
      {children}
    </div>
  );
  if (option.collapsed) {
    return (
      <details className="rounded-2xl border border-border bg-surface" data-option={option.id}>
        <summary className="min-h-12 px-4 py-3 flex items-center justify-between gap-2 cursor-pointer font-semibold text-lg">
          {option.title}<ChevronDown size={20} aria-hidden="true" />
        </summary>
        <div className="px-4 pb-4">{body}</div>
      </details>
    );
  }
  return (
    <section className="rounded-2xl border border-border bg-surface px-4 py-4 flex flex-col gap-3" data-option={option.id}>
      <h2 className="text-lg font-semibold">{option.title}</h2>
      {body}
    </section>
  );
}

/**
 * Developer mode: a full screen of option cards. Opened from the badge in the header.
 * `context` is what the walk test needs to know about the app: whether this phone is in a
 * group, and what the last Wi-Fi scan cycle did. Kept mounted once opened (App hides it), so a
 * walk in progress survives closing it.
 */
export default function DeveloperScreen({ open, onClose, overlayOn, onOverlay, inGroup, lastCycle }) {
  const [option, setOption] = useState(null);
  // Turning Developer mode off (or signing out) removes this screen: a walk still recording is stopped and saved.
  useEffect(() => () => { if (recorder.recording) recorder.stop(); }, []);

  return (
    <div
      hidden={!open}
      data-testid="developer-screen"
      className="fixed inset-0 bg-bg"
      style={{ zIndex: DEVELOPER_Z }}
    >
      {option === 'walk-test' ? (
        <WalkTest inGroup={inGroup} lastCycle={lastCycle} onBack={() => setOption(null)} />
      ) : (
        <Page title="Developer mode" onBack={onClose} backLabel="Close" footer={<p className="text-sm text-text-secondary">Only you can see this. It never sends anything to the server or to other people.</p>}>
          <p>Tools for testing LOCUS. Pick one.</p>
          {OPTIONS.map((o) => (
            <OptionCard key={o.id} option={o}>
              {o.id === 'walk-test' && <DevButton block onClick={() => setOption('walk-test')} data-testid="open-walk-test">{o.action}</DevButton>}
              {o.id === 'map-overlay' && <Switch label="Show the plan on the main map" checked={overlayOn} onChange={onOverlay} />}
            </OptionCard>
          ))}
        </Page>
      )}
    </div>
  );
}
