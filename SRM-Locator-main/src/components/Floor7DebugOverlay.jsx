import { useEffect, useState } from 'react';
import floor7Aps from '../data/floor7Aps.json';
import { floor7Geometry, getTrail, subscribeTrail } from '../utils/floor7Demo.js';

// Floor 7 alignment check, for the test build only (rendered under FLOOR7_DEMO, owner only):
// draws the plan (walkable areas, walls, the 14 spots), where each access point was placed,
// the raw WiFi estimates and the filtered track, so the team can see by eye in minutes whether
// the plan lines up with where people really stood. Nothing here reaches a squad or a user.

const STATUS_COLOR = { tracking: '#10B981', rejected: '#F59E0B', reacquiring: '#F97316' };
const PAD = 3;

const flip = (p) => `${p.x},${-p.y}`; // plan y points up, the screen's points down

/** Pure drawing, so it can be rendered and checked without the live trail. */
export function Floor7DebugView({ geometry = floor7Geometry, radios = floor7Aps.radios, trail = [] }) {
  const all = geometry.walkable.flat();
  const minX = Math.min(...all.map((p) => p.x)) - PAD;
  const maxX = Math.max(...all.map((p) => p.x)) + PAD;
  const minY = Math.min(...all.map((p) => p.y)) - PAD;
  const maxY = Math.max(...all.map((p) => p.y)) + PAD;
  const last = trail[trail.length - 1];

  return (
    <svg
      data-testid="floor7-debug"
      viewBox={`${minX} ${-maxY} ${maxX - minX} ${maxY - minY}`}
      className="w-full h-auto bg-black/80 rounded-lg"
      role="img"
      aria-label="Floor 7 plan with the raw and filtered position"
    >
      {geometry.walkable.map((poly, i) => (
        <polygon key={i} points={poly.map(flip).join(' ')} fill="#10B98122" stroke="none" />
      ))}
      {geometry.walls.map((w, i) => (
        <line key={i} x1={w.a.x} y1={-w.a.y} x2={w.b.x} y2={-w.b.y} stroke="#E5E7EB" strokeWidth="0.25" strokeLinecap="round" />
      ))}
      {Object.entries(geometry.spots).map(([name, p]) => (
        <g key={name}>
          <circle cx={p.x} cy={-p.y} r="0.5" fill="#60A5FA" />
          <text x={p.x} y={-p.y - 0.9} fontSize="1.4" textAnchor="middle" fill="#93C5FD">{name}</text>
        </g>
      ))}
      {radios.map((r) => (
        <rect key={r.radio} x={r.x - 0.35} y={-r.y - 0.35} width="0.7" height="0.7" fill={r.basis === 'single-spot' ? '#F59E0B' : '#A78BFA'} opacity="0.9" transform={`rotate(45 ${r.x} ${-r.y})`} />
      ))}
      {trail.length > 1 && (
        <polyline points={trail.map((t) => flip(t.filtered)).join(' ')} fill="none" stroke="#10B981" strokeWidth="0.3" />
      )}
      {trail.map((t, i) =>
        t.raw ? <circle key={`raw${i}`} cx={t.raw.x} cy={-t.raw.y} r="0.35" fill="#FFFFFF" opacity={0.25 + (0.75 * (i + 1)) / trail.length} /> : null
      )}
      {last && (
        <>
          <circle cx={last.filtered.x} cy={-last.filtered.y} r={Math.max(last.uncertaintyM, 0.5)} fill={`${STATUS_COLOR[last.status] ?? '#10B981'}22`} stroke={STATUS_COLOR[last.status] ?? '#10B981'} strokeWidth="0.2" />
          <circle cx={last.filtered.x} cy={-last.filtered.y} r="0.7" fill={STATUS_COLOR[last.status] ?? '#10B981'} />
        </>
      )}
    </svg>
  );
}

/** The button and panel. Reads the live trail the Floor 7 tracker keeps. */
export default function Floor7DebugOverlay() {
  const [open, setOpen] = useState(false);
  const [trail, setTrail] = useState(getTrail);
  useEffect(() => subscribeTrail(() => setTrail(getTrail())), []);
  const last = trail[trail.length - 1];

  return (
    <div className="fixed left-2 bottom-24 z-[1200] font-mono text-[10px] text-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="px-2 py-1 rounded-full bg-black/80 border border-emerald-400/60 uppercase tracking-widest"
      >
        F7 {open ? 'hide' : 'debug'}
      </button>
      {open && (
        <div className="mt-1 w-[min(92vw,26rem)] p-2 rounded-lg bg-black/85 border border-white/15">
          <Floor7DebugView trail={trail} />
          <p className="mt-1">
            {last
              ? `${last.status} · ±${last.uncertaintyM.toFixed(1)} m · ${trail.length} steps`
              : 'No Floor 7 estimate yet'}
            {floor7Geometry.placeholder && <span className="text-amber-300"> · PLACEHOLDER PLAN</span>}
          </p>
          <p className="opacity-70">white = raw, green = filtered, purple/amber diamond = access point (amber: heard at one spot only)</p>
        </div>
      )}
    </div>
  );
}
