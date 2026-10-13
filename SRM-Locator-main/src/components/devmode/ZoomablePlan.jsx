import React, { useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { Floor7DebugView } from '../Floor7DebugOverlay';
import { DevButton } from './ui';

const ZOOMS = [1, 1.5, 2, 3];

/** The three things the plan draws, in plain words (the access point codes are in Advanced). */
export function PlanLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="What the plan shows">
      <li className="flex items-center gap-2"><span className="inline-block w-3.5 h-3.5 shrink-0 rounded-full border-2 border-[#1B2630] bg-white" aria-hidden="true" />Wi-Fi guess</li>
      <li className="flex items-center gap-2"><span className="inline-block w-3.5 h-3.5 shrink-0 rounded-full bg-[#0EA5E9]" aria-hidden="true" />Guess moved onto corridor</li>
      <li className="flex items-center gap-2"><span className="inline-block w-3.5 h-3.5 shrink-0 rounded-full bg-[#10B981]" aria-hidden="true" />Position shown</li>
    </ul>
  );
}

/**
 * The Floor 7 plan at full width. Two round buttons zoom it (and it scrolls both ways when
 * zoomed), so they cost the plan no room. `target`: real metres ({x, y}) of the next door,
 * drawn as a blue ring. The caller sizes it (className) and shows the PlanLegend.
 */
export default function ZoomablePlan({ trail, target = null, className = '' }) {
  const [zoom, setZoom] = useState(0);
  return (
    <div className={`relative ${className}`}>
      <div className="h-full overflow-auto rounded-xl border border-border bg-white" data-testid="plan-scroll">
        <div style={{ width: `${ZOOMS[zoom] * 100}%` }}>
          <Floor7DebugView trail={trail} showRadios={false} target={target} />
        </div>
      </div>
      <div className="absolute right-2 bottom-2 flex gap-2" data-testid="plan-zoom">
        <DevButton variant="secondary" className="!px-0 !min-w-12 shadow" disabled={zoom === 0} onClick={() => setZoom((z) => Math.max(0, z - 1))} aria-label="Zoom out"><Minus size={22} aria-hidden="true" /></DevButton>
        <DevButton variant="secondary" className="!px-0 !min-w-12 shadow" disabled={zoom === ZOOMS.length - 1} onClick={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))} aria-label="Zoom in"><Plus size={22} aria-hidden="true" /></DevButton>
      </div>
    </div>
  );
}
