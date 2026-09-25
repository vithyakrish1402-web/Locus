// eslint-disable-next-line no-unused-vars -- motion is used as <motion.button>, which this config can't see
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { floorLabel } from '../utils/indoorView';

/**
 * WiFi Arc Stage 7: one tab per surveyed floor of the building you're in, stacked like a
 * lift panel (top floor on top). The tab for the floor you're really on carries the
 * emerald "live" dot - emerald being your own colour on the map - so it stays obvious
 * even while you look at another floor. Tapping a tab changes the view only.
 *
 * @param {ReturnType<import('../hooks/useIndoorView').useIndoorView>} view never null here
 */
export default function FloorPicker({ view }) {
  const reduceMotion = useReducedMotion();
  const floorsTopDown = [...view.floors].reverse();

  return (
    <div className="absolute left-4 top-1/3 z-40 flex items-start gap-2 pointer-events-auto">
      <div
        role="tablist"
        aria-label={`${view.building} floors`}
        className="flex flex-col bg-black/70 backdrop-blur-md border border-white/15 shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
      >
        {floorsTopDown.map((floor) => {
          const selected = floor === view.viewedFloor;
          const live = floor === view.liveFloor;
          return (
            <button
              key={floor}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-label={`${floorLabel(floor)}${live ? ' (you are here)' : ''}`}
              onClick={() => view.selectFloor(floor)}
              className={`relative w-11 h-10 font-dot text-xs tracking-widest border-b border-white/10 last:border-b-0 ${
                selected ? 'bg-white/15 text-white' : 'text-zinc-400 hover:bg-white/10'
              }`}
            >
              {floorLabel(floor)}
              {live && (
                <span
                  data-testid="live-floor-dot"
                  aria-hidden="true"
                  className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]"
                />
              )}
            </button>
          );
        })}
      </div>

      <AnimatePresence>
        {view.showReturnChip && (
          <motion.button
            type="button"
            initial={reduceMotion ? false : { opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -12 }}
            transition={{ duration: 0.2 }}
            onClick={view.returnToLive}
            className="px-3 py-2 whitespace-nowrap font-dot text-[10px] uppercase tracking-widest bg-black/80 backdrop-blur-md border border-emerald-500/60 text-emerald-400"
          >
            Return to {floorLabel(view.liveFloor)}
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
