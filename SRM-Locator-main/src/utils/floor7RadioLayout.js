// Where the Floor 7 debug overlay draws each access point, and what it says about it. Plain
// functions, kept out of the component file so that one exports components only.
import { floor7Plan } from './floor7Plan.js';

/** The short name shown beside a radio: its last two bytes ("8d:8a"). */
export const radioLabel = (radio) => radio.slice(-5);

/** Radios whose spots are closer than this (px) are fanned out together. */
const CLUSTER_PX = 36;
/** The room each fanned-out marker gets along the ring (px), so labels do not touch. */
const RING_SPACING_PX = 34;

/**
 * Where to draw each access point so that every one can be seen. Many radios sit on the very
 * same spot (they were all heard best there) and some spots are only a few pixels apart, so
 * drawing each at its true position would hide most of them. Radios whose spots are within
 * CLUSTER_PX of each other (chained) are fanned out on a ring around the cluster, each tied to
 * its true spot by a line; a radio with nothing near it is drawn at its spot. Positions in
 * floor7Aps.json are plan metres before PLAN_SCALE.
 * @returns {{radio:string, label:string, x:number, y:number, ax:number, ay:number, fanned:boolean}[]}
 */
export function layoutRadios(radios, plan = floor7Plan) {
  const items = radios.map((r) => ({ r, at: plan.toSvg(r.x * plan.scale, r.y * plan.scale) }));
  const cluster = items.map((_, i) => i);
  const find = (i) => (cluster[i] === i ? i : (cluster[i] = find(cluster[i])));
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (Math.hypot(items[i].at.x - items[j].at.x, items[i].at.y - items[j].at.y) <= CLUSTER_PX) cluster[find(j)] = find(i);
    }
  }
  const groups = new Map();
  items.forEach((it, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), it]));

  const out = [];
  for (const members of groups.values()) {
    const n = members.length;
    const cx = members.reduce((sum, m) => sum + m.at.x, 0) / n;
    const cy = members.reduce((sum, m) => sum + m.at.y, 0) / n;
    const reach = n === 1 ? 0 : Math.max(26, (n * RING_SPACING_PX) / (2 * Math.PI));
    // Going round the ring in the order of the true spots keeps the leader lines from crossing.
    const ordered = [...members].sort(
      (a, b) => Math.atan2(a.at.y - cy, a.at.x - cx) - Math.atan2(b.at.y - cy, b.at.x - cx) || a.r.radio.localeCompare(b.r.radio)
    );
    ordered.forEach(({ r, at }, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
      out.push({
        radio: r.radio,
        label: radioLabel(r.radio),
        x: cx + reach * Math.cos(angle),
        y: cy + reach * Math.sin(angle),
        ax: at.x,
        ay: at.y,
        fanned: n > 1,
      });
    });
  }
  return out;
}

/** What the team should check about one radio, as short words. */
export function radioFlags(r) {
  const flags = [];
  if (r.basis === 'tie') flags.push('between two spots');
  if (r.basis === 'override') flags.push('placed by hand');
  if (r.single_spot) flags.push('heard at one spot only');
  if (r.guess?.length) flags.push('rests on a guess');
  return flags;
}
