import React, { useEffect, useState } from 'react';
// eslint-disable-next-line no-unused-vars -- motion is used as <motion.div>, which this config can't see
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Info, ShieldAlert, X } from 'lucide-react';
import { subscribe, dismiss } from '../utils/notify';
import { PANEL_SPRING, projectMomentum } from '../utils/motion';

// Renders the comms feed (src/utils/notify.js): the app's non-blocking replacement for
// window.alert(). Notices drop in from the top and stack; each shows how long it has left
// as a draining line, and can be flicked sideways to dismiss (the throw is projected like
// the squad sheet's, so a short quick flick is enough).

const LOOK = {
  info: { Icon: Info, accent: 'text-zinc-200', edge: 'border-white/25', bar: 'bg-white/60', label: 'SYS_NOTICE' },
  success: { Icon: CheckCircle2, accent: 'text-emerald-400', edge: 'border-emerald-500/50', bar: 'bg-emerald-400', label: 'CONFIRMED' },
  warning: { Icon: AlertTriangle, accent: 'text-yellow-400', edge: 'border-yellow-500/50', bar: 'bg-yellow-400', label: 'CAUTION' },
  error: { Icon: ShieldAlert, accent: 'text-red-400', edge: 'border-red-500/60', bar: 'bg-red-500', label: 'SYS_ERROR' },
};

const SWIPE_DISMISS_PX = 110;

function Notice({ item, reduceMotion }) {
  const look = LOOK[item.severity] ?? LOOK.info;
  const { Icon } = look;
  const [exitX, setExitX] = useState(0);

  return (
    <motion.div
      layout={!reduceMotion}
      role={item.severity === 'error' ? 'alert' : 'status'}
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -24, scale: 0.96, filter: 'blur(4px)' }}
      animate={{ opacity: 1, y: 0, x: 0, scale: 1, filter: 'blur(0px)' }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: exitX, y: exitX ? 0 : -16, scale: 0.96, transition: { duration: 0.2 } }}
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
      className={`pointer-events-auto relative overflow-hidden border ${look.edge} bg-black/85 backdrop-blur-xl shadow-[0_12px_32px_rgba(0,0,0,0.6)] touch-pan-y cursor-grab active:cursor-grabbing`}
      data-no-ping
    >
      <div className="flex items-start gap-3 p-3 pr-2">
        <Icon size={18} className={`${look.accent} mt-0.5 shrink-0`} aria-hidden="true" />
        <div className="min-w-0 flex-1 text-left">
          <p className={`font-dot text-[10px] uppercase tracking-widest ${look.accent}`}>{item.title || look.label}</p>
          <p className="mt-0.5 font-dot text-[11px] uppercase tracking-wider leading-relaxed text-zinc-200 break-words">{item.message}</p>
        </div>
        <button
          type="button"
          onClick={() => dismiss(item.id)}
          aria-label="Dismiss notice"
          className="shrink-0 p-1.5 text-zinc-500 hover:text-white"
        >
          <X size={14} />
        </button>
      </div>
      {item.duration > 0 && (
        // Keyed on postedAt so a refreshed duplicate restarts its countdown.
        <span
          key={item.postedAt}
          className={`absolute bottom-0 left-0 h-[2px] w-full origin-left ${look.bar} locus-drain`}
          style={{ animationDuration: `${item.duration}ms` }}
          aria-hidden="true"
        />
      )}
    </motion.div>
  );
}

export default function CommsFeed() {
  const [items, setItems] = useState([]);
  const reduceMotion = useReducedMotion();
  useEffect(() => subscribe(setItems), []);

  return (
    <div
      aria-live="polite"
      className="fixed inset-x-0 z-[9000] flex justify-center px-4 pointer-events-none"
      style={{ top: 'max(0.75rem, calc(env(safe-area-inset-top) + 0.5rem))' }}
    >
      <div className="w-full max-w-md flex flex-col gap-2">
        <AnimatePresence initial={false}>
          {items.map((item) => (
            <Notice key={item.id} item={item} reduceMotion={reduceMotion} />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
