// A member's status and whereabouts in words, for their row in the group panel and their
// options sheet (components/SquadMemberCard.jsx, components/group/MemberOptions.jsx).
import { freshness, locateTarget } from './direction';
import { directionLabel, distanceLabel } from '../copy/place';
import { MEMBERS } from '../copy/group';

/**
 * What a member's dot and words say: their mode, how recent their location is, or that none
 * has come yet. Amber for a location going stale, never red.
 * @returns {{ text: string, dot: 'live'|'paused'|'stale'|'none' }}
 */
export function memberStatus(member, now = Date.now()) {
  if (!member.hasFix) return { text: MEMBERS.waiting, dot: 'none' };
  if (member.status === 'FROZEN') return { text: MEMBERS.paused, dot: 'paused' };
  const fresh = freshness(member.lastSeen, now);
  if (fresh.level === 'live' || fresh.level === 'recent') return { text: MEMBERS.liveNow, dot: 'live' };
  if (fresh.level === 'none') return { text: MEMBERS.live, dot: 'live' };
  return { text: MEMBERS.lastUpdate(Math.floor((now - member.lastSeen) / 60000)), dot: 'stale' };
}

export const MEMBER_DOTS = {
  live: 'bg-success',
  paused: 'bg-warning',
  stale: 'bg-warning',
  none: 'border border-dashed border-border-control',
};

/** Where a member is from here, in words: "120 m" and "11 o'clock" (or "With you"). */
export function memberWhere(member, me, { heading, headingLive }) {
  const located = member.hasFix && me && Number.isFinite(member.lat) && Number.isFinite(member.lng);
  if (!located) return null;
  const where = locateTarget(me, member, { heading, headingLive });
  return {
    where,
    distance: where.here ? MEMBERS.withYou : distanceLabel(where.shownDistance),
    direction: where.here ? '' : directionLabel(where),
    // Relative to the phone when the compass works; otherwise north-up.
    angle: headingLive ? where.bearing - heading : where.bearing,
  };
}

