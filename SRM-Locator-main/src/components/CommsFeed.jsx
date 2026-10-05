import React, { useEffect, useRef, useState } from 'react';
// eslint-disable-next-line no-unused-vars -- motion is used as <motion.div>, which this config can't see
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { AlertCircle, AlertTriangle, Check, Info, Radio, X } from 'lucide-react';
import { subscribe, dismiss } from '../utils/notify';
import { PANEL_SPRING, projectMomentum } from '../utils/motion';
import { LAYER } from '../utils/layers';
import IconButton from './ui/IconButton';

// Renders the notifications (src/utils/notify.js): the app's non-blocking replacement for
// window.alert(). Notices drop in from the top and stack under the top bar; each shows how
// long it has left as a draining line, and can be flicked sideways to dismiss (the throw is
// projected like the group panel's, so a short quick flick is enough).
//
// Four kinds, as in the design: success (green), info and ping (accent), warning (amber) and
// problem (the 'error' severity). A problem is amber too: red is kept for the Emergency
// alert and for actions that remove someone.

const LOOK = {
  info: { Icon: Info, disc: 'bg-accent-soft text-accent', bar: 'bg-accent' },
  ping: { Icon: Radio, disc: 'bg-accent-soft text-accent', bar: 'bg-accent' },
  success: { Icon: Check, disc: 'bg-success-soft text-success', bar: 'bg-success' },
  warning: { Icon: AlertTriangle, disc: 'bg-warning-soft text-warning', bar: 'bg-warning' },
  error: { Icon: AlertCircle, disc: 'bg-warning-soft text-warning', bar: 'bg-warning' },
};

const SWIPE_DISMISS_PX = 110;

// While the feed sits under the open group panel, a notice takes taps only where it can be
// seen: when it is wholly above the panel's top edge (the panel being dragged down, say).
// Checked on a short timer, since the panel moves without telling the feed.
const COVER_CHECK_MS = 120;
function useAbovePanel(ref, coveredBy) {
  const [above, setAbove] = useState(false);
  useEffect(() => {
    if (!coveredBy) return undefined;
    const check = () => {
      const notice = ref.current?.getBoundingClientRect();
      const panel = coveredBy.current?.getBoundingClientRect();
      setAbove(Boolean(notice && panel && notice.height > 0 && notice.bottom <= panel.top));
    };
    check();
    const timer = setInterval(check, COVER_CHECK_MS);
    return () => clearInterval(timer);
  }, [ref, coveredBy]);
  return coveredBy ? above : true;
}

function Notice({ item, reduceMotion, coveredBy }) {
  const cardRef = useRef(null);
  const reachable = useAbovePanel(cardRef, coveredBy);
  const look = LOOK[item.kind === 'ping' ? 'ping' : item.severity] ?? LOOK.info;
  const { Icon } = look;
  const [exitX, setExitX] = useState(0);
  // The bold line is the title when there is one; otherwise the message itself.
  const headline = item.title || item.message;
  const detail = item.title ? item.message : item.body;
  const more = item.title && item.body ? item.body : null;

  return (
    <motion.div
      ref={cardRef}
      layout={!reduceMotion}
      role={item.severity === 'error' ? 'alert' : 'status'}
      data-severity={item.severity}
      data-reachable={reachable}
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -24, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, x: 0, scale: 1 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: exitX, y: exitX ? 0 : -16, scale: 0.96, transition: { duration: 0.18 } }}
      transition={reduceMotion ? { duration: 0.15 } : PANEL_SPRING}
      drag={reduceMotion ? false : 'x'}
      dragElastic={0.6}
      dragConstraints={{ left: 0, right: 0 }}
      onDragEnd={(_e, info) => {
        const projected = info.offset.x + projectMomentum(info.velocity.x);
        if (Math.abs(projected) > SWIPE_DISMISS_PX) {
          setExitX(projected > 0 ? 420 : -420); // leave the way it was thrown
          dismiss(item.id);
        }
      }}
      className={`${reachable ? 'pointer-events-auto' : 'pointer-events-none'} relative overflow-hidden rounded-card bg-raised text-text font-ui shadow-[var(--shadow-2)] border border-border touch-pan-y cursor-grab active:cursor-grabbing`}
      data-no-ping
    >
      <div className="flex items-center gap-3 py-3 pl-3 pr-1">
        <span className={`flex items-center justify-center w-10 h-10 rounded-full shrink-0 ${look.disc}`} aria-hidden="true">
          <Icon size={20} />
        </span>
        {/* A tappable notice (item.onClick) dismisses itself, then runs its action. */}
        <div
          className={`min-w-0 flex-1 text-left ${item.onClick ? 'cursor-pointer' : ''}`}
          {...(item.onClick ? { role: 'button', tabIndex: 0, onClick: () => { dismiss(item.id); item.onClick(); } } : {})}
        >
          <p className="text-heading break-words">{headline}</p>
          {detail && <p className="text-secondary text-text-secondary break-words">{detail}</p>}
          {more && <p className="text-secondary text-text-secondary break-words">{more}</p>}
        </div>
        <IconButton label="Dismiss notice" icon={X} size={20} onClick={() => dismiss(item.id)} className="shrink-0" />
      </div>
      {item.duration > 0 && (
        // Keyed on postedAt so a refreshed duplicate restarts its countdown.
        <span
          key={item.postedAt}
          className={`absolute bottom-0 left-0 h-[3px] w-full origin-left ${look.bar} locus-drain`}
          style={{ animationDuration: `${item.duration}ms` }}
          aria-hidden="true"
        />
      )}
    </motion.div>
  );
}

// Where the feed starts: under the map's top bar (TOP_BAR_REM, from the top of the safe
// area), so a notice never covers Sign out or the screen's name. Over AR Scan it drops below
// AR's header (its ALIGN, RESET and close buttons end about 6.5rem down, and the compass
// calibration notice under them about 9.5rem; AR Scan is drawn from the very top, without
// the safe-area inset), so a notice never covers those or moves them.
export const TOP_BAR_REM = 4.5;
const TOP = `calc(max(1rem, env(safe-area-inset-top)) + ${TOP_BAR_REM}rem)`;
export const TOP_OVER_AR_SCAN = '10rem';

/**
 * @param {{ overArScan?: boolean, coveredBy?: React.RefObject<HTMLElement> | null }} props
 *   overArScan: AR Scan is open (see TOP_OVER_AR_SCAN)
 *   coveredBy: the open group panel on a phone. The feed then sits under it
 *   (LAYER.underGroupPanel) and a notice takes taps only while it is above the panel.
 *   Over AR Scan the feed always stays on top.
 */
export default function CommsFeed({ overArScan = false, coveredBy = null }) {
  const under = coveredBy && !overArScan ? coveredBy : null;
  const [items, setItems] = useState([]);
  const reduceMotion = useReducedMotion();
  useEffect(() => subscribe(setItems), []);

  return (
    <div
      aria-live="polite"
      data-testid="comms-feed"
      data-over-ar-scan={overArScan || undefined}
      data-under-group-panel={under ? true : undefined}
      className="fixed inset-x-0 flex justify-center px-3 pointer-events-none"
      // LAYER.toast: over AR Scan, whose notices (ALIGN, compass access) used to be drawn
      // underneath it and expire unseen; under an update gate and an incoming SOS.
      // LAYER.underGroupPanel while the group panel is open on a phone (see coveredBy).
      style={{ zIndex: under ? LAYER.underGroupPanel : LAYER.toast, top: overArScan ? TOP_OVER_AR_SCAN : TOP }}
    >
      <div className="w-full max-w-md flex flex-col gap-3">
        <AnimatePresence initial={false}>
          {items.map((item) => (
            <Notice key={item.id} item={item} reduceMotion={reduceMotion} coveredBy={under} />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
