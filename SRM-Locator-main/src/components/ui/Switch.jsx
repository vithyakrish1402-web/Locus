import React, { useId } from 'react';

// An on/off row: the setting's name (and a line under it) on the left, the switch on the
// right. The whole row is the control. `locked` shows a setting that can't be turned off
// (Emergency alerts: Always on): it reads as on, and taps do nothing.

/**
 * @param {{ label: React.ReactNode, description?: React.ReactNode, checked: boolean,
 *   onChange?: (checked: boolean) => void, locked?: boolean }} props
 */
export default function Switch({ label, description, checked, onChange, locked = false, className = '' }) {
  const descriptionId = useId();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-disabled={locked || undefined}
      aria-describedby={description ? descriptionId : undefined}
      onClick={() => { if (!locked) onChange?.(!checked); }}
      data-no-press
      className={`w-full flex items-center gap-4 px-4 py-3 min-h-14 font-ui text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${className}`}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-body text-text">{label}</span>
        {description && <span id={descriptionId} className="block text-secondary text-text-secondary">{description}</span>}
      </span>
      <span
        aria-hidden="true"
        className={`relative shrink-0 w-[52px] h-8 rounded-full border ${checked ? 'bg-accent border-accent' : 'bg-sunken border-border-control'} ${locked ? 'opacity-60' : ''}`}
      >
        <span
          className={`absolute top-[3px] left-[3px] w-6 h-6 rounded-full shadow-[var(--shadow-1)] transition-transform duration-200 ease-standard ${checked ? 'translate-x-5 bg-accent-on' : 'translate-x-0 bg-text-secondary'}`}
        />
      </span>
    </button>
  );
}
