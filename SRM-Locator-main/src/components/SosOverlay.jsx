import React, { useEffect } from 'react';
import { useAlertAudio } from '../hooks/useAlertAudio';

// Full-viewport takeover for an incoming squad-wide SOS. Deliberately NOT a
// toast/modal: no click-outside dismiss, no Escape dismiss, no auto-timeout.
// ACKNOWLEDGE is the only way out, on purpose — a distress beacon that can be
// missed by glancing away, or dismissed by an accidental tap, defeats the point.
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

const SosOverlay = ({ senderName, lat, lng, onAcknowledge }) => {
  const { start, stop } = useAlertAudio();

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

  const hasLocation = Number.isFinite(lat) && Number.isFinite(lng);

  const handleAcknowledge = () => {
    stop();
    onAcknowledge();
  };

  return (
    <div
      className="fixed inset-0 z-[10001] flex items-center justify-center pointer-events-auto"
      // #4A0A0A, opaque: a deep maroon that reads as "emergency" without being
      // mistaken for the tactical-red (#EF4444) UI chrome, and hides the map fully.
      style={{ background: '#4A0A0A' }}
    >
      {/* Hex grid layer: clipped to the rounded frame, static. Kept separate from
          the border below so the strobe (opacity) only touches the border and not
          the pattern or the text. */}
      <div
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
          className="font-dot font-bold text-white leading-none"
          style={{ fontSize: 'clamp(52px, 12vw, 72px)', letterSpacing: '0.15em' }}
        >
          SOS
        </h1>

        <div className="mt-6 font-mono text-white" style={{ fontSize: '20px', lineHeight: 1.5 }}>
          <div>{(senderName || 'UNKNOWN NODE').toUpperCase()}</div>
          <div>{hasLocation ? `${lat.toFixed(4)}, ${lng.toFixed(4)}` : 'COORDINATES UNAVAILABLE'}</div>
        </div>

        <p
          className="font-mono uppercase tracking-widest mt-4"
          style={{ fontSize: '14px', color: '#F0997B' }}
        >
          Transmitting // Unacknowledged
        </p>

        <button
          onClick={handleAcknowledge}
          className="mt-8 bg-white text-black font-mono font-bold uppercase tracking-widest"
          style={{ fontSize: '16px', padding: '16px 40px', borderRadius: '20px' }}
        >
          Acknowledge
        </button>
      </div>
    </div>
  );
};

export default SosOverlay;
