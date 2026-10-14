import React from 'react';

// The LOCUS logo, drawn inline so it follows the theme: navy on the light theme, white on the
// dark one (branding/locus-logo-on-light.svg and locus-logo-on-dark.svg, which differ only in
// those colours). The colours are in index.css (.locus-mark-*), keyed on <html data-theme>
// like the rest of the app, so switching theme repaints it with no re-render. The launcher
// icon is a separate, fixed light-variant PNG set (scripts/generate-icons.mjs).
export default function LocusMark({ className = '', title }) {
  return (
    <svg
      viewBox="0 0 120 120"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : 'true'}
      focusable="false"
    >
      <circle className="locus-mark-ring" cx="60" cy="60" r="52" fill="none" strokeWidth="5" />
      <path className="locus-mark-pin" d="M60 92C60 92 38 70 38 55A22 22 0 0 1 82 55C82 70 60 92 60 92Z" />
      <circle className="locus-mark-hole" cx="60" cy="55" r="11" />
      <circle cx="60" cy="55" r="5.5" fill="#D9962B" />
    </svg>
  );
}
