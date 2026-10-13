import { useEffect, useState } from 'react';
import floor7Aps from '../data/floor7Aps.json';
import planDrawingSvg from '../../floor7-inputs/floor7_plan_v3.svg?raw';
import { getTrail, subscribeTrail } from '../utils/floor7Demo.js';
import { PLAN_SCALE, PLAN_SVG, floor7Plan } from '../utils/floor7Plan.js';

// Floor 7 alignment check, for the test build only (rendered under FLOOR7_DEMO, owner only):
// the team's drawing of the floor with the corridor centrelines, where each access point was
// placed, and the track: the raw WiFi estimate, the same estimate snapped onto the nearest
// corridor, and the filtered position. Lets the team see by eye whether the plan lines up with
// where people really stood. Nothing here reaches a squad or a user.

const STATUS_COLOR = { tracking: '#10B981', rejected: '#F59E0B', reacquiring: '#F97316' };
const RAW = '#1B2630';
const SNAPPED = '#0EA5E9';
const CENTRELINE = '#2E5E8A';
// Read as text and inlined, not imported as a file: a file import is emitted into every
// build's output even where this code is left out, which the build check (floor7Build.test.js) forbids.
const PLAN_DRAWING = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(planDrawingSvg)}`;

/** Pure drawing, so it can be rendered and checked without the live trail. */
export function Floor7DebugView({ plan = floor7Plan, radios = floor7Aps.radios, trail = [] }) {
  const px = (p) => plan.toSvg(p.x, p.y);
  const pxPerM = PLAN_SVG.pxPerM / plan.scale;
  const last = trail[trail.length - 1];
  const lastAt = last && px(last.filtered);
  const color = STATUS_COLOR[last?.status] ?? STATUS_COLOR.tracking;

  return (
    <svg
      data-testid="floor7-debug"
      viewBox={`0 0 ${PLAN_SVG.width} ${PLAN_SVG.height}`}
      className="w-full h-auto rounded-lg"
      role="img"
      aria-label="Floor 7 plan with the raw, snapped and filtered position"
    >
      <image href={PLAN_DRAWING} x="0" y="0" width={PLAN_SVG.width} height={PLAN_SVG.height} />
      {plan.centrelines.map((c) => (
        <polyline
          key={c.id}
          data-centreline={c.id}
          points={c.points.map((p) => `${px(p).x},${px(p).y}`).join(' ')}
          fill="none"
          stroke={CENTRELINE}
          strokeWidth="3"
          opacity="0.8"
        />
      ))}
      {radios.map((r) => {
        const p = px(r);
        return (
          <rect key={r.radio} x={p.x - 5} y={p.y - 5} width="10" height="10" fill={r.basis === 'single-spot' ? '#F59E0B' : '#A78BFA'} opacity="0.9" transform={`rotate(45 ${p.x} ${p.y})`} />
        );
      })}
      {trail.length > 1 && (
        <polyline data-track="filtered" points={trail.map((t) => `${px(t.filtered).x},${px(t.filtered).y}`).join(' ')} fill="none" stroke={STATUS_COLOR.tracking} strokeWidth="4" />
      )}
      {trail.map((t, i) => {
        const opacity = 0.25 + (0.75 * (i + 1)) / trail.length;
        const raw = px(t.raw);
        const snapped = t.snapped && px(t.snapped);
        return (
          <g key={i} opacity={opacity}>
            {snapped && <line data-snap-link x1={raw.x} y1={raw.y} x2={snapped.x} y2={snapped.y} stroke={SNAPPED} strokeWidth="1.5" strokeDasharray="3 3" />}
            <circle data-dot="raw" cx={raw.x} cy={raw.y} r="5" fill="none" stroke={RAW} strokeWidth="2" />
            {snapped && <circle data-dot="snapped" cx={snapped.x} cy={snapped.y} r="5" fill={SNAPPED} />}
          </g>
        );
      })}
      {last && (
        <>
          <circle data-dot="uncertainty" cx={lastAt.x} cy={lastAt.y} r={Math.max(last.uncertaintyM * pxPerM, 10)} fill={`${color}22`} stroke={color} strokeWidth="2" />
          <circle data-dot="current" cx={lastAt.x} cy={lastAt.y} r="9" fill={color} stroke="#FFFFFF" strokeWidth="2" />
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
            <span className="text-amber-300"> · scale ESTIMATED ×{PLAN_SCALE}</span>
          </p>
          <p className="opacity-70">
            circle = raw, blue dot = snapped to the corridor, green = filtered, purple/amber diamond = access point (amber: heard at one spot only)
          </p>
        </div>
      )}
    </div>
  );
}
