import React from 'react';
// eslint-disable-next-line no-unused-vars -- motion is used as <motion.span>, which this config can't see
import { motion, useReducedMotion } from 'framer-motion';
import { INDICATOR_SPRING } from '../utils/motion';

// The phone's bottom bar. One highlight slides between the tabs on a spring (a shared
// layoutId), so changing tab reads as one object moving rather than two states swapping.
// Each icon also answers in its own way when its tab becomes active - the map lifts, the
// scan reticle turns a quarter, the squad pops - keyed on `active` so it plays once per
// selection, not on every render.
//
// Replaces an inline bar whose GRID tab also toggled satellite on every tap (so going back
// to the map from SQUAD flipped the map style), whose GRID dot pulsed even when another tab
// was active, and whose active tab grew with scale-110 and nudged its neighbours.

const ICON_ENTER = {
  lift: { y: [0, -4, 0] },
  turn: { rotate: [0, 90] },
  pop: { scale: [1, 1.22, 1] },
};

function Tab({ tab, active, onSelect, reduceMotion }) {
  const { id, label, Icon, flourish } = tab;
  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      aria-current={active ? 'page' : undefined}
      className={`relative flex-1 flex flex-col items-center justify-center gap-1 py-2 ${
        active ? 'text-red-500' : 'text-zinc-500'
      }`}
    >
      {active && (
        <motion.span
          layoutId="locus-tab-highlight"
          transition={reduceMotion ? { duration: 0 } : INDICATOR_SPRING}
          className="absolute inset-x-3 inset-y-0.5 border border-red-500/40 bg-red-500/10 shadow-[0_0_18px_rgba(239,68,68,0.25),inset_0_0_12px_rgba(239,68,68,0.12)]"
          aria-hidden="true"
        />
      )}
      <motion.span
        key={active ? `${id}-on` : `${id}-off`}
        initial={false}
        animate={active && !reduceMotion ? ICON_ENTER[flourish] : undefined}
        transition={{ duration: 0.42, ease: [0.2, 0.8, 0.2, 1] }}
        className={`relative flex ${active ? 'drop-shadow-[0_0_8px_rgba(239,68,68,0.8)]' : ''}`}
      >
        <Icon className="w-5 h-5" />
      </motion.span>
      <span className="relative text-[9px] tracking-widest font-dot uppercase">{label}</span>
    </button>
  );
}

/**
 * @param {{tabs: Array<{id:string, label:string, Icon:Function, flourish:'lift'|'turn'|'pop'}>,
 *   activeId: string|null, onSelect: (id:string) => void}} props
 */
export default function BottomTabBar({ tabs, activeId, onSelect }) {
  const reduceMotion = useReducedMotion();
  return (
    <nav
      aria-label="Main"
      className="md:hidden fixed bottom-0 w-full bg-black/90 backdrop-blur-xl border-t border-white/10 flex items-stretch px-2 pt-1.5 pb-[calc(0.5rem+env(safe-area-inset-bottom))] z-[1100] pointer-events-auto"
    >
      {/* Light catching the top edge of the glass, instead of a flat divider. */}
      <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-red-500/50 to-transparent" aria-hidden="true" />
      {tabs.map((tab) => (
        <Tab key={tab.id} tab={tab} active={tab.id === activeId} onSelect={onSelect} reduceMotion={reduceMotion} />
      ))}
    </nav>
  );
}
