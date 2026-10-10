import React, { useState } from 'react';
import { Ban, MapPin, Radio, ScanLine } from 'lucide-react';
import { Avatar, Button, ListRow, Sheet } from '../ui';
import { memberStatus, memberWhere } from '../../utils/memberStatus';
import { MEMBERS, MEMBER_OPTIONS, REMOVE_AND_BLOCK, firstName } from '../../copy/group';

// A member's options (redesign Group panel batch, piece 3): the actions their card used to
// carry as buttons, in one sheet. Ping, for anyone; Show on map and Find with AR Scan, once
// they have a location to aim at; and, for the Group Lead only, Remove and block, in red,
// behind its own confirmation (it used to be a one-tap "Instant Ban"). The vote to remove is
// planned, not built, so it isn't offered.

/**
 * @param {{ member: object|null, me: object|null, heading: number, headingLive: boolean,
 *   isLead: boolean, onClose: () => void, onPing: (id: string) => void,
 *   onShowOnMap: (member: object) => void, onArScan: (member: object) => void,
 *   onRemoveAndBlock: (id: string) => void }} props
 *   member: whose options are open, or null when closed
 */
export default function MemberOptions({ member, me, heading, headingLive, isLead, onClose, onPing, onShowOnMap, onArScan, onRemoveAndBlock }) {
  const [confirming, setConfirming] = useState(null);
  const shown = member ?? confirming;
  const name = shown?.name || '?';
  const first = firstName(shown?.name);

  const status = shown ? memberStatus(shown) : null;
  const place = shown ? memberWhere(shown, me, { heading, headingLive }) : null;
  const facts = [status?.text, place?.distance, place?.direction].filter(Boolean).join(' · ');
  const battery = Number.isFinite(shown?.battery) && shown.battery > 0 ? MEMBERS.battery(shown.battery) : null;
  const speed = shown?.speed > 0 ? MEMBERS.speed(shown.speed) : null;
  const extras = [battery, speed].filter(Boolean).join(' · ');

  const act = (fn) => () => { fn(member); onClose(); };

  return (
    <>
      <Sheet open={Boolean(member)} onClose={onClose} label={MEMBERS.options(name)}>
        <div data-testid="member-options" className="px-4 flex flex-col">
          <div className="flex items-center gap-3 pb-3 border-b border-border">
            <Avatar name={name} dashed={shown?.status === 'FROZEN' || !shown?.hasFix} />
            <div className="min-w-0">
              <p className="text-heading truncate">{name}</p>
              <p className="text-secondary text-text-secondary">{facts}</p>
              {extras && <p className={`text-secondary ${shown?.battery > 0 && shown.battery < 25 ? 'text-warning' : 'text-text-secondary'}`}>{extras}</p>}
            </div>
          </div>
          <ListRow leading={<Radio size={20} />} title={MEMBER_OPTIONS.ping(first)} onClick={act((m) => onPing(m.id))} />
          {place && (
            <>
              <ListRow leading={<MapPin size={20} />} title={MEMBER_OPTIONS.showOnMap} onClick={act(onShowOnMap)} />
              <ListRow leading={<ScanLine size={20} />} title={MEMBER_OPTIONS.arScan} onClick={act(onArScan)} />
            </>
          )}
          {isLead && (
            <ListRow
              danger
              leading={<Ban size={20} />}
              title={MEMBER_OPTIONS.removeAndBlock}
              onClick={() => { setConfirming(member); onClose(); }}
            />
          )}
          <Button variant="secondary" block className="mt-3" onClick={onClose}>{MEMBER_OPTIONS.cancel}</Button>
        </div>
      </Sheet>

      {/* Remove and block, confirmed: the old one-tap ban, now two deliberate taps. */}
      <Sheet open={Boolean(confirming)} onClose={() => setConfirming(null)} label={REMOVE_AND_BLOCK.title(confirming?.name || '?')}>
        <div data-testid="remove-and-block-confirm" className="px-5 flex flex-col gap-4">
          <span className="flex items-center justify-center w-14 h-14 rounded-full bg-danger-soft text-danger" aria-hidden="true">
            <Ban size={26} />
          </span>
          <div className="flex flex-col gap-2">
            <h2 className="text-title">{REMOVE_AND_BLOCK.title(confirming?.name || '?')}</h2>
            <p className="text-body text-text-secondary">{REMOVE_AND_BLOCK.body(firstName(confirming?.name))}</p>
          </div>
          <Button
            variant="danger"
            size="large"
            block
            onClick={() => { const id = confirming.id; setConfirming(null); onRemoveAndBlock(id); }}
          >
            {REMOVE_AND_BLOCK.confirm}
          </Button>
          <Button variant="plain" block onClick={() => setConfirming(null)}>{REMOVE_AND_BLOCK.cancel}</Button>
        </div>
      </Sheet>
    </>
  );
}
