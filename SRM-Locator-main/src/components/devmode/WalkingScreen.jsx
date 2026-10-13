import React, { useState } from 'react';
import { useFloor7Recorder } from '../../hooks/useFloor7Recorder.js';
import { useNow } from '../../hooks/useNow.js';
import { recorder } from '../../utils/floor7Recorder.js';
import {
  PASSAGE, doneDoor, endPassage, frontOf, imHere, placeName, plainStatus, progress, skipDoor, startPassage, undo,
} from '../../utils/floor7Guided.js';
import { ProgressBar } from '../ui';
import { DevButton } from './ui';
import ZoomablePlan, { PlanLegend } from './ZoomablePlan';

const clock = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

/** What to do now: the words and the one main button. */
function instruction(walk, snap) {
  const name = walk.doors[walk.index] && placeName(walk.doors[walk.index]);
  switch (walk.phase) {
    case 'door':
      return { text: `Next: ${name}. Walk to the corridor in front of the door and stand still.`, main: 'I’m here', key: 'here' };
    case 'dwell':
      return snap.current
        ? { text: `Stand still: ${snap.current.secondsLeft} s`, main: 'Done, next door', key: 'done' }
        : { text: `Time is up at ${name}. Walk to the next door.`, main: 'Next door', key: 'done' };
    case 'passage':
      return { text: `Now walk the whole middle passage without stopping. Stand at ${placeName(PASSAGE.from)}, tap Start of walk, then walk to ${placeName(PASSAGE.to)}.`, main: 'Start of walk', key: 'start' };
    case 'walking':
      return { text: `Keep walking to ${placeName(PASSAGE.to)}, without stopping. Tap End of walk when you get there.`, main: 'End of walk', key: 'end' };
    default:
      return { text: 'All done. Stop the recording to see how accurate it was.', main: 'Stop and see results', key: 'stop' };
  }
}

/** Screen B: the plan on top, one instruction card below. */
export default function WalkingScreen({ rec = recorder, walk, setWalk, trail, onStop }) {
  const snap = useFloor7Recorder(rec);
  const now = useNow();
  const [confirm, setConfirm] = useState(false);
  const step = instruction(walk, snap);
  const { at, of } = progress(walk);
  const target = walk.phase === 'passage' ? PASSAGE.from : walk.phase === 'walking' ? PASSAGE.to : walk.phase === 'finished' ? null : walk.doors[walk.index];
  const scale = (id) => { const p = frontOf(id); return { x: p.x, y: p.y }; };
  const last = trail.at(-1) ?? null;
  const status = plainStatus({ last, leftScreen: Boolean(snap.warning), now });
  const settled = walk.done.length + walk.skipped.length;

  const act = {
    here: () => { rec.markDoor(walk.doors[walk.index]); setWalk(imHere(walk)); },
    done: () => { rec.doneDoor(); setWalk(doneDoor(walk)); },
    start: () => { rec.markWalk('start', PASSAGE.from); setWalk(startPassage(walk)); },
    end: () => { rec.markWalk('end', PASSAGE.to); setWalk(endPassage(walk)); },
    stop: () => setConfirm(true),
  };
  const undoLast = () => {
    const { state, removesMark } = undo(walk);
    if (removesMark) rec.undoMark();
    setWalk(state);
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-bg text-text font-ui text-base" data-testid="walking-screen">
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2 border-b border-border">
        <span className="font-bold text-[#b91c1c]" data-testid="recording-label">● Recording</span>
        <span data-testid="elapsed">{clock(snap.elapsedMs ?? 0)}</span>
        <DevButton variant="secondary" onClick={act.stop}>Stop</DevButton>
      </div>

      <div className="shrink-0 h-[34dvh] px-3 pt-3">
        <ZoomablePlan className="h-full" trail={trail} target={target ? scale(target) : null} />
      </div>

      <div className="flex-1 min-h-0 flex flex-col mt-3 border-t border-border bg-surface">
        {confirm ? (
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col gap-3">
            <p className="text-lg font-semibold">Stop recording?</p>
            <p>The files are saved and you see your results. You cannot add more doors to this walk afterwards.</p>
            <DevButton size="large" block onClick={() => { setConfirm(false); onStop(); }} data-testid="confirm-stop">Stop and see results</DevButton>
            <DevButton variant="secondary" block onClick={() => setConfirm(false)}>Keep walking</DevButton>
          </div>
        ) : (
          <>
            <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-2 flex flex-col gap-3">
              <p className="text-lg font-semibold break-words" data-testid="instruction">{step.text}</p>
              <p className="break-words" role="status" data-testid="status-line">{status}</p>
              {snap.warning && <DevButton variant="tonal" block onClick={() => rec.dismissWarning()}>OK, I am back</DevButton>}
              <div className="flex flex-col gap-1">
                <p data-testid="progress-text">{walk.doors.length === 0 ? 'No doors chosen' : `Door ${at} of ${of}`}{settled === of && of > 0 ? ' (all done)' : ''}</p>
                <ProgressBar percent={of ? (settled / of) * 100 : 100} />
              </div>
              <ol className="flex flex-col gap-1" aria-label="Doors" data-testid="door-list">
                {walk.doors.map((id, i) => {
                  const state = walk.done.includes(id) ? 'done' : walk.skipped.includes(id) ? 'skipped' : i === walk.index && walk.phase !== 'passage' && walk.phase !== 'walking' && walk.phase !== 'finished' ? 'next' : 'later';
                  return (
                    <li key={id} data-door-state={state} aria-current={state === 'next' ? 'step' : undefined}
                      className={`rounded-lg px-3 py-2 break-words ${state === 'next' ? 'border-2 border-accent bg-accent-soft font-semibold' : 'border border-border'}`}>
                      {state === 'done' ? '✓ ' : state === 'skipped' ? '– ' : state === 'next' ? '→ ' : ''}{placeName(id)}{state === 'skipped' ? ' (skipped)' : ''}
                    </li>
                  );
                })}
              </ol>
              <PlanLegend />
            </div>
            <div className="shrink-0 px-4 py-3 border-t border-border flex flex-col gap-2">
              <DevButton size="large" block onClick={step.key === 'stop' ? act.stop : act[step.key]} data-testid="main-action">{step.main}</DevButton>
              <div className="flex flex-wrap gap-2">
                {walk.phase === 'door' && <DevButton variant="secondary" onClick={() => setWalk(skipDoor(walk))}>Skip this door</DevButton>}
                <DevButton variant="secondary" disabled={walk.history.length === 0} onClick={undoLast}>Undo last</DevButton>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
