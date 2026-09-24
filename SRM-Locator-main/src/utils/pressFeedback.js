// "Sonar ping": wherever a control is pressed, a red ring leaves the exact point of contact,
// like a radar return, and a light haptic tick lands on the same frame. One listener for
// the whole app instead of a wrapper around each of its many buttons.
//
// The ring lives in a fixed overlay at the pointer's coordinates, never inside the control,
// so it can't shift a layout, be clipped by `overflow: hidden`, or depend on the control
// being positioned. Styling and the reduced-motion variant are in index.css (.locus-ping).

import { haptic } from './haptics.js';

// What counts as pressable. Anything can opt out with data-no-ping (e.g. a map, where every
// pan would otherwise ping).
const PRESSABLE = 'button:not(:disabled), [role="button"], a[href], summary, label[for], [data-ping]';
const MAX_LIVE_PINGS = 6; // a frantic multi-tap mustn't pile up DOM nodes
const PING_LIFETIME_MS = 800; // fallback removal if animationend never fires (hidden tab)

/** The control a press on `target` belongs to, or null when it isn't one. */
export function pressableFor(target) {
  const control = target instanceof Element ? target.closest(PRESSABLE) : null;
  if (!control || control.closest('[data-no-ping]')) return null;
  return control;
}

/**
 * Starts listening. Returns a function that stops listening and clears any live rings.
 * @param {Document} [doc]
 */
export function installPressFeedback(doc = document) {
  const live = new Set();

  const remove = (ring) => {
    if (!live.delete(ring)) return;
    ring.remove();
  };

  const onPointerDown = (event) => {
    if (event.button !== undefined && event.button !== 0) return; // primary press only
    if (!pressableFor(event.target)) return;

    if (live.size >= MAX_LIVE_PINGS) remove(live.values().next().value);
    const ring = doc.createElement('span');
    ring.className = 'locus-ping';
    ring.setAttribute('aria-hidden', 'true');
    ring.style.left = `${event.clientX}px`;
    ring.style.top = `${event.clientY}px`;
    ring.addEventListener('animationend', (e) => { if (e.target === ring) remove(ring); });
    doc.body.appendChild(ring);
    live.add(ring);
    setTimeout(() => remove(ring), PING_LIFETIME_MS);

    // Felt only on touch, where the finger hides the visual; a mouse click needs no buzz.
    if (event.pointerType === 'touch' || event.pointerType === 'pen') haptic('tick');
  };

  // Capture phase: a control that stops propagation still gets its ping.
  doc.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true });
  return () => {
    doc.removeEventListener('pointerdown', onPointerDown, { capture: true });
    [...live].forEach(remove);
  };
}
