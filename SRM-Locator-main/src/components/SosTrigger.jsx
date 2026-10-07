import React, { useEffect, useRef, useState } from 'react';
import { Check, MapPin } from 'lucide-react';
import { SOS_BUTTON, SOS_HOLD, SOS_SPOKEN } from '../copy/emergency';
import { LAYER } from '../utils/layers';

// The Emergency button (redesign Emergency batch, E2): a red circle with a casing, the
// design's rings drawn just outside it, and a card above it that says what is happening
// while it is held. Its behaviour is exactly as before: the same 80 px hit area, the same two
// holds (holdDurationMs to arm, then a second hold started within armWindowMs to send), and
// letting go early always goes back to the start.

// The rings' own grid: 96 px, 8 px wider than the button on every side, so they sit just
// outside it. They take no touches; the button alone is the hit area.
const GRID = 96;
const CENTER = GRID / 2;

const HOLD_RADIUS = 44;
const HOLD_CIRCUMFERENCE = 2 * Math.PI * HOLD_RADIUS;

const COUNTDOWN_RADIUS = 44;
const COUNTDOWN_CIRCUMFERENCE = 2 * Math.PI * COUNTDOWN_RADIUS;

const FIRED_DISPLAY_MS = 2000;
// "Hold longer" after letting go early: a reminder only. The button is back at rest, and a new
// press starts a hold exactly as it would without it.
const EARLY_DISPLAY_MS = 1500;

// While an alert is held for want of a connection (utils/sosOutbox.js), the button says so
// instead of SOS or Sent: never "sent" while it is only waiting.
const HELD_ARIA_LABEL = 'Emergency alert waiting for connection. It will send when you are back online. Press and hold to arm SOS beacon again';

const ARIA_LABELS = {
  idle: 'Press and hold to arm SOS beacon',
  arming: 'Keep holding to arm SOS beacon',
  armed: 'Armed. Press and hold again to confirm SOS beacon',
  confirming: 'Keep holding to confirm SOS beacon',
  fired: 'SOS beacon sent',
};

// The button's look in each phase. Red with a casing at rest and while held; white with a red
// edge once armed, so armed never relies on colour alone (the card says so too). No glow.
const PHASE_LOOK = {
  idle: 'bg-danger text-danger-on border-surface',
  arming: 'bg-danger-pressed text-danger-on border-surface',
  armed: 'bg-surface text-danger border-danger locus-sos-armed',
  confirming: 'bg-danger-pressed text-danger-on border-surface',
  fired: 'bg-danger text-danger-on border-surface',
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

const HOLDING = ['arming', 'armed', 'confirming'];

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
  // The way out (utils/sosOutbox.js): sends at once when the group can be reached, holds the
  // alert otherwise. Without one, the button emits on `socket` directly, as it always did.
  outbox = null,
  // An alert is being held: the button reads "Waiting for connection" until it goes.
  held = false,
  // The sharing mode ('ACTIVE' | 'FROZEN' | 'GHOST'). Paused or Hidden, the card says the
  // alert carries the location anyway.
  sharingMode = 'ACTIVE',
}) => {
  const [phase, setPhase] = useState('idle');
  const [early, setEarly] = useState(false);

  const holdTimeoutRef = useRef(null);
  const armWindowTimeoutRef = useRef(null);
  const firedTimeoutRef = useRef(null);
  const earlyTimeoutRef = useRef(null);

  const clearAllTimers = () => {
    clearTimeout(holdTimeoutRef.current);
    clearTimeout(armWindowTimeoutRef.current);
    clearTimeout(firedTimeoutRef.current);
    holdTimeoutRef.current = null;
    armWindowTimeoutRef.current = null;
    firedTimeoutRef.current = null;
  };

  const clearEarly = () => {
    clearTimeout(earlyTimeoutRef.current);
    earlyTimeoutRef.current = null;
    setEarly(false);
  };

  useEffect(() => () => {
    clearAllTimers();
    clearTimeout(earlyTimeoutRef.current);
  }, []);

  // While the button is on screen, every screen keeps its bottom content clear of it
  // (--emergency-clearance in index.css keys off this attribute).
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.emergencyButton = 'on';
    return () => { delete root.dataset.emergencyButton; };
  }, []);

  const emitSosBroadcast = () => {
    const send = (coords) => {
      const payload = {
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
        roomCode: roomCode ?? null,
        senderName: senderName ?? null,
        timestamp: Date.now(),
      };
      if (outbox) {
        outbox.send(payload);
        return;
      }
      if (!socket || typeof socket.emit !== 'function') return;
      socket.emit('sos-broadcast', payload);
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
    // "Sent" only when it is going out now. Held for a connection, the button goes straight
    // back to resting, where it reads "Waiting for connection".
    const goingOutNow = !outbox || (outbox.canSend() && !outbox.isHolding());
    if (goingOutNow) {
      setPhase('fired');
      firedTimeoutRef.current = setTimeout(() => setPhase('idle'), FIRED_DISPLAY_MS);
    } else {
      setPhase('idle');
    }
    emitSosBroadcast();
  };

  const enterArmed = () => {
    clearAllTimers();
    setPhase('armed');
    armWindowTimeoutRef.current = setTimeout(() => setPhase('idle'), armWindowMs);
  };

  const startHold = (nextPhase) => {
    clearAllTimers();
    clearEarly();
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
      // A reminder that it needs the full hold. Purely words: the button is at rest.
      clearTimeout(earlyTimeoutRef.current);
      setEarly(true);
      earlyTimeoutRef.current = setTimeout(() => setEarly(false), EARLY_DISPLAY_MS);
    }
  };

  const holdRing = holdRingFor(phase, holdDurationMs);
  const countdownRing = countdownRingFor(phase, armWindowMs);

  // What the button shows at rest: waiting for a connection, a reminder to hold longer, or SOS.
  const resting = phase === 'idle' || phase === 'fired';
  const showHeld = held && resting;
  const showEarly = !showHeld && early && phase === 'idle';
  const view = showHeld ? 'held' : showEarly ? 'early' : phase;
  const spoken = SOS_SPOKEN[view] ?? '';

  const holding = HOLDING.includes(phase);
  const card = holding ? SOS_HOLD[phase] : null;
  const locationNote = holding && phase !== 'arming' && (sharingMode === 'FROZEN' || sharingMode === 'GHOST');
  // One layer, over every screen but an incoming alert (LAYER.emergencyButton). The scrim and
  // the card share it, drawn before the button so the button stays on top.
  const layerStyle = { zIndex: LAYER.emergencyButton };

  let content;
  if (view === 'fired') content = <Check size={34} strokeWidth={3} aria-hidden="true" />;
  else if (view === 'held') content = <span className="text-[11px] font-semibold leading-tight px-2">{SOS_BUTTON.held}</span>;
  else if (view === 'early') content = <span className="text-[13px] font-semibold leading-tight px-2">{SOS_BUTTON.early}</span>;
  else content = <span className="text-[22px] font-bold tracking-wide leading-none">{SOS_BUTTON.sos}</span>;

  return (
    <>
      {/* While it is held: the screen dims and a card says what is happening. Neither takes a
          touch, so nothing about the holds changes. */}
      {holding && (
        <>
          <div
            data-testid="sos-scrim"
            aria-hidden="true"
            className={`fixed inset-0 bg-backdrop pointer-events-none`}
            style={layerStyle}
          />
          <div
            data-testid="sos-hold-card"
            data-phase={phase}
            aria-hidden="true"
            className={`fixed left-3 right-3 bottom-[calc(11rem+env(safe-area-inset-bottom))] md:left-[23rem] md:right-auto md:w-96 md:bottom-32 rounded-card bg-raised text-text font-ui shadow-[var(--shadow-2)] border border-border p-5 pointer-events-none`}
            style={layerStyle}
          >
            <p className="text-heading">{card.title}</p>
            <p className="mt-1 text-body text-text-secondary">{card.body}</p>
            {locationNote && (
              <p data-testid="sos-location-note" className="mt-4 flex items-start gap-3 rounded-input bg-danger-soft px-4 py-3 text-body text-text">
                <MapPin size={20} className="shrink-0 mt-0.5 text-danger" aria-hidden="true" />
                {SOS_HOLD.location}
              </p>
            )}
            <div className="mt-4 grid grid-cols-2 gap-3 text-secondary text-text-secondary">
              {SOS_HOLD.steps.map((step, i) => {
                const done = i === 0 || phase === 'confirming';
                return (
                  <div key={step} data-testid="sos-step" data-done={done || undefined}>
                    <div className={`h-1 rounded-full ${done ? 'bg-danger' : 'bg-border'}`} />
                    <p className={`mt-2 ${i === 1 ? 'text-right' : ''}`}>{step}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* What a screen reader hears as the button changes. */}
      <span data-testid="sos-spoken" role="status" aria-live="polite" className="sr-only">{spoken}</span>

      <button
        type="button"
        data-testid="sos-button"
        data-phase={phase}
        data-view={view}
        onPointerDown={handlePointerDown}
        onPointerUp={cancelHold}
        onPointerLeave={cancelHold}
        onPointerCancel={cancelHold}
        onContextMenu={(e) => e.preventDefault()}
        aria-label={showHeld ? HELD_ARIA_LABEL : ARIA_LABELS[phase]}
        // Placement has to dodge two different chrome layouts, and an SOS control must
        // never end up underneath either of them:
        //   mobile  - the bottom HUD (GRID/SCAN/SQUAD) is fixed bottom-0 at z-[1100]
        //             and ~70px tall, so bottom-4 put this button straight behind it.
        //             bottom-20 clears it and mirrors the Rally Point FAB on the right.
        //   desktop - the squad sidebar is fixed left-6 w-80 (ends ~344px in), so
        //             left-4 overlapped it; left-[23rem] sits just clear of its edge.
        // LAYER.emergencyButton keeps it above every screen but an incoming alert.
        className={`fixed bottom-20 left-4 md:bottom-6 md:left-[23rem] w-20 h-20 rounded-full select-none touch-none pointer-events-auto flex items-center justify-center text-center font-ui border-4 shadow-[var(--shadow-2)] active:scale-95 transition-colors duration-200 ${PHASE_LOOK[phase]} ${className}`}
        style={{
          marginBottom: 'env(safe-area-inset-bottom)',
          ...layerStyle,
        }}
      >
        <svg className="absolute -inset-2 w-24 h-24 -rotate-90 pointer-events-none overflow-visible" viewBox={`0 0 ${GRID} ${GRID}`} aria-hidden="true">
          {/* The track, while there is something to fill or drain. */}
          <circle
            data-testid="sos-ring-track"
            cx={CENTER}
            cy={CENTER}
            r={HOLD_RADIUS}
            fill="none"
            className="stroke-danger-soft"
            strokeWidth={4}
            style={{ opacity: holding || phase === 'fired' ? 1 : 0 }}
          />
          <circle
            data-testid="sos-ring-countdown"
            cx={CENTER}
            cy={CENTER}
            r={COUNTDOWN_RADIUS}
            fill="none"
            className="stroke-danger"
            strokeWidth={4}
            strokeLinecap="round"
            strokeDasharray={COUNTDOWN_CIRCUMFERENCE}
            strokeDashoffset={countdownRing.offset}
            style={{
              transition: `stroke-dashoffset ${countdownRing.duration}ms linear`,
              opacity: countdownRing.visible ? 1 : 0,
            }}
          />
          <circle
            data-testid="sos-ring-hold"
            cx={CENTER}
            cy={CENTER}
            r={HOLD_RADIUS}
            fill="none"
            className="stroke-danger"
            strokeWidth={4}
            strokeLinecap="round"
            strokeDasharray={HOLD_CIRCUMFERENCE}
            strokeDashoffset={holdRing.offset}
            style={{ transition: `stroke-dashoffset ${holdRing.duration}ms linear` }}
          />
        </svg>
        <span className="relative z-10 flex items-center justify-center">{content}</span>
      </button>
    </>
  );
};

export default SosTrigger;
