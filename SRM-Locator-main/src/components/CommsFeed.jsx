import React, { useEffect, useRef, useState } from 'react';
// eslint-disable-next-line no-unused-vars -- motion is used as <motion.div>, which this config can't see
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { AlertCircle, AlertTriangle, Check, Info, Radio, X } from 'lucide-react';
import { subscribe, dismiss } from '../utils/notify';
import { PANEL_SPRING, projectMomentum } from '../utils/motion';
import { LAYER } from '../utils/layers';
import { BELOW_TOP_BAR } from '../utils/mapChrome';
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

  // The headline is the title when there is one; otherwise the message itself.
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
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, x: 0, scale: 1 }}
      exit={
        reduceMotion
          ? { opacity: 0, transition: { duration: 0.15 } }
          : {
              opacity: 0,
              x: exitX,
              y: exitX ? 0 : -12,
              scale: 0.97,
              transition: { duration: 0.2, ease: [0.3, 0, 0.8, 0.15] },
            }
      }
      transition={
        reduceMotion
          ? { duration: 0.15 }
          : { duration: 0.22, ease: [0.16, 1, 0.3, 1] }
      }
      whileTap={reduceMotion ? undefined : { scale: 0.99, transition: { duration: 0.12 } }}
      drag={reduceMotion ? false : 'x'}
      dragElastic={0.5}
      dragConstraints={{ left: 0, right: 0 }}
      onDragEnd={(_e, info) => {
        const projected = info.offset.x + projectMomentum(info.velocity.x);
        if (Math.abs(projected) > SWIPE_DISMISS_PX) {
          setExitX(projected > 0 ? 380 : -380); // leave cleanly the way it was thrown
          dismiss(item.id);
        }
      }}
      className={`${
        reachable ? 'pointer-events-auto' : 'pointer-events-none'
      } relative overflow-hidden rounded-[14px] bg-[var(--glass-surface)] backdrop-blur-xl text-text font-ui shadow-[0_4px_16px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.04)] dark:shadow-[0_4px_20px_rgba(0,0,0,0.45)] border border-[var(--color-border)]/75 dark:border-[var(--glass-border)] touch-pan-y cursor-grab active:cursor-grabbing select-none w-full`}
      data-no-ping
    >
      {/* 2.5-3px minimal left severity indicator accent bar */}
      <span
        className={`absolute left-0 top-0 bottom-0 w-[3px] ${look.bar} rounded-l-full`}
        aria-hidden="true"
      />

      <div className="flex items-start gap-3 py-2.5 pl-3.5 pr-2 min-h-[52px]">
        {/* Subtle, restrained icon disc */}
        <span
          className={`flex items-center justify-center w-8 h-8 rounded-full shrink-0 mt-0.5 ${look.disc}`}
          aria-hidden="true"
        >
          <Icon size={16} strokeWidth={2.2} />
        </span>

        {/* Content body */}
        <div
          className={`min-w-0 flex-1 text-left py-0.5 ${item.onClick ? 'cursor-pointer' : ''}`}
          {...(item.onClick
            ? {
                role: 'button',
                tabIndex: 0,
                onClick: () => {
                  dismiss(item.id);
                  item.onClick();
                },
              }
            : {})}
        >
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-heading font-medium text-text tracking-tight leading-snug break-words">
              {headline}
            </p>
            {item.timestamp && (
              <span className="shrink-0 text-[11px] font-medium text-text-secondary/75 tracking-normal">
                {item.timestamp}
              </span>
            )}
          </div>
          {detail && (
            <p className="text-secondary text-text-secondary leading-relaxed break-words mt-0.5">
              {detail}
            </p>
          )}
          {more && (
            <p className="text-secondary text-text-secondary/80 leading-relaxed break-words mt-0.5">
              {more}
            </p>
          )}
        </div>

        {/* Minimal close button with accessible 44px minimum touch area */}
        <div className="shrink-0 -mr-1 -mt-0.5 flex items-center justify-center">
          <IconButton
            label="Dismiss notice"
            icon={X}
            size={15}
            onClick={() => dismiss(item.id)}
            className="!min-w-[44px] !min-h-[44px] text-text-secondary/70 hover:text-text hover:bg-sunken"
          />
        </div>
      </div>
    </motion.div>
  );
}

// Where the feed starts: under the map's top bar (utils/mapChrome.js), over the sharing
// chip, so a notice never covers Sign out or the screen's name. Over AR Scan it drops below
// AR's header (its ALIGN, RESET and close buttons end about 6.5rem down, and the compass
// calibration notice under them about 9.5rem; AR Scan is drawn from the very top, without
// the safe-area inset), so a notice never covers those or moves them.
const TOP = BELOW_TOP_BAR;
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
