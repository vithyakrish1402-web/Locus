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
      className={`w-full flex items-center justify-between gap-4 px-4 py-3 min-h-14 font-ui text-left transition-colors duration-150 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] active:bg-black/[0.04] dark:active:bg-white/[0.04] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${className}`}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-body font-medium text-text">{label}</span>
        {description && <span id={descriptionId} className="block text-secondary text-text-secondary mt-0.5">{description}</span>}
      </span>
      <span
        aria-hidden="true"
        className={`relative shrink-0 w-[51px] h-[31px] rounded-full transition-colors duration-250 ease-out border ${checked ? 'bg-accent border-accent/80 shadow-[0_0_12px_var(--color-accent-halo)]' : 'bg-black/10 dark:bg-white/15 border-transparent'} ${locked ? 'opacity-60' : ''}`}
      >
        <span
          className={`absolute top-[2px] left-[2px] w-[25px] h-[25px] rounded-full bg-white shadow-[0_2px_4px_rgba(0,0,0,0.2),0_0_1px_rgba(0,0,0,0.2)] transition-transform duration-250 ease-out ${checked ? 'translate-x-5' : 'translate-x-0'}`}
        />
      </span>
    </button>
  );
}
