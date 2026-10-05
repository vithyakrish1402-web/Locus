import React from 'react';
import { Building2, ChevronLeft, ChevronRight, MapPin } from 'lucide-react';
import { formatArDistance } from '../utils/arPosition';
import { initialsOf } from './ui/initials';

// One floating AR Scan label (redesign AR Scan batch, piece 5): a translucent plate
// (.ar-plate: white at 90 % in light, ink at 86 % in dark) with the name and how far, on a
// thin line down to the point it marks. AR Scan's one destination has a 2 px accent border and
// a pin; a group member shows their initials; a building a small building. (x, y) are
// percentages of the screen, from layoutArTags, and mark the point the tag's bottom tick sits
// on; `tickPx` is that tick's length (longer for a label stacked up a row). `edge` ('left' |
// 'right') marks a tag for something just off-screen: it points that way and has no tick.
// `focused` lifts the tag nearest the centre of the view. `distanceText` overrides the
// distance's own formatting. `opacity` and `scale` (the Landmark Anchor Engine's fade and
// shrink with distance) apply to the whole tag; `occluded` marks one dimmed because a nearer
// landmark stands in front of it. Positions come already eased from the engine, so the tag
// itself doesn't animate them.
//
// One line, about 24 px tall, as the engine's layout measures it (TAG_LABEL_HEIGHT_PX,
// TAG_CHAR_PX in utils/landmarkAnchorEngine.js): a taller plate would overlap its neighbours,
// because the engine plans every label's room from those sizes.
const ARTag = ({ name, distance, distanceText, x, y, variant, edge = null, focused = false, occluded = false, opacity = 1, scale = 1, tickPx = 12 }) => {
  const isTarget = variant === 'target';
  const Arrow = edge === 'left' ? ChevronLeft : ChevronRight;
  const arrowClass = `shrink-0 ${isTarget ? 'text-accent' : 'text-text-secondary'}`;
  const lead = variant === 'member'
    ? <span className="shrink-0 inline-flex items-center justify-center w-4 h-4 rounded-full bg-accent-soft text-accent text-[9px] font-semibold leading-none" aria-hidden="true">{initialsOf(name)}</span>
    : isTarget
      ? <MapPin size={13} className="shrink-0 text-accent" aria-hidden="true" />
      : <Building2 size={12} className="shrink-0 text-text-secondary" aria-hidden="true" />;
  return (
    <div
      data-testid="ar-tag"
      data-variant={variant}
      data-edge={edge || undefined}
      data-focused={focused || undefined}
      data-occluded={occluded || undefined}
      className="absolute flex flex-col items-center -translate-x-1/2 -translate-y-full font-ui"
      style={{ left: `${x}%`, top: `${y}%`, zIndex: isTarget ? 3 : focused ? 2 : 1, opacity }}
    >
      <div className="flex flex-col items-center origin-bottom" style={scale !== 1 ? { transform: `scale(${scale})` } : undefined}>
        <div
          className={`ar-plate flex items-center gap-1.5 px-2.5 h-6 rounded-full max-w-[40vw] text-text ${
            isTarget
              ? 'border-2 border-accent shadow-[var(--shadow-2)]'
              : focused
                ? 'border border-border-control shadow-[var(--shadow-2)]'
                : 'border border-border shadow-[var(--shadow-1)]'
          }`}
        >
          {edge === 'left' && <Arrow size={12} className={arrowClass} aria-hidden="true" />}
          {lead}
          <span className="text-[12px] font-semibold leading-none truncate">{name}</span>
          <span className={`text-[12px] leading-none shrink-0 tabular-nums ${isTarget ? 'text-accent font-semibold' : 'text-text-secondary'}`}>
            {distanceText ?? formatArDistance(distance)}
          </span>
          {edge === 'right' && <Arrow size={12} className={arrowClass} aria-hidden="true" />}
        </div>
      </div>
      {/* An edge tag keeps the tick's space (the layout counts it) but doesn't draw it. The
          dot marks the point itself, drawn over the tick's end so it adds no height. */}
      <div className={`relative w-px ${edge ? '' : isTarget ? 'bg-accent' : 'bg-text-secondary'}`} style={{ height: tickPx }}>
        {!edge && (
          <span
            className={`absolute left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2 w-2 h-2 rounded-full border border-surface ${isTarget ? 'bg-accent' : 'bg-text-secondary'}`}
            aria-hidden="true"
          />
        )}
      </div>
    </div>
  );
};

export default ARTag;
