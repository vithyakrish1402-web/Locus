import React from 'react';

// A grey placeholder where content is still loading. It pulses (opacity 1 -> 0.55 -> 1 over
// 1.4 s, .locus-skeleton in index.css) and holds still with reduced motion. Size it with
// className (h-4 w-32, rounded-full for an avatar).

export default function Skeleton({ className = '' }) {
  return <span className={`locus-skeleton block bg-sunken rounded-fill ${className}`} aria-hidden="true" />;
}
