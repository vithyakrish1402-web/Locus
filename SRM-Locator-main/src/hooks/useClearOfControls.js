import { useEffect } from 'react';

// Keeps a marker's name plate out from under the map's right-hand controls (Map batch fix 3):
// the meeting point's, and members' (live and lost connection).
// The map pans and zooms without re-rendering its markers (both engines move them by
// transform), so the plate is checked a few times a second rather than on render. Only the
// plate moves, left, and never further than its right edge reaching the pin's centre: the
// plate stays under its pin, and a pin that is itself under the controls stays where it is.

const CONTROLS = '[data-testid="map-controls"]';
const CHECK_MS = 250;

/**
 * How far left (px) a plate must move to clear the controls, from where it would sit unmoved.
 * @param {{left:number,right:number,top:number,bottom:number}|null} plate
 * @param {{left:number,right:number,top:number,bottom:number}|null} controls
 * @param {{ gap?: number, maxShift?: number }} [options]
 */
export function shiftClearOf(plate, controls, { gap = 8, maxShift = Infinity } = {}) {
  if (!plate || !controls) return 0;
  const besideVertically = plate.bottom > controls.top - gap && plate.top < controls.bottom + gap;
  if (!besideVertically || plate.left >= controls.right) return 0;
  const over = plate.right + gap - controls.left;
  return over > 0 ? Math.min(over, Math.max(0, maxShift)) : 0;
}

/** @param {React.RefObject<HTMLElement>} plateRef the plate, centred under its pin */
export function useClearOfControls(plateRef) {
  useEffect(() => {
    const plate = plateRef.current;
    if (!plate) return undefined;
    let shift = 0;
    const check = () => {
      const controls = document.querySelector(CONTROLS);
      const r = plate.getBoundingClientRect();
      const unmoved = { left: r.left + shift, right: r.right + shift, top: r.top, bottom: r.bottom };
      const next = shiftClearOf(unmoved, controls?.getBoundingClientRect() ?? null, { maxShift: r.width / 2 });
      if (next === shift) return;
      shift = next;
      // transform, not translate: a plate centred with Tailwind's -translate-x-1/2 (the
      // translate property) keeps that, and this moves it on from there.
      plate.style.transform = shift ? `translateX(${-shift}px)` : '';
    };
    check();
    const id = setInterval(check, CHECK_MS);
    return () => clearInterval(id);
  }, [plateRef]);
}
