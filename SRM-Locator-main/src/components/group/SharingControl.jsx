import React, { useState } from 'react';
import { SectionLabel, SegmentedControl, Button } from '../ui';
import { SHARING_CONTROL, TIMED_PRIVACY } from '../../copy/group';
import { useNow } from '../../hooks/useNow';
import { clockLabel, countdownLabel, durationChoices, msLeft } from '../../utils/timedPrivacy';

// "Your location": Live, Paused or Hidden, with a line saying what the group sees (redesign
// Group panel batch, piece 2). The same three modes as before (ACTIVE, FROZEN, GHOST), set the
// same way; only the look and the words are new. The line never claims more than is shared:
// live before a fix, and paused with no spot taken, say so.
//
// Timed Pause and Hidden (Stage 4, `timed` given and active): picking Paused or Hidden first asks
// for how long, up to what the server says is left of the hour, and a running one counts down by
// the server's clock. Without `timed`, or with it inactive, it is exactly as before.

const DOT = { ACTIVE: 'bg-success', FROZEN: 'bg-warning' };

/**
 * @param {{ mode: 'ACTIVE'|'FROZEN'|'GHOST', onChange: (mode: string) => void,
 *   waiting?: boolean, pausedNoSpot?: boolean, polling?: string,
 *   timed?: { active: boolean, hold: {mode: string, until: number}|null, allowanceLeftMs: number|null,
 *     offset: number, pending: boolean, onPick: (mode: string, minutes: number) => void } }} props
 */
export default function SharingControl({ mode, onChange, waiting = false, pausedNoSpot = false, polling = 'standard', timed = null }) {
  const [picking, setPicking] = useState(null); // 'FROZEN' | 'GHOST' while choosing how long
  const isTimed = Boolean(timed?.active);
  const help = mode === 'ACTIVE'
    ? (waiting ? SHARING_CONTROL.help.waiting : SHARING_CONTROL.help.ACTIVE(polling))
    : mode === 'FROZEN'
      ? (pausedNoSpot ? SHARING_CONTROL.help.pausedNoSpot : SHARING_CONTROL.help.FROZEN)
      : SHARING_CONTROL.help.GHOST;

  const choose = (value) => {
    if (!isTimed || value === 'ACTIVE') {
      setPicking(null);
      onChange(value);
      return;
    }
    if (value === mode && timed.hold) return; // already held: the countdown says how long
    setPicking(value);
  };

  return (
    <section data-testid="sharing-control" className="pt-1">
      <SectionLabel as="h3">{SHARING_CONTROL.label}</SectionLabel>
      <SegmentedControl
        label={SHARING_CONTROL.label}
        value={mode}
        onChange={choose}
        options={['ACTIVE', 'FROZEN', 'GHOST'].map((value) => ({
          value,
          label: SHARING_CONTROL.options[value],
          leading: value === mode && DOT[value] ? <span className={`w-2.5 h-2.5 rounded-full ${DOT[value]}`} aria-hidden="true" /> : null,
        }))}
      />
      {isTimed && picking && (
        <DurationPicker
          mode={picking}
          allowanceLeftMs={timed.allowanceLeftMs}
          pending={timed.pending}
          onPick={(minutes) => {
            setPicking(null);
            timed.onPick(picking, minutes);
          }}
          onCancel={() => setPicking(null)}
        />
      )}
      {isTimed && !picking && timed.hold && timed.hold.mode === mode && <HoldCountdown hold={timed.hold} offset={timed.offset} />}
      <p className="mt-2 px-1 font-ui text-secondary text-text-secondary" data-testid="sharing-help">{help}</p>
      {isTimed && Number.isFinite(timed.allowanceLeftMs) && (
        <p className="mt-1 px-1 font-ui text-caption text-text-secondary" data-testid="sharing-allowance">
          {TIMED_PRIVACY.allowanceLeft(timed.allowanceLeftMs)}
        </p>
      )}
    </section>
  );
}

// For how long: the usual durations up to what is left (at most 30 minutes), or plain words when
// nothing is left.
function DurationPicker({ mode, allowanceLeftMs, pending, onPick, onCancel }) {
  const choices = durationChoices(allowanceLeftMs);
  return (
    <div data-testid="duration-picker" className="mt-2 p-3 rounded-2xl bg-sunken" role="group" aria-label={TIMED_PRIVACY.pickTitle[mode]}>
      <p className="font-ui text-label text-text font-medium">{TIMED_PRIVACY.pickTitle[mode]}</p>
      {choices.length === 0 ? (
        <p className="mt-1 font-ui text-secondary text-text-secondary" data-testid="duration-none">{TIMED_PRIVACY.allowanceNone}</p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          {choices.map((minutes) => (
            <Button key={minutes} variant="tonal" className="!min-h-10 px-4" disabled={pending} onClick={() => onPick(minutes)}>
              {TIMED_PRIVACY.minutes(minutes)}
            </Button>
          ))}
        </div>
      )}
      <Button variant="plain" className="mt-1" onClick={onCancel}>{TIMED_PRIVACY.cancel}</Button>
    </div>
  );
}

// "Paused for 12:34 more, until 14:05": by the server's clock, the time shown in the phone's own.
function HoldCountdown({ hold, offset }) {
  const now = useNow(1000);
  const left = msLeft(hold.until, offset, now);
  return (
    <p className="mt-2 px-1 font-ui text-label text-text font-medium tabular-nums" data-testid="hold-countdown" aria-live="polite">
      {TIMED_PRIVACY.countdown[hold.mode](countdownLabel(left), clockLabel(hold.until, offset))}
    </p>
  );
}
