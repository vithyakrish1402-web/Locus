import React, { useEffect, useState } from 'react';
// eslint-disable-next-line no-unused-vars -- motion is used as <motion.div>, which this config can't see
import { motion, useReducedMotion, useMotionValue, animate } from 'framer-motion';
import { BatteryLow, MoreVertical, Navigation } from 'lucide-react';
import { Avatar, IconButton } from './ui';
import { continuousAngle } from '../utils/direction';
import { PANEL_SPRING } from '../utils/motion';
import { SHOW_INDOOR_POSITION_TO_SQUAD } from '../utils/positionSource';
import { floorLabel, hasIndoorFloor } from '../utils/indoorView';
import { MEMBERS } from '../copy/group';
import { MEMBER_DOTS, memberStatus, memberWhere } from '../utils/memberStatus';

// One member in the group panel (redesign Group panel batch, piece 3), built around the
// question the list exists to answer: where are they from here? Their initials in a ring
// (dashed while Paused), a dot and their status in words, how far and which way ("120 m",
// "11 o'clock", or a compass direction without a compass reading), and an arrow turning to
// point at them. Their actions (Ping, Show on map, Find with AR Scan, and the Group Lead's
// Remove and block) are in their options sheet, opened by the ⋮ button.
//
// Display only: the stored photo is still sent with every update, just not shown here.

/** Re-renders every `ms`, so "Last update 2 min ago" keeps counting between updates. */
function useNow(ms) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** Below 25 %, the old row's red line (0 is no reading). */
const lowBattery = (battery) => Number.isFinite(battery) && battery > 0 && battery < 25;

function PointingArrow({ angle, reduceMotion }) {
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
    <span className="relative w-12 h-12 shrink-0 rounded-full bg-sunken text-accent flex items-center justify-center" aria-hidden="true">
      <motion.span className="flex" style={{ rotate }}>
        {/* lucide's Navigation arrow points up-right (45°); turned back so 0° means up. */}
        <Navigation size={20} className="-rotate-45" />
      </motion.span>
    </span>
  );
}

/**
 * @param {{ member: object, me: {lat:number,lng:number}|null, heading: number,
 *   headingLive: boolean, onOptions: (member: object) => void }} props
 */
export default function SquadMemberCard({ member, me, heading, headingLive, onOptions }) {
  const reduceMotion = useReducedMotion();
  const now = useNow(5000);
  const status = memberStatus(member, now);
  const place = memberWhere(member, me, { heading, headingLive });
  const name = member.name || '?';

  return (
    <div
      data-testid="member-row"
      onClick={() => onOptions(member)}
      className="flex items-center gap-3 p-3 rounded-2xl glass-panel font-ui text-text hover:bg-surface/90 cursor-pointer active:scale-[0.99] transition-all duration-150"
    >
      <Avatar name={name} dashed={member.status === 'FROZEN' || !member.hasFix} />
      <div className="flex-1 min-w-0">
        <h4 className="text-heading break-words">
          {name}
          {/* Low battery, as the old row's bar warned below 25 %: amber, never red. 0 is no
              reading at all, so it shows nothing. */}
          {lowBattery(member.battery) && (
            <BatteryLow size={16} className="inline-block ml-1.5 -mt-0.5 text-warning" role="img" aria-label={MEMBERS.lowBattery(member.battery)} data-testid="member-low-battery" />
          )}
        </h4>
        <p className="mt-0.5 flex items-center gap-2 text-secondary text-text-secondary" data-testid="member-status">
          <span className={`shrink-0 w-2.5 h-2.5 rounded-full ${MEMBER_DOTS[status.dot]}`} aria-hidden="true" />
          {status.text}
        </p>
        {/* WiFi Arc Stage 7: the floor they're on, while their telemetry says so (off). */}
        {SHOW_INDOOR_POSITION_TO_SQUAD && hasIndoorFloor(member) && (
          <p
            data-testid="member-floor-chip"
            className="mt-1 inline-block px-2 py-0.5 rounded-full bg-sunken text-caption text-text-secondary whitespace-nowrap"
          >
            {member.building} · {floorLabel(member.floor)}
          </p>
        )}
      </div>
      {place && (
        <div className="text-right shrink-0" data-testid="member-where">
          <p className="text-heading tabular-nums">{place.distance}</p>
          {place.direction && <p className="text-secondary text-text-secondary">{place.direction}</p>}
        </div>
      )}
      {place && !place.where.here && <PointingArrow angle={place.angle} reduceMotion={reduceMotion} />}
      <IconButton label={MEMBERS.options(name)} icon={MoreVertical} onClick={() => onOptions(member)} />
    </div>
  );
}
