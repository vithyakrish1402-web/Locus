import React from 'react';
import { Building2, Crosshair, User } from 'lucide-react';

const formatDistance = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} KM` : `${m} M`);

const ICONS = { building: Building2, member: User, target: Crosshair };

// One floating AR Scan label. (x, y) are percentages of the screen, from selectArTags,
// and mark the point the tag's bottom tick sits on. variant: 'building' | 'member' for
// the ambient tags, 'target' for AR Scan's one destination, which is drawn in red.
const ARTag = ({ name, distance, x, y, variant }) => {
  const isTarget = variant === 'target';
  const Icon = ICONS[variant] || User;
  return (
    <div
      data-testid="ar-tag"
      data-variant={variant}
      className="absolute flex flex-col items-center -translate-x-1/2 -translate-y-full motion-safe:transition-[left,top] motion-safe:duration-150 motion-safe:ease-linear"
      style={{ left: `${x}%`, top: `${y}%`, zIndex: isTarget ? 2 : 1 }}
    >
      <div
        className={`flex items-center gap-1.5 px-2 py-1 backdrop-blur-md border max-w-[40vw] ${
          isTarget
            ? 'bg-red-500/20 border-red-500 shadow-[0_0_12px_rgba(239,68,68,0.5)]'
            : 'bg-black/60 border-white/20'
        }`}
      >
        <Icon size={12} className={isTarget ? 'text-red-500 shrink-0' : 'text-zinc-400 shrink-0'} />
        <span className="font-dot text-[10px] uppercase tracking-widest text-white truncate">{name}</span>
        <span className={`font-dot text-[10px] uppercase tracking-widest shrink-0 ${isTarget ? 'text-red-500' : 'text-zinc-400'}`}>
          {formatDistance(distance)}
        </span>
      </div>
      <div className={`w-px h-3 ${isTarget ? 'bg-red-500' : 'bg-white/40'}`} />
    </div>
  );
};

export default ARTag;
