import { useEffect, useState } from 'react';

// Tailwind's `md` breakpoint: below it the app uses its phone layout (bottom bar, sheets).
const MOBILE_QUERY = '(max-width: 767.98px)';

const matches = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(MOBILE_QUERY).matches
    : typeof window !== 'undefined' && window.innerWidth < 768;

/**
 * True while the viewport is phone-sized, and it re-renders when that changes. App.jsx used
 * to read window.innerWidth during render, which is a one-off snapshot: rotating the phone
 * or resizing a split screen left the sheet laid out for the old width until some unrelated
 * state change happened to re-render it.
 */
export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(matches);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setIsMobile(query.matches);
    onChange();
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return isMobile;
}
