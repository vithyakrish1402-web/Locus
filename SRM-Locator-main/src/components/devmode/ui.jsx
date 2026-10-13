import React from 'react';
import { Button } from '../ui';

// Shared parts of the Developer mode screens. Body text is at least 16 px (text-base), the
// smallest text anywhere is 14 px (text-sm), and every button is at least 48 px tall (the
// shared Button is). Nothing here is monospaced. Sizes are rem, so they grow with the phone's font size.

/** The shared Button, at 16 px so it matches the body text. */
export function DevButton({ className = '', ...props }) {
  return <Button className={`!text-base ${className}`} {...props} />;
}

export function Page({ title, onBack, backLabel = 'Back', children, footer = null }) {
  return (
    <div className="flex flex-col h-full min-h-0 bg-bg text-text font-ui text-base">
      <header className="shrink-0 flex flex-wrap items-center gap-3 px-4 py-3 border-b border-border">
        {onBack && <DevButton variant="secondary" onClick={onBack}>{backLabel}</DevButton>}
        <h1 className="text-xl font-semibold break-words min-w-0">{title}</h1>
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-4">{children}</div>
      {footer && <div className="shrink-0 px-4 py-3 border-t border-border bg-bg flex flex-col gap-2">{footer}</div>}
    </div>
  );
}

const CHIP = {
  good: 'bg-[#1b7f3b] text-white',
  fair: 'bg-[#b45309] text-white',
  far: 'bg-[#b91c1c] text-white',
  none: 'bg-[#4b5563] text-white',
};

/** A coloured chip that also says it in words, so colour is never the only signal. */
export function ResultChip({ tone, children }) {
  return <span data-chip={tone} className={`inline-flex items-center min-h-8 px-3 rounded-full text-sm font-semibold whitespace-nowrap ${CHIP[tone]}`}>{children}</span>;
}

export function Note({ children, tone = 'plain', ...props }) {
  const box = tone === 'warn' ? 'border-[#b45309] bg-[#b45309]/10' : 'border-border bg-surface';
  return <p className={`rounded-xl border px-3 py-2 text-base break-words ${box}`} {...props}>{children}</p>;
}
