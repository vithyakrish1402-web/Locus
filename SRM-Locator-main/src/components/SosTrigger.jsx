import React, { useEffect, useRef, useState } from 'react';

// Fixed 80x80 design grid for the progress rings (see LiveLocationMarker.jsx
// for the same pattern) so radii/strokes stay proportional regardless of the
// rendered button size.
const GRID = 80;
const CENTER = GRID / 2;

const HOLD_RADIUS = 34;
const HOLD_CIRCUMFERENCE = 2 * Math.PI * HOLD_RADIUS;

const COUNTDOWN_RADIUS = 27;
const COUNTDOWN_CIRCUMFERENCE = 2 * Math.PI * COUNTDOWN_RADIUS;

const FIRED_DISPLAY_MS = 2000;

const LABELS = {
  idle: 'SOS',
  arming: 'SOS',
  armed: 'HOLD TO CONFIRM',
  confirming: 'HOLD TO CONFIRM',
  fired: 'SOS SENT',
};

const ARIA_LABELS = {
  idle: 'Press and hold to arm SOS beacon',
  arming: 'Keep holding to arm SOS beacon',
  armed: 'Armed. Press and hold again to confirm SOS beacon',
  confirming: 'Keep holding to confirm SOS beacon',
  fired: 'SOS beacon sent',
};

const PHASE_STYLES = {
  idle: 'border-red-400 shadow-[0_0_20px_rgba(220,38,38,0.6)]',
  arming: 'border-red-400 shadow-[0_0_20px_rgba(220,38,38,0.6)]',
  armed: 'border-yellow-300 shadow-[0_0_28px_rgba(220,38,38,0.75)]',
  confirming: 'border-yellow-300 shadow-[0_0_28px_rgba(220,38,38,0.75)]',
  fired: 'border-white shadow-[0_0_30px_rgba(220,38,38,1)]',
};

// The hold-progress ring is reused verbatim for both the ARMING and
// CONFIRMING holds: it always starts parked at full offset (invisible) and
// fills to 0 (fully drawn) over holdDurationMs. Every other phase parks it
// back at full offset with a 0ms transition, so a fresh hold always animates
// from empty rather than wherever a previous, possibly-interrupted hold left it.
const holdRingFor = (phase, holdDurationMs) => {
  if (phase === 'arming' || phase === 'confirming') {
    return { offset: 0, duration: holdDurationMs };
  }
  if (phase === 'fired') {
    // Stay fully drawn through the confirmation display instead of snapping
    // empty the instant CONFIRMING completes.
    return { offset: 0, duration: 0 };
  }
  return { offset: HOLD_CIRCUMFERENCE, duration: 0 };
};

// The countdown ring is only ever visible during ARMED. It's parked "full"
// (offset 0) while hidden so that the moment ARMED starts, it's already at
// the right value to animate from — no double-render reset trick needed —
// and drains to empty over armWindowMs while visible.
const countdownRingFor = (phase, armWindowMs) => {
  if (phase === 'armed') {
    return { offset: COUNTDOWN_CIRCUMFERENCE, duration: armWindowMs, visible: true };
  }
  return { offset: 0, duration: 0, visible: false };
};

/**
 * Dedicated SOS trigger: press-and-hold to arm, then a second press-and-hold
 * within a short window to confirm. Entirely client-side state until the
 * final confirm — only the FIRE transition touches the network.
 *
 * Deliberately separate from the rally-point targeting FAB elsewhere in the
 * HUD; the two controls must never share a hitbox or state.
 */
const SosTrigger = ({
  holdDurationMs = 1200,
  armWindowMs = 4000,
  socket = null,
  getLocation = null,
  roomCode = null,
  senderName = null,
  className = '',
}) => {
  const [phase, setPhase] = useState('idle');

  const holdTimeoutRef = useRef(null);
  const armWindowTimeoutRef = useRef(null);
  const firedTimeoutRef = useRef(null);

  const clearAllTimers = () => {
    clearTimeout(holdTimeoutRef.current);
    clearTimeout(armWindowTimeoutRef.current);
    clearTimeout(firedTimeoutRef.current);
    holdTimeoutRef.current = null;
    armWindowTimeoutRef.current = null;
    firedTimeoutRef.current = null;
  };

  useEffect(() => clearAllTimers, []);

  const emitSosBroadcast = () => {
    const send = (coords) => {
      if (!socket || typeof socket.emit !== 'function') return;
      socket.emit('sos-broadcast', {
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
        roomCode: roomCode ?? null,
        senderName: senderName ?? null,
        timestamp: Date.now(),
      });
    };

    const cached = typeof getLocation === 'function' ? getLocation() : null;
    if (cached && Number.isFinite(cached.lat) && Number.isFinite(cached.lng)) {
      send(cached);
      return;
    }

    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => send({ lat: position.coords.latitude, lng: position.coords.longitude }),
        () => send(null),
        { enableHighAccuracy: true, timeout: 3000, maximumAge: 5000 }
      );
    } else {
      send(null);
    }
  };

  const fire = () => {
    clearAllTimers();
    setPhase('fired');
    emitSosBroadcast();
    firedTimeoutRef.current = setTimeout(() => setPhase('idle'), FIRED_DISPLAY_MS);
  };

  const enterArmed = () => {
    clearAllTimers();
    setPhase('armed');
    armWindowTimeoutRef.current = setTimeout(() => setPhase('idle'), armWindowMs);
  };

  const startHold = (nextPhase) => {
    clearAllTimers();
    setPhase(nextPhase);
    holdTimeoutRef.current = setTimeout(() => {
      if (nextPhase === 'arming') enterArmed();
      else fire();
    }, holdDurationMs);
  };

  const handlePointerDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    if (phase === 'idle') startHold('arming');
    else if (phase === 'armed') startHold('confirming');
  };

  const cancelHold = () => {
    if (phase === 'arming' || phase === 'confirming') {
      clearAllTimers();
      setPhase('idle');
    }
  };

  const holdRing = holdRingFor(phase, holdDurationMs);
  const countdownRing = countdownRingFor(phase, armWindowMs);

  return (
    <button
      type="button"
      onPointerDown={handlePointerDown}
      onPointerUp={cancelHold}
      onPointerLeave={cancelHold}
      onPointerCancel={cancelHold}
      onContextMenu={(e) => e.preventDefault()}
      aria-label={ARIA_LABELS[phase]}
      // Placement has to dodge two different chrome layouts, and an SOS control must
      // never end up underneath either of them:
      //   mobile  - the bottom HUD (GRID/SCAN/SQUAD) is fixed bottom-0 at z-[1100]
      //             and ~70px tall, so bottom-4 put this button straight behind it.
      //             bottom-20 clears it and mirrors the Rally Point FAB on the right.
      //   desktop - the squad sidebar is fixed left-6 w-80 (ends ~344px in), so
      //             left-4 overlapped it; left-[23rem] sits just clear of its edge.
      // z-[1150] keeps it above both regardless, so it can never be buried again.
      className={`fixed bottom-20 left-4 md:bottom-6 md:left-[23rem] z-[1150] w-20 h-20 rounded-full select-none touch-none pointer-events-auto flex items-center justify-center border-2 bg-red-600 text-white active:scale-95 transition-[border-color,box-shadow] duration-200 ${PHASE_STYLES[phase]} ${className}`}
      style={{
        marginBottom: 'env(safe-area-inset-bottom)',
        animation: phase === 'armed' ? 'locus-sos-pulse 0.6s ease-in-out infinite' : 'none',
      }}
    >
      <svg className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none" viewBox={`0 0 ${GRID} ${GRID}`}>
        <circle
          cx={CENTER}
          cy={CENTER}
          r={COUNTDOWN_RADIUS}
          fill="none"
          stroke="#fca5a5"
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={COUNTDOWN_CIRCUMFERENCE}
          strokeDashoffset={countdownRing.offset}
          style={{
            transition: `stroke-dashoffset ${countdownRing.duration}ms linear`,
            opacity: countdownRing.visible ? 1 : 0,
          }}
        />
        <circle
          cx={CENTER}
          cy={CENTER}
          r={HOLD_RADIUS}
          fill="none"
          stroke="#ffffff"
          strokeWidth={4}
          strokeLinecap="round"
          strokeDasharray={HOLD_CIRCUMFERENCE}
          strokeDashoffset={holdRing.offset}
          style={{ transition: `stroke-dashoffset ${holdRing.duration}ms linear` }}
        />
      </svg>
      <span className="relative z-10 font-dot text-[10px] uppercase tracking-widest leading-tight text-center px-1">
        {LABELS[phase]}
      </span>
    </button>
  );
};

export default SosTrigger;
