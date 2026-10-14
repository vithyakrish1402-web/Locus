import React from 'react';
// eslint-disable-next-line no-unused-vars -- motion is used as <motion.span>, which this config can't see
import { motion, useReducedMotion } from 'framer-motion';
import { INDICATOR_SPRING } from '../utils/motion';

// The phone's bottom bar (redesign Map batch): Map, Scan and Group. One highlight slides between the tabs on a spring (a shared
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
      className={`relative flex-1 flex flex-col items-center justify-center gap-1 py-1.5 font-ui focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${
        active ? 'text-accent' : 'text-text-secondary'
      }`}
    >
      <span className="relative flex items-center justify-center w-16 h-8">
        {active && (
          <motion.span
            layoutId="locus-tab-highlight"
            transition={reduceMotion ? { duration: 0 } : INDICATOR_SPRING}
            className="absolute inset-0 rounded-full bg-accent-soft"
            aria-hidden="true"
          />
        )}
        <motion.span
          key={active ? `${id}-on` : `${id}-off`}
          initial={false}
          animate={active && !reduceMotion ? ICON_ENTER[flourish] : undefined}
          transition={{ duration: 0.42, ease: [0.2, 0.8, 0.2, 1] }}
          className="relative flex"
        >
          <Icon className="w-6 h-6" aria-hidden="true" />
        </motion.span>
      </span>
      <span className={`relative text-caption ${active ? 'font-semibold' : ''}`}>{label}</span>
    </button>
  );
}

/**
 * @param {{tabs: Array<{id:string, label:string, Icon:Function, flourish:'lift'|'turn'|'pop'}>,
 *   activeId: string|null, onSelect: (id:string) => void, sosTrigger?: React.ReactNode}} props
 */
export default function BottomTabBar({ tabs, activeId, onSelect, sosTrigger = null }) {
  const reduceMotion = useReducedMotion();
  return (
    <nav
      aria-label="Main"
      className="md:hidden fixed bottom-0 w-full bg-surface border-t border-border flex items-center justify-between px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] z-[1100] pointer-events-auto gap-2 shadow-[var(--shadow-2)]"
    >
      <div className="flex-1 flex items-stretch">
        {tabs.map((tab) => (
          <Tab key={tab.id} tab={tab} active={tab.id === activeId} onSelect={onSelect} reduceMotion={reduceMotion} />
        ))}
      </div>
      {sosTrigger && (
        <div className="shrink-0 flex items-center pr-1">
          {sosTrigger}
        </div>
      )}
    </nav>
  );
}
