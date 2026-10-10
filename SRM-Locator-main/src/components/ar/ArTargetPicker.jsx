import React, { useState } from 'react';
import { Check, Flag, MapPin, Search } from 'lucide-react';
import { Avatar, Sheet } from '../ui';
import { locateTarget } from '../../utils/direction';
import { arTargetForMember } from '../../utils/arTags';
import { distanceLabel } from '../../copy/place';
import { AR_PICKER } from '../../copy/arScan';
import { LAYER } from '../../utils/layers';

// What AR Scan finds (redesign AR Scan batch, piece 4): a sheet over AR Scan, opened from its
// "Finding" pill. People in your group first (those with a location, nearest first), then
// places: the group's meeting point if there is one, then the buildings, nearest first. Search
// narrows both. Choosing one aims AR Scan the way the app's own AR buttons do (a member by
// arTargetForMember, so AR Scan follows them as they move; a place by its spot and name).

const near = (me, item) => {
  const where = locateTarget(me, item);
  return where ? where.distance : Infinity;
};
const sameTarget = (a, b) => Boolean(a && b) && (
  (a.memberUid && a.memberUid === b.memberUid)
  || (a.memberId && a.memberId === b.memberId)
  || (!a.memberUid && !a.memberId && !b.memberUid && !b.memberId && a.lat === b.lat && a.lng === b.lng)
);

/**
 * @param {{ open: boolean, onClose: () => void, me: object|null, target: object,
 *   members: object[], buildings: object[], meetingPoint: object|null, selfUid: string|null,
 *   onChoose: (target: object) => void }} props
 */
export default function ArTargetPicker({ open, onClose, me, target, members, buildings, meetingPoint, selfUid, onChoose }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const matches = (name) => (name || '').toLowerCase().includes(q);

  const people = members
    .filter((m) => m && m.hasFix && Number.isFinite(m.lat) && Number.isFinite(m.lng) && !(selfUid && m.uid === selfUid) && matches(m.name))
    .map((m) => ({ key: `member-${m.id}`, kind: 'member', name: m.name || '?', target: arTargetForMember(m), d: near(me, m) }))
    .sort((a, b) => a.d - b.d);
  const places = [
    ...(meetingPoint && (matches(AR_PICKER.meetingPoint) || matches(meetingPoint.name))
      ? [{ key: 'meeting-point', kind: 'meeting', name: meetingPoint.name && meetingPoint.name !== 'RALLY POINT' ? AR_PICKER.meetingPointAt(meetingPoint.name) : AR_PICKER.meetingPoint, target: { lat: meetingPoint.lat, lng: meetingPoint.lng, name: meetingPoint.name }, d: near(me, meetingPoint) }]
      : []),
    ...buildings
      .filter((b) => Number.isFinite(b.lat) && Number.isFinite(b.lng) && matches(b.name))
      .map((b) => ({ key: `building-${b.id}`, kind: 'building', name: b.name, target: { lat: b.lat, lng: b.lng, name: b.name }, d: near(me, b) }))
      .sort((a, b) => a.d - b.d),
  ];

  const choose = (item) => {
    onChoose(item.target);
    setQuery('');
    onClose();
  };

  const row = (item) => {
    const current = sameTarget(item.target, target);
    const where = Number.isFinite(item.d) ? distanceLabel(locateTarget(me, item.target)?.shownDistance) : '';
    return (
      <button
        key={item.key}
        type="button"
        data-testid="ar-picker-row"
        aria-current={current || undefined}
        onClick={() => choose(item)}
        className={`w-full flex items-center gap-4 py-3 border-b border-border text-left font-ui ${current ? 'text-accent' : 'text-text'}`}
      >
        {item.kind === 'member'
          ? <Avatar name={item.name} />
          : <span className="w-[var(--size-avatar)] flex justify-center shrink-0" aria-hidden="true">{item.kind === 'meeting' ? <Flag size={22} /> : <MapPin size={22} />}</span>}
        <span className="flex-1 min-w-0 text-body truncate">{item.name}</span>
        {where && <span className="shrink-0 text-secondary text-text-secondary tabular-nums">{where}</span>}
        <span className="w-6 shrink-0 flex justify-center" aria-hidden="true">{current && <Check size={20} />}</span>
        {current && <span className="sr-only">{AR_PICKER.current}</span>}
      </button>
    );
  };

  // The sheet ends its content 1 rem above the Emergency button (--emergency-clearance); the
  // list adds 1 rem more, so its last rows scroll 2 rem clear of it, like the buildings list.
  return (
    <Sheet open={open} onClose={onClose} title={AR_PICKER.title} layer={LAYER.arScanSheet}>
      <div data-testid="ar-target-picker" className="px-4 pb-4 flex flex-col">
        <label className="relative block mb-2">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none" size={18} aria-hidden="true" />
          <input
            type="search"
            aria-label={AR_PICKER.search}
            placeholder={AR_PICKER.search}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full min-h-12 rounded-input border border-border-control bg-surface pl-11 pr-4 font-ui text-body text-text placeholder:text-text-secondary focus:outline-2 focus:outline-offset-2 focus:outline-accent"
          />
        </label>
        {people.length > 0 && (
          <section aria-label={AR_PICKER.people}>
            <h3 className="pt-3 pb-1 font-ui text-secondary font-semibold text-text-secondary">{AR_PICKER.people}</h3>
            {people.map(row)}
          </section>
        )}
        {places.length > 0 && (
          <section aria-label={AR_PICKER.places}>
            <h3 className="pt-4 pb-1 font-ui text-secondary font-semibold text-text-secondary">{AR_PICKER.places}</h3>
            {places.map(row)}
          </section>
        )}
        {people.length === 0 && places.length === 0 && (
          <p className="py-6 font-ui text-body text-text-secondary text-center" data-testid="ar-picker-nothing">{AR_PICKER.nothing(query.trim())}</p>
        )}
      </div>
    </Sheet>
  );
}
