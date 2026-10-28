import { startTransition, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { animate, useMotionValue, useReducedMotion, useTransform } from 'framer-motion';
import { EASE, REDUCED_MOTION_S } from '../utils/motion';

// How the Buildings and Group panel moves on a phone: it rises from behind the tab bar, follows
// the finger while dragged by its handle or header (or pulled down from the top of its list), and
// settles open or closed. Only `transform` (translateY) and opacity change while it moves, so the
// map behind it is never laid out again. Every settle is a spring that starts from wherever the
// panel is and keeps the finger's speed, so a touch mid-movement stops it where it is, and a flick
// carries on. With reduced motion it fades instead of sliding.

/** Opening, closing: how long the spring takes to look settled (framer's visualDuration). */
export const PANEL_OPEN_DURATION_MS = 320;
export const PANEL_CLOSE_DURATION_MS = 260;
/** Let go faster than this (px per ms) and the panel goes the way it was thrown. */
export const PANEL_SNAP_VELOCITY_THRESHOLD = 0.5;
/** Dragged further than this share of its height, it settles in the direction of travel. */
export const PANEL_SNAP_DISTANCE_RATIO = 0.35;
/** Never taller than this share of the screen (the CSS height in App.jsx says the same). */
export const PANEL_MAX_HEIGHT_RATIO = 0.85;
/**
 * The panel's height on a phone, standing on the tab bar: PANEL_MAX_HEIGHT_RATIO of the screen,
 * or less on a short screen, so its top always stays 8 px under the status bar.
 */
export const PANEL_HEIGHT = `min(${PANEL_MAX_HEIGHT_RATIO * 100}dvh, calc(100dvh - var(--tab-bar-height) - var(--top-cover-height) - 0.5rem))`;
/** How dark the map gets behind the open panel: this share of the theme's backdrop colour. */
export const PANEL_SCRIM_STRENGTH = 0.6;

// A finger has to move this far before a press on the header becomes a drag, so taps on its
// buttons (close, copy the code, the theme switch) stay taps.
const DRAG_SLOP_PX = 6;
// The let-go speed is read over the finger's last 80 ms; a finger that stopped for longer than
// 50 ms before lifting threw nothing.
const VELOCITY_WINDOW_MS = 80;
const VELOCITY_STALE_MS = 50;

/**
 * Where a let-go panel settles.
 * @param {{ y: number, grabY: number, velocity: number, height: number }} release
 *   y: px slid down from open now; grabY: where it was when the finger took it;
 *   velocity: px/ms, down is positive; height: the panel's height
 * @returns {'open'|'closed'}
 */
export function settlePanel({ y, grabY, velocity, height }) {
  if (!(height > 0)) return 'open';
  if (Math.abs(velocity) > PANEL_SNAP_VELOCITY_THRESHOLD) return velocity > 0 ? 'closed' : 'open';
  const travel = y - grabY;
  if (Math.abs(travel) > PANEL_SNAP_DISTANCE_RATIO * height) return travel > 0 ? 'closed' : 'open';
  return y > height / 2 ? 'closed' : 'open';
}

/** px/ms from the last few {t, y} samples; 0 if the finger had stopped. */
function releaseVelocity(samples, now) {
  const last = samples[samples.length - 1];
  if (!last || now - last.t > VELOCITY_STALE_MS) return 0;
  const first = samples.find((s) => last.t - s.t <= VELOCITY_WINDOW_MS) ?? last;
  return last.t > first.t ? (last.y - first.y) / (last.t - first.t) : 0;
}

/**
 * @param {{ enabled: boolean, open: boolean, onOpen: () => void, onClose: () => void,
 *   panelRef: React.RefObject<HTMLElement>, listRef: React.RefObject<HTMLElement> }} input
 *   enabled: the phone layout (on desktop the panel is a fixed sidebar and nothing moves)
 * @returns {{ y: import('framer-motion').MotionValue<number>, opacity: import('framer-motion').MotionValue<number>,
 *   scrim: import('framer-motion').MotionValue<number>, chrome: import('framer-motion').MotionValue<number>,
 *   shown: boolean }}
 *   scrim: the dim's opacity; chrome: the opacity for the map's top bar under the panel;
 *   shown: drawn at all (open, or still on its way closed)
 */
export function usePanelMotion({ enabled, open, onOpen, onClose, panelRef, listRef }) {
  // The phone's own Reduce motion setting only, not the app's lightweight mode
  // (data-effects="reduced", any phone with 4 GB or 4 cores): that one trims decoration, and
  // the slide is the panel's feedback, not decoration, and costs only a transform.
  const reduceMotion = useReducedMotion();
  const y = useMotionValue(0);
  const opacity = useMotionValue(1);
  const heightRef = useRef(0);
  // How open it looks, 0 to 1: how far it has risen, times how far it has faded in. 0 until it
  // has first been measured, i.e. opened.
  const openness = useTransform(() => {
    const height = heightRef.current;
    const risen = height > 0 ? Math.min(1, Math.max(0, 1 - y.get() / height)) : 0;
    return risen * opacity.get();
  });
  const scrim = useTransform(() => openness.get() * PANEL_SCRIM_STRENGTH);
  // The map's own chrome that the open panel stands over (its top bar) fades out as the panel
  // rises and back in as it is pulled down: driven by the same value, so no render while moving.
  const chrome = useTransform(() => 1 - openness.get());
  // Still on its way closed: drawn until it gets there.
  const [closing, setClosing] = useState(false);
  const animation = useRef(null);
  // Where the panel is headed ('open' | 'closed'), and a start held back for one frame.
  const heading = useRef(open ? 'open' : 'closed');
  const startFrame = useRef(0);
  const wasShown = useRef(false);
  const wasEnabled = useRef(false);
  const callbacks = useRef({ onOpen, onClose });
  callbacks.current = { onOpen, onClose };

  const measure = () => {
    heightRef.current = panelRef.current?.offsetHeight || heightRef.current || window.innerHeight;
    return heightRef.current;
  };

  const stop = () => {
    cancelAnimationFrame(startFrame.current);
    animation.current?.stop();
    animation.current = null;
  };

  // Moves to `to` from wherever the panel is, at `velocity` px/ms (by default, at whatever speed
  // it is moving now).
  const settle = (to, velocity) => {
    const speed = velocity === undefined ? y.getVelocity() : velocity * 1000;
    stop();
    heading.current = to;
    const closingNow = to === 'closed';
    const done = () => {
      animation.current = null;
      if (closingNow) setClosing(false);
    };
    if (reduceMotion) {
      // A quick fade. A panel the finger moved still eases back up before it fades.
      animation.current = closingNow
        ? animate(opacity, 0, { duration: REDUCED_MOTION_S, ease: EASE.exit, onComplete: done })
        : animate(opacity, 1, { duration: REDUCED_MOTION_S, ease: EASE.standard, onComplete: done });
      if (!closingNow) animate(y, 0, { duration: REDUCED_MOTION_S, ease: EASE.standard });
      return;
    }
    animation.current = animate(y, closingNow ? measure() : 0, {
      type: 'spring',
      visualDuration: (closingNow ? PANEL_CLOSE_DURATION_MS : PANEL_OPEN_DURATION_MS) / 1000,
      bounce: 0,
      velocity: speed,
      onComplete: done,
    });
  };
  const settleRef = useRef(settle);
  settleRef.current = settle;

  // Open and close, whichever way they were asked for (the tab bar, Back, the close button, a
  // member's Navigate, a let-go). Before paint, so the first frame is already in place.
  useLayoutEffect(() => {
    if (!enabled) {
      stop();
      y.set(0);
      opacity.set(1);
      wasEnabled.current = false;
      return;
    }
    const target = open ? 'open' : 'closed';
    if (!wasEnabled.current) {
      // Turned to the phone layout (from landscape's sidebar, say): already where it belongs.
      wasEnabled.current = true;
      stop();
      heading.current = target;
      y.set(open ? 0 : measure());
      opacity.set(1);
      setClosing(false);
      return;
    }
    if (open) setClosing(false);
    else if (wasShown.current) setClosing(true);
    else return;
    // A let-go already started this move (see release below): let it run on.
    if (heading.current === target && animation.current) return;
    heading.current = target;
    cancelAnimationFrame(startFrame.current);
    if (open && !wasShown.current) {
      // Coming from not drawn: tucked behind the tab bar (or see-through) for the first frame.
      if (reduceMotion) { y.set(0); opacity.set(0); } else { y.set(measure()); opacity.set(1); }
    }
    // The move starts on the next frame: this one carries the render of the change (the whole
    // map screen) and, opening, the panel's first layout, and a spring started now would be most
    // of the way there before anything was painted. A move it reverses runs on until then, so
    // its speed carries over.
    startFrame.current = requestAnimationFrame(() => settleRef.current(target));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, enabled]);

  const shown = !enabled || open || closing;
  useEffect(() => { wasShown.current = enabled && shown; });

  // Turning the phone changes the panel's height: a closed or closing panel stays tucked away,
  // an open one stays open (y 0 is the same place at any height).
  useEffect(() => {
    const panel = panelRef.current;
    if (!enabled || !panel || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      const before = heightRef.current;
      const after = measure();
      if (before > 0 && after !== before && !open && !animation.current) y.set(after);
    });
    observer.observe(panel);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, open, panelRef]);

  // Dragging. Touch events, not pointer events: the list's own scrolling must be able to hand
  // over to the panel mid-gesture, which needs a cancelable touchmove.
  useEffect(() => {
    const panel = panelRef.current;
    if (!enabled || !panel) return undefined;
    let gesture = null;

    const onStart = (event) => {
      // Another finger landing is ignored: the drag under way carries on, and lifting settles it.
      // It used to drop the drag without settling, which left the panel stuck half-way.
      if (event.touches.length !== 1) return;
      const interrupted = Boolean(animation.current);
      // A touch mid-movement stops it where it is.
      stop();
      const list = listRef.current;
      const inList = Boolean(list && list.contains(event.target));
      const { clientX, clientY } = event.touches[0];
      gesture = { startX: clientX, startY: clientY, grabY: y.get(), mode: 'pending', inList, interrupted, samples: [] };
    };

    const onMove = (event) => {
      if (!gesture || event.touches.length !== 1) return;
      const { clientX, clientY } = event.touches[0];
      const dy = clientY - gesture.startY;
      if (gesture.mode === 'scroll') return;
      if (gesture.mode === 'pending') {
        // Mostly sideways is not a drag of the panel (a sideways swipe, a horizontal scroller).
        if (Math.abs(clientX - gesture.startX) > Math.max(DRAG_SLOP_PX, Math.abs(dy))) { gesture.mode = 'scroll'; return; }
        if (gesture.inList) {
          // Only a pull down with the list already at its top becomes the panel's; anything
          // else is the list's scroll.
          const atTop = (listRef.current?.scrollTop ?? 0) <= 0;
          if (!atTop || dy < 0 || !event.cancelable) { gesture.mode = 'scroll'; return; }
        }
        if (event.cancelable) event.preventDefault();
        if (Math.abs(dy) < DRAG_SLOP_PX) return;
        // Followed from here, so it doesn't jump by the slop.
        gesture.mode = 'drag';
        gesture.startY = clientY;
      }
      if (event.cancelable) event.preventDefault();
      const next = Math.max(0, gesture.grabY + clientY - gesture.startY);
      y.set(next);
      gesture.samples.push({ t: event.timeStamp, y: next });
      if (gesture.samples.length > 12) gesture.samples.shift();
    };

    const onEnd = (event) => {
      const g = gesture;
      gesture = null;
      if (!g) return;
      if (g.mode !== 'drag') {
        // Grabbed mid-movement and let go without dragging: carry on to the nearer end.
        if (g.interrupted) release(settlePanel({ y: y.get(), grabY: y.get(), velocity: 0, height: measure() }), 0);
        return;
      }
      const velocity = releaseVelocity(g.samples, event.timeStamp);
      release(settlePanel({ y: y.get(), grabY: g.grabY, velocity, height: measure() }), velocity);
    };

    // The move starts at once, carrying the finger's speed; the app's own change of tab follows
    // as a transition, so its render (the whole map screen) doesn't hold up the first frames.
    const release = (to, velocity) => {
      settleRef.current(to, velocity);
      if ((to === 'open') !== open) startTransition(() => (to === 'open' ? callbacks.current.onOpen() : callbacks.current.onClose()));
    };

    panel.addEventListener('touchstart', onStart, { passive: true });
    panel.addEventListener('touchmove', onMove, { passive: false });
    panel.addEventListener('touchend', onEnd);
    panel.addEventListener('touchcancel', onEnd);
    return () => {
      panel.removeEventListener('touchstart', onStart);
      panel.removeEventListener('touchmove', onMove);
      panel.removeEventListener('touchend', onEnd);
      panel.removeEventListener('touchcancel', onEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, open, panelRef, listRef]);

  useEffect(() => () => stop(), []);

  return { y, opacity, scrim, chrome, shown };
}
