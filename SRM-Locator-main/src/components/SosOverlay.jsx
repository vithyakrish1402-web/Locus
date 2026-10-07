import React, { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, MapPin, MapPinOff, Navigation2 } from 'lucide-react';
import { useAlertAudio } from '../hooks/useAlertAudio';
import { LAYER } from '../utils/layers';
import { locateTarget } from '../utils/direction';
import { directionLabel, distanceLabel } from '../copy/place';
import { SOS_RECEIVED } from '../copy/emergency';
import Button from './ui/Button';

// Full-viewport takeover for an incoming Emergency alert (redesign Emergency batch, E4).
// Deliberately NOT a toast/modal: no click-outside dismiss, no Escape dismiss, no
// auto-timeout. Acknowledge is the only way out, on purpose — a distress beacon that can be
// missed by glancing away, or dismissed by an accidental tap, defeats the point. (Android's
// Back button is held off separately, in useBackButtonGuard.)
//
// LAYER.emergency (utils/layers.js): the top of the app's stacking order, over AR Scan,
// the notices and UpdateModal. A distress beacon outranks everything else on
// screen, including a mandatory update gate. Rendered as a `fixed` sibling at the
// top level of App.jsx's return, not nested inside the map component tree, so it
// isn't trapped inside a Leaflet/Google Maps stacking context — those libraries
// only establish stacking contexts within their own subtree.
//
// The look: a red band (the emergency colour, white text) with who needs help, how long ago,
// and where their phone's last known location is from here; then the footer line and
// Acknowledge. No glow and no flashing: the alarm and the vibration carry the urgency.

const AGE_TICK_MS = 15000;

const SosOverlay = ({
  senderName,
  lat,
  lng,
  // How old the alert was when the server sent it (the server's own clock), and when it
  // reached this phone (this phone's clock). Its age counts on from there.
  ageMs = 0,
  receivedAt = null,
  pendingCount = 0,
  // "1 of 2" when alerts are queued (useIncomingSos).
  position = 1,
  total = 1,
  // This phone's position and heading, to say where the sender is from here.
  me = null,
  heading = null,
  headingLive = false,
  onAcknowledge,
}) => {
  const { start, stop } = useAlertAudio();
  const overlayRef = useRef(null);
  const acknowledgeRef = useRef(null);
  const titleId = useId();
  const descriptionId = useId();
  const [now, setNow] = useState(() => Date.now());

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

  // The age goes on counting while the alert is up.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), AGE_TICK_MS);
    return () => clearInterval(id);
  }, []);

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
  const elapsed = (ageMs || 0) + (Number.isFinite(receivedAt) ? Math.max(0, now - receivedAt) : 0);
  const minutes = Math.floor(elapsed / 60000);
  const name = senderName || SOS_RECEIVED.someone;
  const ageText = SOS_RECEIVED.age(minutes);

  // Where their phone's last known location is from here (13a): distance and a clock
  // direction while the compass is live, compass words otherwise; coordinates if this phone
  // has no position of its own.
  const where = hasLocation ? locateTarget(me, { lat, lng }, { heading, headingLive }) : null;
  let whereText = null;
  if (hasLocation && where?.here) whereText = SOS_RECEIVED.closeBy;
  else if (hasLocation && where) whereText = [SOS_RECEIVED.about(distanceLabel(where.shownDistance)), directionLabel(where)].filter(Boolean).join(' · ');
  else if (hasLocation) whereText = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  const locationLine = hasLocation ? `${SOS_RECEIVED.located} · ${whereText}` : SOS_RECEIVED.noLocation;
  const arrowTurn = where?.clock && Number.isFinite(heading) ? where.bearing - heading : null;

  const counter = total > 1 ? SOS_RECEIVED.ofTotal(position, total) : null;

  // What a screen reader announces on open (role="alertdialog" is announced assertively).
  const spokenDescription = [
    `${SOS_RECEIVED.needsHelp(name)}.`,
    `${ageText}.`,
    `${locationLine}.`,
    counter ? `Alert ${counter}.` : null,
    `Activate ${SOS_RECEIVED.acknowledge} to dismiss.`,
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
      data-testid="sos-overlay"
      className="fixed inset-0 flex flex-col bg-bg text-text font-ui pointer-events-auto overflow-y-auto"
      style={{ zIndex: LAYER.emergency }}
    >
      <p id={descriptionId} className="sr-only">{spokenDescription}</p>

      {/* The red band: who, how long ago, where. White on the emergency colour in both themes. */}
      <div
        data-testid="sos-band"
        className="bg-emergency text-white px-5 pb-6"
        style={{ paddingTop: 'calc(2rem + env(safe-area-inset-top))' }}
      >
        <div className="flex items-center gap-3">
          <span className="flex items-center justify-center w-12 h-12 rounded-full bg-white/20" aria-hidden="true">
            <AlertTriangle size={24} />
          </span>
          <span className="flex-1 text-label">{SOS_RECEIVED.kicker}</span>
          {counter && (
            <span data-testid="sos-counter" className="rounded-full bg-white/20 px-3 py-1 text-label tabular-nums">{counter}</span>
          )}
        </div>
        <h1 id={titleId} className="mt-6 text-display break-words">{SOS_RECEIVED.needsHelp(name)}</h1>
        <p data-testid="sos-age" className="mt-2 text-body text-white/90">{ageText}</p>

        <div data-testid="sos-location" data-has-location={hasLocation || undefined} className="mt-5 flex items-center gap-4 rounded-card bg-black/15 p-4">
          <span className="flex items-center justify-center w-14 h-14 shrink-0 rounded-full bg-white/20" aria-hidden="true">
            {!hasLocation
              ? <MapPinOff size={26} />
              : arrowTurn !== null
                ? <Navigation2 size={26} style={{ transform: `rotate(${arrowTurn}deg)` }} />
                : <MapPin size={26} />}
          </span>
          <p className="text-body font-semibold">{locationLine}</p>
        </div>
      </div>

      <div className="flex-1 flex flex-col px-5 pt-5" style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}>
        <p data-testid="sos-footer" className="text-secondary text-text-secondary">{SOS_RECEIVED.footer}</p>
        <div className="flex-1" />
        <Button ref={acknowledgeRef} variant="danger" size="large" block onClick={handleAcknowledge} className="mt-6">
          {SOS_RECEIVED.acknowledge}
        </Button>
        {pendingCount > 0 && <span className="sr-only">{`${pendingCount} more waiting`}</span>}
      </div>
    </div>
  );
};

export default SosOverlay;
