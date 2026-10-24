import { useEffect } from 'react';

// Android's Back (or the keyboard's own hide key) closes the on-screen keyboard but leaves the
// text field it was for focused. Focus still being there, the next layout change - the panel
// stepping back, the page resizing as the keyboard goes - can bring the keyboard straight back
// up, and the search seems to "bounce". So when the keyboard goes, the field lets go.
//
// The keyboard is seen going the only way a page can see it: the window (the WebView resizes
// to make room, see Capacitor's SystemBars) grows back to the full height it had before. A
// keyboard that only changes shape, or a rotation, never takes the window all the way back.

/** How close to the tallest the window has been counts as "back to full height" (px). */
export const FULL_HEIGHT_SLACK_PX = 40;
/** How far under the tallest it must have been before for that to be a keyboard (px). */
export const KEYBOARD_MIN_HEIGHT_PX = 120;

const isTextField = (el) =>
  Boolean(el) && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'range'].includes(el.type)));

export function useBlurOnKeyboardHide() {
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    let width = window.innerWidth;
    let tallest = window.innerHeight;
    let last = window.innerHeight;
    const onResize = () => {
      if (window.innerWidth !== width) {
        // Rotated or re-split: a new baseline, and not a keyboard.
        width = window.innerWidth;
        tallest = last = window.innerHeight;
        return;
      }
      const height = window.innerHeight;
      tallest = Math.max(tallest, height);
      const wasUp = last < tallest - KEYBOARD_MIN_HEIGHT_PX;
      const nowFull = height >= tallest - FULL_HEIGHT_SLACK_PX;
      last = height;
      if (wasUp && nowFull && isTextField(document.activeElement)) document.activeElement.blur();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
}
