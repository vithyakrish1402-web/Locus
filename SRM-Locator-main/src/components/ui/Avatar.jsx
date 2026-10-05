import React from 'react';
import { initialsOf } from './initials';

// A person: their photo, or their initials on an accent-soft disc with a 2 px accent ring.
// `dashed` (a Paused or Hidden member, someone not live) swaps the ring for a dashed grey
// one, as on the map. 40 px in lists, 36 px on the map.

const SIZES = {
  list: 'w-[var(--size-avatar)] h-[var(--size-avatar)] text-label',
  map: 'w-[var(--size-avatar-map)] h-[var(--size-avatar-map)] text-secondary font-semibold',
};

/**
 * @param {{ name: string, photo?: string|null, size?: keyof SIZES, dashed?: boolean }} props
 */
export default function Avatar({ name, photo = null, size = 'list', dashed = false, className = '' }) {
  const ring = dashed
    ? 'border-2 border-dashed border-border-control bg-surface text-text-secondary'
    : 'border-2 border-accent bg-accent-soft text-accent';
  return (
    <span
      className={`shrink-0 inline-flex items-center justify-center rounded-full overflow-hidden font-ui ${SIZES[size]} ${ring} ${className}`}
      aria-hidden="true"
    >
      {photo ? <img src={photo} alt="" className="w-full h-full object-cover" /> : initialsOf(name)}
    </span>
  );
}
