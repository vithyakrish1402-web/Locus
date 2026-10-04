import React from 'react';
import { Building2, ChevronLeft, ChevronRight, Crosshair, User } from 'lucide-react';
import { formatArDistance } from '../utils/arPosition';

const ICONS = { building: Building2, member: User, target: Crosshair };

// One floating AR Scan label. (x, y) are percentages of the screen, from layoutArTags,
// and mark the point the tag's bottom tick sits on; `tickPx` is that tick's length (longer
// for a label stacked up a row). variant: 'building' | 'member' for the ambient tags,
// 'target' for AR Scan's one destination, which is drawn in red. `edge` ('left' | 'right')
// marks a tag for something just off-screen: it points that way and has no tick.
// `focused` brightens the tag nearest the centre of the view. `distanceText` overrides the
// distance's own formatting. `opacity` and `scale` (the Landmark Anchor Engine's fade and
// shrink with distance) apply to the whole tag; `occluded` marks one dimmed because a
// nearer landmark stands in front of it. Positions come already eased from the engine, so
// the tag itself doesn't animate them.
const ARTag = ({ name, distance, distanceText, x, y, variant, edge = null, focused = false, occluded = false, opacity = 1, scale = 1, tickPx = 12 }) => {
  const isTarget = variant === 'target';
  const Icon = ICONS[variant] || User;
  const Arrow = edge === 'left' ? ChevronLeft : ChevronRight;
  const arrowClass = isTarget ? 'text-red-500 shrink-0' : 'text-zinc-300 shrink-0';
  return (
    <div
      data-testid="ar-tag"
      data-variant={variant}
      data-edge={edge || undefined}
      data-focused={focused || undefined}
      data-occluded={occluded || undefined}
      className="absolute flex flex-col items-center -translate-x-1/2 -translate-y-full"
      style={{ left: `${x}%`, top: `${y}%`, zIndex: isTarget ? 3 : focused ? 2 : 1, opacity }}
    >
      <div className="flex flex-col items-center origin-bottom" style={scale !== 1 ? { transform: `scale(${scale})` } : undefined}>
        <div
          className={`flex items-center gap-1.5 px-2 py-1 backdrop-blur-md border max-w-[40vw] ${
            isTarget
              ? 'bg-red-500/20 border-red-500 shadow-[0_0_12px_rgba(239,68,68,0.5)]'
              : focused
                ? 'bg-black/75 border-white/70'
                : 'bg-black/60 border-white/20'
          }`}
        >
          {edge === 'left' && <Arrow size={12} className={arrowClass} aria-hidden="true" />}
          <Icon size={12} className={isTarget ? 'text-red-500 shrink-0' : 'text-zinc-400 shrink-0'} />
          <span className="font-dot text-[10px] uppercase tracking-widest text-white truncate">{name}</span>
          <span className={`font-dot text-[10px] uppercase tracking-widest shrink-0 ${isTarget ? 'text-red-500' : 'text-zinc-400'}`}>
            {distanceText ?? formatArDistance(distance)}
          </span>
          {edge === 'right' && <Arrow size={12} className={arrowClass} aria-hidden="true" />}
        </div>
      </div>
      {/* An edge tag keeps the tick's space (the layout counts it) but doesn't draw it. */}
      <div className={`w-px ${edge ? '' : isTarget ? 'bg-red-500' : focused ? 'bg-white/70' : 'bg-white/40'}`} style={{ height: tickPx }} />
    </div>
  );
};

export default ARTag;
