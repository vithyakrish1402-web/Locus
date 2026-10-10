import React from 'react';

// A download's progress bar (the full update, and Send LOCUS to someone). A percent below 0
// or missing means the size is unknown: the bar is full but faint, with no number.

/** @param {{ percent?: number }} props */
export default function ProgressBar({ percent }) {
  const indeterminate = typeof percent !== 'number' || percent < 0;
  return (
    <div
      className="h-2 w-full rounded-full bg-sunken overflow-hidden"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      {...(indeterminate ? {} : { 'aria-valuenow': percent })}
    >
      {/* Full width, scaled from the left edge: a transform, not a width animation. */}
      <div
        className="h-full w-full origin-left rounded-full bg-accent transition-transform duration-200"
        style={{ transform: `scaleX(${indeterminate ? 1 : Math.min(100, Math.max(0, percent)) / 100})`, opacity: indeterminate ? 0.4 : 1 }}
      />
    </div>
  );
}
