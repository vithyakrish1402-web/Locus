import React, { useEffect, useId, useRef } from 'react';
import { useAlertAudio } from '../hooks/useAlertAudio';

// Full-viewport takeover for an incoming squad-wide SOS. Deliberately NOT a
// toast/modal: no click-outside dismiss, no Escape dismiss, no auto-timeout.
// ACKNOWLEDGE is the only way out, on purpose — a distress beacon that can be
// missed by glancing away, or dismissed by an accidental tap, defeats the point.
// (Android's Back button is held off separately, in useBackButtonGuard.)
//
// z-[10001]: one above every other z-index in the app (ARCompass's 9999 is the
// next highest actual-runtime value; LocusGuide's 10000 never coexists with this
// screen since it only renders pre-login). Rendered as a `fixed` sibling at the
// top level of App.jsx's return, not nested inside the map component tree, so it
// isn't trapped inside a Leaflet/Google Maps stacking context — those libraries
// only establish stacking contexts within their own subtree.
//
// HexGridOverlay.js, referenced as a possible texture source, no longer exists —
// it was deliberately deleted (commit 5353d06, "completely remove GeoFencePainter
// and HexGridOverlay canvas features"). The hex pattern below is a fresh inline
// SVG tile, not a resurrection of that file.
const HEX_PATTERN_ID = 'sos-hex-pattern';

const minutesAgo = (ageMs) => Math.floor((ageMs || 0) / 60000);

const SosOverlay = ({ senderName, lat, lng, ageMs = 0, pendingCount = 0, onAcknowledge }) => {
  const { start, stop } = useAlertAudio();
  const overlayRef = useRef(null);
  const acknowledgeRef = useRef(null);
  const titleId = useId();
  const descriptionId = useId();

  // No "already started" guard on purpose: start() is idempotent and stop() fully
  // tears down, so mount -> cleanup -> mount (what <StrictMode> does in dev) ends
  // with the klaxon running. A ref guard here skipped the second start() while the
  // cleanup had already stopped the first, leaving the klaxon silent in dev.
  useEffect(() => {
    start();
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate([300, 150, 300, 150, 300]);
    }
    return () => stop();
  }, [start, stop]);

  // Modal focus handling. The page underneath stays mounted and focusable, so without
  // this a keyboard or screen-reader user could Tab straight out of the alert into the
  // map. ACKNOWLEDGE is the only control, so "trapping" focus means keeping it there:
  // take focus on open, pull it back if it strays, and hand it back when we close.
  useEffect(() => {
    const previouslyFocused = document.activeElement;
    acknowledgeRef.current?.focus();

    const pullFocusBack = (event) => {
      if (!overlayRef.current?.contains(event.target)) acknowledgeRef.current?.focus();
    };
    document.addEventListener('focusin', pullFocusBack);

    return () => {
      document.removeEventListener('focusin', pullFocusBack);
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, []);

  const hasLocation = Number.isFinite(lat) && Number.isFinite(lng);
  const minutes = minutesAgo(ageMs);
  const displayName = (senderName || 'UNKNOWN NODE').toUpperCase();

  const statusLine = minutes >= 1
    ? `Sent ${minutes} min ago // Unacknowledged`
    : 'Transmitting // Unacknowledged';

  // What a screen reader announces on open (role="alertdialog" is announced
  // assertively) — the visible layout is terse and all-caps, so say it in words.
  const spokenDescription = [
    `${senderName || 'An unknown squad member'} has triggered an SOS beacon.`,
    hasLocation ? `Last known position ${lat.toFixed(4)}, ${lng.toFixed(4)}.` : 'Position unavailable.',
    minutes >= 1 ? `Sent ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago.` : null,
    pendingCount > 0
      ? `${pendingCount} more SOS ${pendingCount === 1 ? 'alert is' : 'alerts are'} waiting after this one.`
      : null,
    'Activate Acknowledge to dismiss.',
  ].filter(Boolean).join(' ');

  const handleAcknowledge = () => {
    stop();
    onAcknowledge();
  };

  // The only focusable thing here is ACKNOWLEDGE, so Tab has nowhere legitimate to go.
  const handleKeyDown = (event) => {
    if (event.key === 'Tab') {
      event.preventDefault();
      acknowledgeRef.current?.focus();
    }
  };

  return (
    <div
      ref={overlayRef}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onKeyDown={handleKeyDown}
      className="fixed inset-0 z-[10001] flex items-center justify-center pointer-events-auto"
      // #4A0A0A, opaque: a deep maroon that reads as "emergency" without being
      // mistaken for the tactical-red (#EF4444) UI chrome, and hides the map fully.
      style={{ background: '#4A0A0A' }}
    >
      <p id={descriptionId} className="sr-only">{spokenDescription}</p>

      {/* Hex grid layer: clipped to the rounded frame, static. Kept separate from
          the border below so the strobe (opacity) only touches the border and not
          the pattern or the text. */}
      <div
        aria-hidden="true"
        className="absolute inset-4 sm:inset-8 overflow-hidden"
        style={{ borderRadius: '20px' }}
      >
        <svg className="absolute inset-0 w-full h-full" style={{ opacity: 0.12 }}>
          <defs>
            <pattern id={HEX_PATTERN_ID} width="44" height="76" patternUnits="userSpaceOnUse" patternTransform="scale(1)">
              <path
                d="M22 0 L44 12.7 L44 38 L22 50.7 L0 38 L0 12.7 Z"
                fill="none"
                stroke="#EF4444"
                strokeWidth="1"
              />
              <path
                d="M22 50.7 L44 63.4 L44 76 L22 88.7 L0 76 L0 63.4 Z"
                fill="none"
                stroke="#EF4444"
                strokeWidth="1"
              />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill={`url(#${HEX_PATTERN_ID})`} />
        </svg>

        <span
          className="absolute top-4 left-5 font-dot uppercase tracking-[0.25em]"
          style={{ fontSize: '10px', color: 'rgba(200,140,140,0.55)' }}
        >
          Tactical Grid
        </span>
      </div>

      {/* Strobing border + glow (see .locus-sos-strobe in index.css). Its own
          layer so the animation is opacity-only and the glow isn't repainted. */}
      <div
        aria-hidden="true"
        className="locus-sos-strobe absolute inset-4 sm:inset-8 pointer-events-none"
        style={{
          border: '2px solid #EF4444',
          borderRadius: '20px',
          boxShadow: '0 0 60px rgba(239,68,68,0.45), inset 0 0 60px rgba(239,68,68,0.08)',
        }}
      />

      {/* Center content */}
      <div className="relative z-10 flex flex-col items-center text-center px-6">
        <h1
          id={titleId}
          className="font-dot font-bold text-white leading-none"
          style={{ fontSize: 'clamp(52px, 12vw, 72px)', letterSpacing: '0.15em' }}
        >
          SOS
        </h1>

        <div className="mt-6 font-mono text-white" style={{ fontSize: '20px', lineHeight: 1.5 }}>
          <div>{displayName}</div>
          <div>{hasLocation ? `${lat.toFixed(4)}, ${lng.toFixed(4)}` : 'COORDINATES UNAVAILABLE'}</div>
        </div>

        <p
          className="font-mono uppercase tracking-widest mt-4"
          style={{ fontSize: '14px', color: '#F0997B' }}
        >
          {statusLine}
        </p>

        <button
          ref={acknowledgeRef}
          onClick={handleAcknowledge}
          className="mt-8 bg-white text-black font-mono font-bold uppercase tracking-widest focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-white"
          style={{ fontSize: '16px', padding: '16px 40px', borderRadius: '20px' }}
        >
          Acknowledge
        </button>

        {pendingCount > 0 && (
          <p
            className="font-mono uppercase tracking-widest mt-4"
            style={{ fontSize: '12px', color: '#F0997B' }}
          >
            +{pendingCount} more waiting
          </p>
        )}
      </div>
    </div>
  );
};

export default SosOverlay;
