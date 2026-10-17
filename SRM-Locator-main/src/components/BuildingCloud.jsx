import React, { useEffect, useReducer, useRef, useState } from 'react';
import { AnimatePresence, motion, useDragControls, useMotionValue, useReducedMotion, useTransform } from 'framer-motion';
import { Building2 } from 'lucide-react';
import PlaceCard from './PlaceCard';
import { getBuildingAsset } from '../data/srmBuildingAssets';
import { CLOUD_CLOSED, cloudReducer } from '../utils/cloudState';
import { pushBackHandler } from '../utils/backHandlers';
import { getMapView } from '../utils/mapFocus';
import { offsetFromCenter } from '../utils/mapProject';

// ---- Tuning (all motion in one place) ----
export const CLOUD_ENTER_MS = 520;          // peek cloud blooming out of the building point
export const CLOUD_BLOOM_MS = 620;          // cloud -> full sheet
export const CLOUD_STAGGER_MS = 50;         // gap between the sheet's content groups
export const CLOUD_FLOAT_PX = 3;            // idle bob distance
export const CLOUD_FLOAT_PERIOD_MS = 4000;  // idle bob loop
export const CLOUD_PEEK_WIDTH_PX = 220;     // assumption, tune on device
export const HINT_SHOW_ONCE_KEY = 'locus.cloudHintSeen';

const CLOUD_HEIGHT_PX = Math.round(CLOUD_PEEK_WIDTH_PX * 0.64);
const TAIL_PX = 14;
const POINT_GAP_PX = 22;      // clear of the building's own dot
const TOP_CLEARANCE_FALLBACK_PX = 104; // until the top bar and its stack can be measured
const TOP_GAP_PX = 10;                 // air between the top chrome and the cloud or sheet
const HINT_VISIBLE_MS = 3500;
const SWIPE_UP_PX = 28;
const SWIPE_DOWN_PX = 90;
const EASE_ENTER = [0.16, 1, 0.3, 1];

const readHintSeen = () => {
  try { return window.localStorage.getItem(HINT_SHOW_ONCE_KEY) === '1'; } catch { return false; }
};
const writeHintSeen = () => {
  try { window.localStorage.setItem(HINT_SHOW_ONCE_KEY, '1'); } catch { /* storage can be blocked */ }
};

const PUFFS = [
  { x: -96, y: -18, s: 14 }, { x: 98, y: -6, s: 11 }, { x: -70, y: 40, s: 9 }, { x: 74, y: 44, s: 12 }, { x: 4, y: -78, s: 10 },
];

// How far down the map screen's top chrome reaches: the top bar, and the stack under it (the
// sharing chip, banners, the route card). The cloud and the sheet stay below this line, so the
// chip never lies over them. Measured, because the stack grows and shrinks.
function useTopLimit(active) {
  const [limit, setLimit] = useState(TOP_CLEARANCE_FALLBACK_PX);
  useEffect(() => {
    if (!active) return undefined;
    const measure = () => {
      let bottom = 0;
      ['top-bar', 'map-top-stack'].forEach((id) => {
        const el = document.querySelector(`[data-testid="${id}"]`);
        if (el) bottom = Math.max(bottom, el.getBoundingClientRect().bottom);
      });
      if (bottom > 0) setLimit((prev) => (Math.abs(prev - bottom) < 1 ? prev : Math.round(bottom)));
    };
    measure();
    const timer = setInterval(measure, 250);
    window.addEventListener('resize', measure);
    return () => { clearInterval(timer); window.removeEventListener('resize', measure); };
  }, [active]);
  return limit;
}

// Union of overlapping soft ellipses, in the photo's own 0..1 box, so it scales with the cloud.
function CloudClip({ id }) {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={id} clipPathUnits="objectBoundingBox">
          <rect x="0.04" y="0.36" width="0.92" height="0.6" rx="0.3" ry="0.3" />
          <ellipse cx="0.27" cy="0.46" rx="0.2" ry="0.3" />
          <ellipse cx="0.5" cy="0.36" rx="0.24" ry="0.36" />
          <ellipse cx="0.73" cy="0.47" rx="0.19" ry="0.28" />
        </clipPath>
      </defs>
    </svg>
  );
}

function CloudPhoto({ asset, name }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className="absolute inset-0 bg-gradient-to-br from-accent-soft to-sunken">
      {failed ? (
        <div className="absolute inset-0 flex items-center justify-center text-accent">
          <Building2 size={34} strokeWidth={1.6} />
        </div>
      ) : (
        <img
          src={asset.image}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className="absolute inset-0 w-full h-full object-cover transition-[opacity,filter] duration-500"
          style={{ opacity: loaded ? 1 : 0, filter: loaded ? 'blur(0)' : 'blur(14px)' }}
        />
      )}
      <span className="sr-only">{name}</span>
    </div>
  );
}

function Peek({ place, asset, onOpen, reduce, showHint, topLimit }) {
  const clipId = `locus-cloud-clip-${place.id}`;
  const [hidden, setHidden] = useState(typeof document !== 'undefined' && document.hidden);
  const [below, setBelow] = useState(false);
  const anchorRef = useRef(null);
  const topLimitRef = useRef(topLimit);
  topLimitRef.current = topLimit;
  useEffect(() => {
    const on = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);

  // Keeps the cloud on its building: every frame, place it from the map's live camera, so it
  // rides along with any pan or zoom instead of staying where the screen was. Moves the
  // wrapper with a transform (no React render); only the flip above/below is state.
  useEffect(() => {
    let frame = 0;
    let flipped = false;
    const place_ = () => {
      const node = anchorRef.current;
      const parent = node?.parentElement;
      if (node && parent) {
        const box = parent.getBoundingClientRect();
        let x = box.width / 2;
        let y = box.height / 2; // no map yet: the middle, where a tap recentres it
        const live = getMapView();
        if (live?.view && live.element) {
          const m = live.element.getBoundingClientRect();
          const { dx, dy } = offsetFromCenter(live.view, place, live.view.zoom);
          x = m.left - box.left + m.width / 2 + dx;
          y = m.top - box.top + m.height / 2 + dy;
        }
        const wantBelow = y - POINT_GAP_PX - CLOUD_HEIGHT_PX - TAIL_PX < topLimitRef.current + TOP_GAP_PX;
        if (wantBelow !== flipped) { flipped = wantBelow; setBelow(wantBelow); }
        const top = wantBelow ? y + POINT_GAP_PX : y - POINT_GAP_PX - CLOUD_HEIGHT_PX - TAIL_PX;
        node.style.transform = `translate3d(${Math.round(x - CLOUD_PEEK_WIDTH_PX / 2)}px, ${Math.round(top)}px, 0)`;
        node.style.visibility = 'visible';
      }
      frame = requestAnimationFrame(place_);
    };
    place_();
    return () => cancelAnimationFrame(frame);
  }, [place]);

  const originY = below ? 'top' : 'bottom';
  return (
    <div
      ref={anchorRef}
      className="absolute left-0 top-0 z-[600] pointer-events-none"
      style={{ width: CLOUD_PEEK_WIDTH_PX, height: CLOUD_HEIGHT_PX + TAIL_PX, visibility: 'hidden' }}
    >
    <motion.div
      className="absolute inset-0"
      style={{ transformOrigin: `50% ${originY === 'top' ? '0%' : '100%'}` }}
      initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.2 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.2 }}
      transition={reduce
        ? { duration: 0.15 }
        : { type: 'spring', duration: CLOUD_ENTER_MS / 1000, bounce: 0.32 }}
    >
      {!reduce && PUFFS.map((p, i) => (
        <motion.span
          key={i}
          aria-hidden="true"
          className="absolute rounded-full bg-surface"
          style={{ left: '50%', top: '50%', width: p.s, height: p.s, marginLeft: -p.s / 2, marginTop: -p.s / 2 }}
          initial={{ opacity: 0.85, x: 0, y: 0, scale: 0.4 }}
          animate={{ opacity: 0, x: p.x, y: p.y, scale: 1.3 }}
          transition={{ duration: 0.7, delay: 0.06 * i, ease: EASE_ENTER }}
        />
      ))}
      <div
        className="locus-cloud-float absolute inset-0"
        data-paused={hidden}
        style={{
          '--cloud-float': `${CLOUD_FLOAT_PX}px`,
          '--cloud-float-period': `${CLOUD_FLOAT_PERIOD_MS}ms`,
          flexDirection: below ? 'column-reverse' : 'column',
        }}
      >
        <CloudClip id={clipId} />
        <motion.button
          type="button"
          data-testid="building-cloud"
          aria-label={`Open details for ${place.name}`}
          onTap={onOpen}
          onDoubleClick={(e) => { e.stopPropagation(); onOpen(); }}
          onPanEnd={(_, info) => { if (info.offset.y < -SWIPE_UP_PX) onOpen(); }}
          whileTap={reduce ? undefined : { scale: 0.97 }}
          className="absolute left-0 right-0 pointer-events-auto block p-0 border-0 bg-transparent text-left"
          style={{
            height: CLOUD_HEIGHT_PX,
            ...(below ? { bottom: 0 } : { top: 0 }),
            touchAction: 'none',
            filter: 'drop-shadow(0 0 0.6px var(--color-border)) drop-shadow(0 10px 14px color-mix(in srgb, var(--color-text) 22%, transparent))',
          }}
        >
          <span className="absolute inset-0 block" style={{ clipPath: `url(#${clipId})` }}>
            <CloudPhoto asset={asset} name={place.name} />
            <span
              className="absolute inset-x-0 bottom-0 h-1/2"
              style={{ background: 'linear-gradient(to top, color-mix(in srgb, var(--color-surface) 94%, transparent) 15%, transparent)' }}
            />
            <span className="absolute inset-x-[16%] bottom-[11%] flex flex-col items-center text-center text-text font-ui">
              <span className="block max-w-full truncate text-[13px] font-bold tracking-tight leading-tight">{place.name}</span>
              <span
                className="block text-[10px] font-medium text-text-secondary transition-opacity duration-700"
                style={{ opacity: showHint ? 1 : 0 }}
              >
                Tap to open
              </span>
            </span>
          </span>
        </motion.button>
        <span
          aria-hidden="true"
          className="absolute left-1/2 block bg-surface"
          style={{
            width: TAIL_PX,
            height: TAIL_PX,
            marginLeft: -TAIL_PX / 2,
            transform: 'rotate(45deg) scale(0.72)',
            ...(below ? { top: -2 } : { bottom: -2 }),
            filter: 'drop-shadow(0 0 0.6px var(--color-border))',
          }}
        />
      </div>
    </motion.div>
    </div>
  );
}

/**
 * The building popup. A tap on a building on the map shows a small floating photo cloud at
 * the building's point (peek); tapping it, double-tapping it or swiping it up blooms it into
 * the full PlaceCard sheet (open). The sheet's back arrow, a swipe down, or Android Back
 * return to the cloud; the X, or a tap on empty map, dismiss it.
 *
 * The cloud stays on the building's pin through any pan or zoom: each frame it is placed from the
 * live map camera (utils/mapFocus getMapView + utils/mapProject), on both map engines. With no
 * map registered (tests) it sits at the middle of the screen.
 *
 * @param {{ place: object|null, startOpen?: boolean, onDismiss: () => void, cardProps: object }} props
 *   `cardProps` is everything PlaceCard takes except place/onClose/onBack.
 */
export default function BuildingCloud({ place, startOpen = false, onDismiss, cardProps }) {
  const reduce = useReducedMotion();
  const [state, dispatch] = useReducer(cloudReducer, CLOUD_CLOSED);
  const [showHint, setShowHint] = useState(false);
  const dragControls = useDragControls();
  const topLimit = useTopLimit(Boolean(place));
  const dragY = useMotionValue(0);
  const dragOpacity = useTransform(dragY, [0, 260], [1, 0.6]);
  const isBuilding = place?.id != null;
  const placeId = place?.id ?? null;

  // The selection drives the machine: another building swaps, none closes.
  useEffect(() => {
    dispatch({ type: 'select', id: isBuilding ? placeId : null, open: startOpen || (place && !isBuilding) });
  }, [placeId, isBuilding, startOpen, place]);

  // The "Tap to open" hint: shown for a few seconds, and never again once a cloud was opened.
  useEffect(() => {
    if (state.phase !== 'peek' || readHintSeen()) { setShowHint(false); return undefined; }
    setShowHint(true);
    const t = setTimeout(() => setShowHint(false), HINT_VISIBLE_MS);
    return () => clearTimeout(t);
  }, [state.phase, state.id]);

  useEffect(() => {
    if (state.phase !== 'open') return undefined;
    writeHintSeen();
    return pushBackHandler(() => { dispatch({ type: 'collapse' }); });
  }, [state.phase]);

  // Focus: the sheet takes it while open and gives it back to the cloud on collapse.
  const sheetRef = useRef(null);
  const cloudWasOpen = useRef(false);
  useEffect(() => {
    if (state.phase === 'open') {
      cloudWasOpen.current = true;
      sheetRef.current?.focus({ preventScroll: true });
    } else if (state.phase === 'peek' && cloudWasOpen.current) {
      cloudWasOpen.current = false;
      document.querySelector('[data-testid="building-cloud"]')?.focus({ preventScroll: true });
    }
  }, [state.phase]);

  const dismiss = () => { dispatch({ type: 'dismiss' }); onDismiss(); };

  if (!place) return null;
  const asset = isBuilding ? getBuildingAsset(place) : null;
  const phase = state.id === placeId ? state.phase : 'closed';

  return (
    <>
      <AnimatePresence mode="wait">
        {phase === 'peek' && (
          <Peek key={`peek-${placeId}`} place={place} asset={asset} onOpen={() => dispatch({ type: 'expand' })} reduce={reduce} showHint={showHint} topLimit={topLimit} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {phase === 'open' && (
          <motion.div
            key="sheet"
            ref={sheetRef}
            tabIndex={-1}
            role="dialog"
            aria-label={place.name}
            data-testid="location-card"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 56 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 40 }}
            transition={reduce
              ? { duration: 0.15 }
              : { type: 'spring', duration: CLOUD_BLOOM_MS / 1000, bounce: 0.06 }}
            style={{
              '--cloud-stagger': `${CLOUD_STAGGER_MS}ms`,
              '--cloud-reveal-delay': reduce ? '0ms' : '140ms',
              // As tall as fits between the top chrome and the SOS clearance below.
              '--sheet-h-sm': `max(16rem, min(66vh, 36rem, calc(100dvh - 11rem - env(safe-area-inset-bottom) - ${topLimit + TOP_GAP_PX}px)))`,
              '--sheet-h-md': `max(16rem, min(78vh, 40rem, calc(100dvh - 1.5rem - ${topLimit + TOP_GAP_PX}px)))`,
            }}
            className="absolute inset-x-3 bottom-[calc(11rem+env(safe-area-inset-bottom))] md:inset-x-auto md:bottom-6 md:right-6 z-[600] md:w-96 h-[var(--sheet-h-sm)] md:h-[var(--sheet-h-md)] pointer-events-auto outline-none"
          >
            {/* The one drag: the photo header pulls the whole sheet down; release past the
                threshold collapses it, anything less springs it home. The body scrolls on its own. */}
            <motion.div
              className="h-full rounded-[var(--radius-sheet)] overflow-hidden bg-surface border border-border shadow-2xl"
              style={{ y: dragY, opacity: dragOpacity }}
              drag={reduce ? false : 'y'}
              dragControls={dragControls}
              dragListener={false}
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.7 }}
              dragMomentum={false}
              onDragEnd={(_, info) => {
                if (info.offset.y > SWIPE_DOWN_PX || info.velocity.y > 600) dispatch({ type: 'collapse' });
              }}
            >
              <PlaceCard
                place={place}
                {...cardProps}
                onBack={isBuilding ? () => dispatch({ type: 'collapse' }) : null}
                onClose={dismiss}
                onHeaderPointerDown={reduce ? undefined : (e) => dragControls.start(e)}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
