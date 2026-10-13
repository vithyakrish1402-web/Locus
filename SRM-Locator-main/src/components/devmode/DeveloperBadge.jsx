import React from 'react';
import { BELOW_TOP_BAR } from '../../utils/mapChrome';

/** "Developer mode on", under the top bar. Tapping it opens the Developer mode screen. */
export default function DeveloperBadge({ onOpen }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="developer-badge"
      className="absolute left-3 z-[1000] min-h-12 px-4 rounded-full bg-accent text-accent-on font-ui text-base font-semibold pointer-events-auto shadow-[var(--shadow-2)]"
      style={{ top: BELOW_TOP_BAR }}
    >
      Developer mode on
    </button>
  );
}
