import React from 'react';
import BrandMark from './BrandMark';
import { BOOT } from '../../copy/access';

// Shown while Firebase restores the saved session on a cold start: the LOCUS mark, the name
// and what it is for. Still, with nothing spinning: the wait is short.
export default function BootScreen() {
  return (
    <div
      className="min-h-[100dvh] bg-bg text-text font-ui flex flex-col items-center justify-center gap-4 px-5"
      role="status"
      aria-live="polite"
      aria-label={BOOT.loading}
    >
      <BrandMark />
      <div className="text-center">
        <p className="text-title">{BOOT.title}</p>
        <p className="text-body text-text-secondary">{BOOT.tagline}</p>
      </div>
    </div>
  );
}
