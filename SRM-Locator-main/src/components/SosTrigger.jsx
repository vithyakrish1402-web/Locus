import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, MapPin } from 'lucide-react';
import { SOS_BUTTON, SOS_HOLD, SOS_SPOKEN } from '../copy/emergency';
import { LAYER } from '../utils/layers';
import { haptic } from '../utils/haptics';

const FIRED_DISPLAY_MS = 2000;
const EARLY_DISPLAY_MS = 1500;

const HELD_ARIA_LABEL = 'Emergency alert waiting for connection. It will send when you are back online. Press and hold to arm SOS beacon again';

const ARIA_LABELS = {
  idle: 'Press and hold to arm SOS beacon',
  arming: 'Keep holding to arm SOS beacon',
  armed: 'Armed. Press and hold again to confirm SOS beacon',
  confirming: 'Keep holding to confirm SOS beacon',
  sending: 'Sending SOS beacon. Waiting for the server to confirm it',
  fired: 'SOS beacon sent',
};

const PHASE_LOOK = {
  idle: 'bg-danger/15 text-danger-pressed border-danger/30 hover:bg-danger/25', // pressed: 4.5:1 on the tint in Light
  arming: 'bg-danger text-white border-danger shadow-[0_0_15px_rgba(239,68,68,0.5)]',
  armed: 'bg-white text-danger border-white shadow-[0_0_20px_rgba(255,255,255,0.7)]',
  confirming: 'bg-danger-pressed text-white border-danger shadow-[0_0_20px_rgba(220,38,38,0.8)]',
  sending: 'bg-danger text-white border-danger',
  fired: 'bg-success text-white border-success shadow-[0_0_15px_rgba(34,197,94,0.5)]',
};

const HOLDING = ['arming', 'armed', 'confirming'];

/**
 * Dedicated SOS trigger: press-and-hold to arm, then a second press-and-hold
 * within a short window to confirm.
 * Enhanced with rectangular shape, progress fill, and integrated placement.
 */
const SosTrigger = ({
  holdDurationMs = 1200,
  armWindowMs = 4000,
  socket = null,
  getLocation = null,
  roomCode = null,
  senderName = null,
  className = '',
  outbox = null,
  held = false,
  sharingMode = 'ACTIVE',
  layout = 'tab', // 'tab' | 'floating'
}) => {
  const [phase, setPhase] = useState('idle');
  const [early, setEarly] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0); // 0 to 100%
  const [countdownProgress, setCountdownProgress] = useState(100); // 100 to 0%

  const holdTimeoutRef = useRef(null);
  const armWindowTimeoutRef = useRef(null);
  const firedTimeoutRef = useRef(null);
  const earlyTimeoutRef = useRef(null);
  const animFrameRef = useRef(null);
  const countdownIntervalRef = useRef(null);
  const pointerStartRef = useRef(null);
  const startTimeRef = useRef(null);

  const clearAllTimers = () => {
    clearTimeout(holdTimeoutRef.current);
    clearTimeout(armWindowTimeoutRef.current);
    clearTimeout(firedTimeoutRef.current);
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    holdTimeoutRef.current = null;
    armWindowTimeoutRef.current = null;
    firedTimeoutRef.current = null;
    animFrameRef.current = null;
    countdownIntervalRef.current = null;
    setHoldProgress(0);
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

  // The outbox says when the server has the alert ('sent'): only then "Sent", including for one
  // that waited offline and went later. Anything else (refused, held, not yet answered, dropped)
  // ends "Sending": the held prop shows "Waiting" while the outbox keeps trying.
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  useEffect(() => {
    if (!outbox) return undefined;
    const unsubscribe = outbox.subscribe(({ event }) => {
      const now = phaseRef.current;
      // Not over a new hold under way.
      if (event === 'sent' && (now === 'idle' || now === 'sending')) showSent();
      else if (event !== 'sent' && now === 'sending') {
        setPhase('idle');
        setHoldProgress(0);
      }
    });
    return () => { unsubscribe(); };
  }, [outbox]);

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

  // "Sent" for a while, then back to SOS.
  const showSent = () => {
    clearTimeout(firedTimeoutRef.current);
    setPhase('fired');
    firedTimeoutRef.current = setTimeout(() => {
      setPhase((p) => (p === 'fired' ? 'idle' : p));
      setHoldProgress(0);
    }, FIRED_DISPLAY_MS);
  };

  const fire = () => {
    clearAllTimers();
    haptic('confirm');
    const goingOutNow = !outbox || (outbox.canSend() && !outbox.isHolding());
    // Through the outbox, "Sending" until the server has answered (the effect below). It used to
    // say "Sent" right here, which a phone showed for an alert on a connection already dead.
    if (goingOutNow && outbox) setPhase('sending');
    else if (goingOutNow) showSent();
    else {
      setPhase('idle');
      setHoldProgress(0);
    }
    emitSosBroadcast();
  };

  const enterArmed = () => {
    clearAllTimers();
    setPhase('armed');
    haptic('snap');
    const startArmed = Date.now();
    setCountdownProgress(100);

    countdownIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - startArmed;
      const remaining = Math.max(0, 100 - (elapsed / armWindowMs) * 100);
      setCountdownProgress(remaining);
      if (remaining <= 0) {
        clearInterval(countdownIntervalRef.current);
      }
    }, 40);

    armWindowTimeoutRef.current = setTimeout(() => {
      clearInterval(countdownIntervalRef.current);
      setPhase('idle');
      setHoldProgress(0);
      setCountdownProgress(0);
    }, armWindowMs);
  };

  const animateHoldProgress = (duration) => {
    startTimeRef.current = Date.now();
    const tick = () => {
      const elapsed = Date.now() - startTimeRef.current;
      const pct = Math.min(100, (elapsed / duration) * 100);
      setHoldProgress(pct);
      if (pct < 100) {
        animFrameRef.current = requestAnimationFrame(tick);
      }
    };
    animFrameRef.current = requestAnimationFrame(tick);
  };

  const startHold = (nextPhase) => {
    clearAllTimers();
    clearEarly();
    setPhase(nextPhase);
    haptic('tick');
    animateHoldProgress(holdDurationMs);

    holdTimeoutRef.current = setTimeout(() => {
      if (nextPhase === 'arming') enterArmed();
      else fire();
    }, holdDurationMs);
  };

  const handlePointerDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    pointerStartRef.current = { x: e.clientX, y: e.clientY };
    e.preventDefault();
    if (phase === 'idle') startHold('arming');
    else if (phase === 'armed') startHold('confirming');
  };

  const cancelHold = () => {
    pointerStartRef.current = null;
    if (phase === 'arming' || phase === 'confirming') {
      clearAllTimers();
      setPhase('idle');
      clearTimeout(earlyTimeoutRef.current);
      setEarly(true);
      earlyTimeoutRef.current = setTimeout(() => setEarly(false), EARLY_DISPLAY_MS);
    }
  };

  const resting = phase === 'idle' || phase === 'sending' || phase === 'fired';
  const showHeld = held && resting;
  const showEarly = !showHeld && early && phase === 'idle';
  const view = showHeld ? 'held' : showEarly ? 'early' : phase;
  const spoken = SOS_SPOKEN[view] ?? '';

  const holding = HOLDING.includes(phase);
  const card = holding ? SOS_HOLD[phase] : null;
  const locationNote = holding && phase !== 'arming' && (sharingMode === 'FROZEN' || sharingMode === 'GHOST');

  const layerStyle = { zIndex: LAYER.emergencyButton };

  let labelText = SOS_BUTTON.sos;
  if (view === 'fired') labelText = SOS_BUTTON.sent;
  else if (view === 'sending') labelText = SOS_BUTTON.sending;
  else if (view === 'held') labelText = SOS_BUTTON.held;
  else if (view === 'early') labelText = SOS_BUTTON.early;
  else if (phase === 'armed') labelText = SOS_BUTTON.armed;
  else if (phase === 'arming' || phase === 'confirming') labelText = SOS_BUTTON.hold;

  return (
    <>
      {holding && (
        <>
          <div
            data-testid="sos-scrim"
            aria-hidden="true"
            className="fixed inset-0 bg-backdrop pointer-events-none"
            style={layerStyle}
          />
          <div
            data-testid="sos-hold-card"
            data-phase={phase}
            aria-hidden="true"
            className="fixed left-4 right-4 bottom-24 md:left-[23rem] md:right-auto md:w-96 md:bottom-28 rounded-2xl bg-raised text-text font-ui shadow-2xl border border-border p-5 pointer-events-none"
            style={layerStyle}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2.5 h-2.5 rounded-full bg-danger animate-ping" />
              <p className="text-heading font-bold text-danger">{card.title}</p>
            </div>
            <p className="text-body text-text-secondary">{card.body}</p>
            {locationNote && (
              <p data-testid="sos-location-note" className="mt-3 flex items-start gap-2.5 rounded-xl bg-danger-soft px-3.5 py-2.5 text-body text-text">
                <MapPin size={18} className="shrink-0 mt-0.5 text-danger" aria-hidden="true" />
                {SOS_HOLD.location}
              </p>
            )}
            <div className="mt-4 grid grid-cols-2 gap-3 text-secondary text-text-secondary">
              {SOS_HOLD.steps.map((step, i) => {
                const done = i === 0 || phase === 'confirming';
                return (
                  <div key={step} data-testid="sos-step" data-done={done || undefined}>
                    <div className={`h-1.5 rounded-full transition-all duration-300 ${done ? 'bg-danger' : 'bg-border'}`} />
                    <p className={`mt-1.5 text-xs font-medium ${i === 1 ? 'text-right' : ''}`}>{step}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

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
        className={`relative overflow-hidden select-none touch-none pointer-events-auto flex items-center justify-center font-ui font-bold rounded-xl border transition-all duration-200 active:scale-95 ${
          // One width in every state (the widest word fits), so the tabs beside it never shift.
          layout === 'tab'
            ? 'h-11 w-28 px-2 my-auto self-center'
            : 'h-12 min-w-36 px-6 rounded-2xl shadow-lg'
        } ${PHASE_LOOK[phase]} ${className}`}
        style={layerStyle}
      >
        {/* Fill progress indicator during arming / confirming */}
        {(phase === 'arming' || phase === 'confirming') && (
          <span
            className="absolute inset-y-0 left-0 bg-white/25 pointer-events-none transition-all duration-75"
            style={{ width: `${holdProgress}%` }}
          />
        )}

        {/* Countdown drain indicator during armed */}
        {phase === 'armed' && (
          <span
            className="absolute bottom-0 inset-x-0 h-1 bg-danger pointer-events-none transition-all"
            style={{ width: `${countdownProgress}%` }}
          />
        )}

        <div className="relative z-10 flex items-center justify-center gap-1.5 leading-none">
          {view === 'fired' ? (
            <>
              <Check size={18} strokeWidth={3} className="text-white" aria-hidden="true" />
              <span className="text-xs font-bold tracking-wider uppercase">SENT</span>
            </>
          ) : (
            <>
              {/* The button's own text colour (PHASE_LOOK): white on the red of a hold, red on
                  the white of armed. It was always red, so it vanished on the red. */}
              <AlertTriangle
                size={16}
                className={phase === 'armed' ? 'animate-bounce' : undefined}
                data-testid="sos-icon"
                aria-hidden="true"
              />
              {/* "Hold longer" may take two lines; every other word stays on one. */}
              <span className={`text-xs font-black tracking-widest uppercase ${view === 'early' ? 'text-center leading-tight' : 'whitespace-nowrap'}`}>{labelText}</span>
            </>
          )}
        </div>
      </button>
    </>
  );
};

export default SosTrigger;

