import React, { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import { useNow } from '../../hooks/useNow.js';
import { recorder } from '../../utils/floor7Recorder.js';
import {
  TOUR_PLACES, placeName, readyItems, shortestTour, tourLength, whyNotReady,
} from '../../utils/floor7Guided.js';
import { DevButton, Note, Page } from './ui';

const move = (list, i, by) => {
  const j = i + by;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
};

/** Screen A: the ready check, the route, and Start. */
export default function ReadyCheck({ inGroup, lastCycle, trail, onStart, onBack, onPrevious }) {
  const now = useNow();
  const [since] = useState(() => Date.now());
  const [route, setRoute] = useState(() => shortestTour('r701', TOUR_PLACES).map((id) => ({ id, include: true })));
  const [killed, setKilled] = useState([]);
  useEffect(() => {
    let live = true;
    recorder.recoverable().then((r) => { if (live) setKilled(r); }).catch(() => {});
    return () => { live = false; };
  }, []);

  const items = readyItems({ inGroup, cycle: lastCycle, trail, now, waitingSince: since });
  const reason = whyNotReady(items);
  const chosen = route.filter((r) => r.include).map((r) => r.id);
  const position = items.at(-1);

  return (
    <Page
      title="Floor 7 walk test"
      onBack={onBack}
      footer={<DevButton size="large" block disabled={Boolean(reason) || chosen.length === 0} onClick={() => onStart(chosen)} data-testid="start-walk">Start recording</DevButton>}
    >
      <p>Check everything below is ticked. Then you will walk to each door, stand still for about a minute, and the phone works out how far off it was.</p>
      {reason && <Note tone="warn" role="status" data-testid="why-disabled">{reason}</Note>}
      <ul className="flex flex-col gap-2" aria-label="Ready check">
        {items.map((i) => (
          <li key={i.id} data-ready={i.ok ? 'yes' : 'no'} className="flex gap-3 items-start rounded-xl border border-border bg-surface px-3 py-3">
            <span className={`shrink-0 mt-0.5 inline-flex w-7 h-7 items-center justify-center rounded-full text-white ${i.ok ? 'bg-[#1b7f3b]' : 'bg-[#4b5563]'}`} aria-hidden="true">
              {i.ok ? <Check size={18} /> : <X size={18} />}
            </span>
            <div className="min-w-0">
              <p className="font-semibold break-words">{i.label}<span className="sr-only">{i.ok ? ': done' : ': not yet'}</span></p>
              {!i.ok && i.fix && <p className="text-text-secondary break-words">{i.fix}</p>}
              {i.id === 'position' && !i.ok && (
                <p className="text-text-secondary break-words" data-testid="waiting-line">
                  Waiting… {position.waitingS} s. This can take up to 70 seconds. Stay on Floor 7 with the screen on.
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>

      {killed.length > 0 && (
        <Note tone="warn" data-testid="recover-note">
          LOCUS Test was closed in the middle of a walk ({killed[0].id}). Its files can still be recovered from the Previous recordings list.
        </Note>
      )}

      <section aria-labelledby="route-heading" className="flex flex-col gap-2">
        <h2 id="route-heading" className="text-lg font-semibold">Your route</h2>
        <p>{chosen.length} doors, about {Math.round(tourLength(chosen))} m of walking, in the shortest order along the corridors. Move a door, or skip it.</p>
        <ol className="flex flex-col gap-2" data-testid="route-list">
          {route.map((r, i) => (
            <li key={r.id} className={`rounded-xl border border-border px-3 py-2 flex flex-wrap items-center gap-2 ${r.include ? 'bg-surface' : 'bg-sunken opacity-70'}`}>
              <span className="min-w-0 flex-1 basis-40 break-words">{i + 1}. {placeName(r.id)}{r.include ? '' : ' (skipped)'}</span>
              <DevButton variant="secondary" disabled={i === 0} onClick={() => setRoute(move(route, i, -1))} aria-label={`Move ${placeName(r.id)} up`}>Up</DevButton>
              <DevButton variant="secondary" disabled={i === route.length - 1} onClick={() => setRoute(move(route, i, 1))} aria-label={`Move ${placeName(r.id)} down`}>Down</DevButton>
              <DevButton variant="secondary" onClick={() => setRoute(route.map((x, k) => (k === i ? { ...x, include: !x.include } : x)))} aria-label={`${r.include ? 'Skip' : 'Include'} ${placeName(r.id)}`}>{r.include ? 'Skip' : 'Include'}</DevButton>
            </li>
          ))}
        </ol>
      </section>
      <DevButton variant="tonal" onClick={onPrevious}>Previous recordings</DevButton>
    </Page>
  );
}
