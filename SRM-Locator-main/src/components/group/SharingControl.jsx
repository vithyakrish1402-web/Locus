import React from 'react';
import { SectionLabel, SegmentedControl } from '../ui';
import { SHARING_CONTROL } from '../../copy/group';

// "Your location": Live, Paused or Hidden, with a line saying what the group sees (redesign
// Group panel batch, piece 2). The same three modes as before (ACTIVE, FROZEN, GHOST), set the
// same way; only the look and the words are new. The line never claims more than is shared:
// live before a fix, and paused with no spot taken, say so.

const DOT = { ACTIVE: 'bg-success', FROZEN: 'bg-warning' };

/**
 * @param {{ mode: 'ACTIVE'|'FROZEN'|'GHOST', onChange: (mode: string) => void,
 *   waiting?: boolean, pausedNoSpot?: boolean, polling?: string }} props
 */
export default function SharingControl({ mode, onChange, waiting = false, pausedNoSpot = false, polling = 'standard' }) {
  const help = mode === 'ACTIVE'
    ? (waiting ? SHARING_CONTROL.help.waiting : SHARING_CONTROL.help.ACTIVE(polling))
    : mode === 'FROZEN'
      ? (pausedNoSpot ? SHARING_CONTROL.help.pausedNoSpot : SHARING_CONTROL.help.FROZEN)
      : SHARING_CONTROL.help.GHOST;
  return (
    <section data-testid="sharing-control" className="pt-1">
      <SectionLabel as="h3">{SHARING_CONTROL.label}</SectionLabel>
      <SegmentedControl
        label={SHARING_CONTROL.label}
        value={mode}
        onChange={onChange}
        options={['ACTIVE', 'FROZEN', 'GHOST'].map((value) => ({
          value,
          label: SHARING_CONTROL.options[value],
          leading: value === mode && DOT[value] ? <span className={`w-2.5 h-2.5 rounded-full ${DOT[value]}`} aria-hidden="true" /> : null,
        }))}
      />
      <p className="mt-2 px-1 font-ui text-secondary text-text-secondary" data-testid="sharing-help">{help}</p>
    </section>
  );
}
