import React from 'react';
import { PANEL_STOPS } from '../../copy/group';

// The group panel's three-point slider, drawn on its handle: three notches for peek (members),
// half (options) and full (everything), the current one long and in the accent colour. Drag the
// panel, or tap a notch to go straight to it. It stands in for the plain grab bar.

const ORDER = ['peek', 'half', 'full'];

/**
 * @param {{ height: 'peek'|'half'|'full', onChange: (height: 'peek'|'half'|'full') => void }} props
 */
export default function PanelStops({ height, onChange }) {
  return (
    <div
      role="group"
      aria-label={PANEL_STOPS.label}
      data-testid="panel-stops"
      className="md:hidden flex items-center justify-center gap-1 mx-auto mb-1 -mt-1"
      // Pressing here is not a drag of the panel, and a tap is not a tap on its header.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {ORDER.map((stop) => {
        const current = height === stop;
        return (
          <button
            key={stop}
            type="button"
            data-stop={stop}
            aria-pressed={current}
            aria-label={PANEL_STOPS[stop]}
            title={PANEL_STOPS[stop]}
            onClick={() => onChange(stop)}
            className="flex items-center justify-center w-11 h-7 rounded-full cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
          >
            <span
              aria-hidden="true"
              className={`block h-2 rounded-full transition-[width,background-color] duration-200 ${current ? 'w-8 bg-accent' : 'w-2 bg-border-control'}`}
            />
          </button>
        );
      })}
    </div>
  );
}
