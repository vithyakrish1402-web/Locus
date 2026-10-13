import React from 'react';

// Small labels: a chip ("You're the Group Lead"), a sharing-status dot with its words
// ("Live now", "Paused · 6 min ago"), and a count badge (2 join requests).

const CHIP_TONES = {
  accent: 'backdrop-blur-md bg-accent-soft/85 text-accent border border-accent/25 shadow-sm',
  neutral: 'backdrop-blur-md bg-[var(--glass-sunken)] text-text-secondary border border-[var(--glass-border-subtle)]',
};

/**
 * @param {{ tone?: keyof CHIP_TONES, icon?: React.ComponentType<{size?: number}> }
 *   & React.HTMLAttributes<HTMLSpanElement>} props
 */
export default function Chip({ tone = 'accent', icon: Icon = null, className = '', children, ...props }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 min-h-8 px-3.5 rounded-full font-ui text-secondary font-semibold transition-[transform,opacity] ${CHIP_TONES[tone]} ${className}`}
      {...props}
    >
      {Icon && <Icon size={15} aria-hidden="true" />}
      {children}
    </span>
  );
}

// Live: green dot. Paused: amber dot. Hidden: a dashed ring, nothing filled.
const DOTS = {
  live: 'bg-success',
  paused: 'bg-warning',
  hidden: 'border border-dashed border-border-control',
  // Live, with no fix yet: a plain grey dot, nothing claimed.
  waiting: 'bg-border-control',
};

/** A sharing-status dot, then its words (children). */
export function StatusDot({ status, className = '', children }) {
  return (
    <span className={`inline-flex items-center gap-2 font-ui text-secondary text-text-secondary ${className}`}>
      <span className={`shrink-0 w-2.5 h-2.5 rounded-full ${DOTS[status]}`} aria-hidden="true" />
      {children}
    </span>
  );
}

/** A count on a button or tab (join requests). Hidden when there is nothing to count. */
export function Badge({ count, label, className = '' }) {
  if (!count) return null;
  return (
    <span
      aria-label={label}
      className={`inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-accent text-accent-on font-ui text-[11px] font-bold tabular-nums shadow-[0_2px_6px_var(--color-accent-halo)] ${className}`}
    >
      {count}
    </span>
  );
}
