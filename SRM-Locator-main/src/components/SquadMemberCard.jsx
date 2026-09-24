import React, { useEffect, useState } from 'react';
// eslint-disable-next-line no-unused-vars -- motion is used as <motion.div>, which this config can't see
import { motion, useReducedMotion, useMotionValue, animate } from 'framer-motion';
import { Activity, Ban, Crosshair, Navigation } from 'lucide-react';
import { calculateBearing, calculateDistanceMeters } from '../utils/geoMath';
import { compassPoint, continuousAngle, formatMetres, freshness, relativeClock } from '../utils/direction';
import { PANEL_SPRING } from '../utils/motion';

// One squadmate on the roster, built around the question the roster exists to answer:
// where are they from here? A dial points at them relative to the way the phone faces, the
// distance reads at a glance, and the direction is given the way you'd say it out loud
// ("3 O'CLOCK"). Without a compass reading the dial falls back to north-up and says "NE".
//
// Replaces an inline card whose distance was a small label, which offered no direction at
// all, repeated PING (an icon and a button), and used rounded corners unlike the rest.

const HERE_METRES = 15; // closer than GPS can tell apart: shown as "HERE", not a direction

const FRESH_STYLE = {
  live: { text: 'text-emerald-400', bar: 'bg-emerald-500' },
  recent: { text: 'text-emerald-400/80', bar: 'bg-emerald-500/60' },
  stale: { text: 'text-yellow-400', bar: 'bg-yellow-500' },
  lost: { text: 'text-red-400', bar: 'bg-red-500' },
  none: { text: 'text-zinc-500', bar: 'bg-zinc-700' },
};

/** Re-renders every `ms`, so "12s AGO" keeps counting between telemetry updates. */
function useNow(ms) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

function BearingDial({ angle, here, northUp, reduceMotion }) {
  // The arrow's live rotation. Each new angle is put on the same unwrapped scale as where
  // the arrow is right now, so it always turns the short way (359° -> 1° is 2°, not 358°),
  // and the spring starts from its current position and speed if it is still moving.
  const rotate = useMotionValue(angle);
  useEffect(() => {
    const next = continuousAngle(rotate.get(), angle);
    if (reduceMotion) { rotate.set(next); return undefined; }
    const controls = animate(rotate, next, PANEL_SPRING);
    return () => controls.stop();
  }, [angle, reduceMotion, rotate]);

  return (
    <div className="relative w-14 h-14 shrink-0" aria-hidden="true">
      <div className="absolute inset-0 rounded-full border border-white/15 bg-black" />
      <div className="absolute inset-[5px] rounded-full border border-dashed border-white/10" />
      {/* The phone's own "ahead", or north when the dial is north-up. */}
      <span className="absolute left-1/2 top-0.5 -translate-x-1/2 font-dot text-[7px] text-zinc-500">{northUp ? 'N' : '▲'}</span>
      {here ? (
        <span className="absolute inset-[18px] rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.9)] locus-soft-ring-dot" />
      ) : (
        <motion.div className="absolute inset-0 flex items-center justify-center" style={{ rotate }}>
          {/* lucide's Navigation arrow points up-right (45°); turned back so 0° means up. */}
          <Navigation size={20} className="text-red-500 drop-shadow-[0_0_6px_rgba(239,68,68,0.8)] -rotate-45" fill="currentColor" />
        </motion.div>
      )}
    </div>
  );
}

export default function SquadMemberCard({ member, me, heading, headingLive, isOwner, onPing, onBlock, onAR, onTrack }) {
  const reduceMotion = useReducedMotion();
  const now = useNow(5000);
  const fresh = freshness(member.lastSeen, now);
  const style = FRESH_STYLE[fresh.level];
  const located = member.hasFix && me && Number.isFinite(member.lat) && Number.isFinite(member.lng);

  let distance = null;
  let bearing = null;
  if (located) {
    distance = calculateDistanceMeters(me.lat, me.lng, member.lat, member.lng);
    bearing = calculateBearing(me.lat, me.lng, member.lat, member.lng);
  }
  const here = Number.isFinite(distance) && distance < HERE_METRES;
  const shownDistance = formatMetres(distance);
  const clock = headingLive ? relativeClock(bearing, heading) : null;
  const direction = here ? 'WITH YOU' : clock?.label ?? (bearing !== null ? `BEARING ${compassPoint(bearing)}` : null);
  // Relative to the phone when the compass works; otherwise north-up.
  const angle = bearing === null ? 0 : headingLive ? bearing - heading : bearing;

  return (
    <div className="relative mb-2 border border-white/10 bg-zinc-950 overflow-hidden">
      <span className={`absolute left-0 top-0 bottom-0 w-[3px] ${style.bar}`} aria-hidden="true" />

      <div className="p-4 pl-5">
        {/* Who */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 flex items-center justify-center font-dot text-sm border overflow-hidden shrink-0 border-emerald-500/70 text-emerald-400 bg-emerald-500/10">
              {member.photo ? <img src={member.photo} className="w-full h-full object-cover" alt="" /> : (member.name || '?').charAt(0)}
            </div>
            <div className="min-w-0">
              <h4 className="font-dot text-sm uppercase tracking-widest text-white leading-none truncate">{member.name}</h4>
              <p className={`mt-1 font-dot text-[10px] uppercase tracking-widest ${style.text}`}>
                {fresh.level === 'live' && <span className="inline-block w-1.5 h-1.5 mr-1.5 rounded-full bg-emerald-400 align-middle locus-live-dot" />}
                {fresh.text}
                {member.role ? <span className="text-zinc-600"> · {member.role}</span> : null}
              </p>
            </div>
          </div>
          {isOwner && (
            <button type="button" onClick={() => onBlock(member.id)} className="p-2 text-zinc-600 hover:text-red-500 shrink-0" title="Instant Ban">
              <Ban size={16} />
            </button>
          )}
        </div>

        {/* Where */}
        {located ? (
          <div className="mt-4 flex items-center gap-4">
            <BearingDial angle={angle} here={here} northUp={!headingLive} reduceMotion={reduceMotion} />
            <div className="min-w-0">
              <p className="font-dot leading-none text-white">
                <span className="text-3xl tracking-wider">{here ? '<15' : shownDistance.value}</span>
                <span className="ml-1 text-xs text-zinc-400">{shownDistance.unit}</span>
              </p>
              <p className="mt-1.5 font-dot text-[10px] uppercase tracking-widest text-red-400">{direction}</p>
            </div>
            <div className="ml-auto flex flex-col items-end gap-1 font-dot text-[10px] uppercase tracking-widest text-zinc-400">
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-3 border border-zinc-500 rounded-[1px] relative flex items-end overflow-hidden">
                  <span className={`w-full ${member.battery < 25 ? 'bg-red-500' : 'bg-emerald-500'}`} style={{ height: `${member.battery || 0}%` }} />
                </span>
                {member.battery || 0}%
              </span>
              <span className="flex items-center gap-1.5"><Activity size={11} className="text-blue-400" />{member.speed || 0} KM/H</span>
            </div>
          </div>
        ) : (
          // On the roster, but nothing to aim at yet: no coordinates have come through for
          // them. Says so instead of offering buttons that would point at nothing.
          <div className="mt-4 w-full py-3 border border-dashed border-white/20 text-zinc-500 font-dot text-xs uppercase tracking-widest text-center">
            AWAITING_GPS_FIX
          </div>
        )}

        {/* What to do */}
        <div className="mt-4 flex gap-2">
          {/* A ping, not an emergency: the squad-wide SOS is the SosTrigger button. */}
          <button
            type="button"
            onClick={() => onPing(member.id)}
            className="flex-1 py-2.5 border border-white/20 bg-white/5 text-zinc-300 font-dot text-[10px] uppercase tracking-widest hover:bg-white hover:text-black"
          >
            PING
          </button>
          {located && (
            <>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onAR(member); }}
                className="w-11 flex items-center justify-center border border-white/30 bg-black text-white hover:border-red-500 hover:text-red-500"
                title="AR Tracking"
              >
                <Crosshair size={14} />
              </button>
              <button
                type="button"
                onClick={() => onTrack(member)}
                className="flex-1 py-2.5 border border-white/30 text-white font-dot text-[10px] uppercase tracking-widest hover:bg-white hover:text-black"
              >
                TRACK_TARGET
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
