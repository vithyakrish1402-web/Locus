import React, { useEffect, useState } from 'react';
import { Ban, Heart, HeartOff, MapPin, Navigation, Radio, ScanLine, ShieldCheck, ShieldOff, UserMinus } from 'lucide-react';
import { Avatar, Button, ListRow, Sheet } from '../ui';
import { memberStatus, memberWhere } from '../../utils/memberStatus';
import { pushBackHandler } from '../../utils/backHandlers';
import { FRIENDS, MEMBERS, MEMBER_OPTIONS, REMOVE_AND_BLOCK, REMOVE_MEMBER, firstName } from '../../copy/group';

// A member's options: solid opaque bottom sheet without glassmorphism.
// Provides their live info, Navigate to them, Ping, Show on map, Find with AR Scan, and, for
// whoever may (App.jsx decides by role, backend/groupRoles.js has the rules), Remove and
// (the Group Lead only, with `onRemoveAndBlock`) Remove and block behind a confirmation, and
// the Group Lead's Make / Remove moderator.

/**
 * @param {{ member: object|null, me: object|null, heading: number, headingLive: boolean,
 *   isLead: boolean, onClose: () => void, onNavigate?: (member: object) => void, onPing: (id: string) => void,
 *   onShowOnMap: (member: object) => void, onArScan: (member: object) => void,
 *   onRemoveAndBlock?: (id: string) => void, onRemove?: (id: string) => void,
 *   moderator?: { is: boolean, onChange: (member: object, on: boolean) => void },
 *   friend?: { status: 'none'|'sent'|'asked'|'friends', onAdd: Function, onAccept: Function, onRemove: Function } }} props
 *   member: whose options are open, or null when closed
 *   isLead: whether this person may remove `member` (the Group Lead, or a moderator for a member)
 *   moderator: only for the Group Lead, about someone who can be made a moderator
 *   friend: trusted friends with this member (utils/friends.js), when they can be
 */
export default function MemberOptions({ member, me, heading, headingLive, isLead, onClose, onNavigate, onPing, onShowOnMap, onArScan, onRemoveAndBlock, onRemove, moderator, friend }) {
  // { member, block }: the removal waiting on its confirmation.
  const [confirmingRemoval, setConfirming] = useState(null);
  const confirming = confirmingRemoval?.member ?? null;
  const blocking = confirmingRemoval?.block ?? true;
  const removal = blocking ? REMOVE_AND_BLOCK : REMOVE_MEMBER;
  const shown = member ?? confirming;
  // Back with "Remove …?" open closes it, and only it. The options sheet has closed by then, so
  // App's Back ladder skipped the confirmation and closed whatever was under it (the group
  // panel), leaving the question on screen.
  useEffect(() => {
    if (!confirming) return undefined;
    return pushBackHandler(() => { setConfirming(null); return true; });
  }, [confirming]);
  const name = shown?.name || '?';
  const first = firstName(shown?.name);

  const status = shown ? memberStatus(shown) : null;
  const place = shown ? memberWhere(shown, me, { heading, headingLive }) : null;
  const facts = [status?.text, place?.distance, place?.direction].filter(Boolean).join(' · ');
  const battery = Number.isFinite(shown?.battery) && shown.battery > 0 ? MEMBERS.battery(shown.battery) : null;
  const speed = shown?.speed > 0 ? MEMBERS.speed(shown.speed) : null;
  const extras = [battery, speed].filter(Boolean).join(' · ');

  const act = (fn) => () => { fn(member); onClose(); };

  // A solid panel, no glass. Theme colours only: it used to be a fixed dark grey whose `dark:`
  // shade followed the phone, under rows whose text follows the app's theme, so in Light every
  // row title was dark ink on dark grey (about 1:1).
  const solidPanelClass = 'bg-surface border-t border-border shadow-[var(--shadow-3)]';

  return (
    <>
      <Sheet open={Boolean(member)} onClose={onClose} label={MEMBERS.options(name)} panelClassName={solidPanelClass}>
        <div data-testid="member-options" className="px-4 flex flex-col">
          <div className="flex items-center gap-3.5 pb-3.5 border-b border-border">
            <Avatar name={name} dashed={shown?.status === 'FROZEN' || !shown?.hasFix} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-heading truncate font-semibold text-text">{name}</p>
                {shown?.status === 'GHOST' ? (
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-warning-soft text-warning border border-warning/30">
                    Signal lost
                  </span>
                ) : (
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-success-soft text-success border border-success/30">
                    {status?.text || 'Active'}
                  </span>
                )}
              </div>
              <p className="text-secondary text-text-secondary mt-0.5">{facts || 'Location tracking active'}</p>
            </div>
          </div>

          {/* Quick telemetry stat chips */}
          <div className="grid grid-cols-3 gap-2 py-3 border-b border-border">
            <div className="flex flex-col items-center justify-center p-2 rounded-xl bg-sunken border border-border text-center">
              <span className="text-[10px] text-text-secondary font-medium uppercase tracking-wider">Distance</span>
              <span className="text-xs font-bold text-text mt-0.5">{place?.distance || '—'}</span>
            </div>
            <div className="flex flex-col items-center justify-center p-2 rounded-xl bg-sunken border border-border text-center">
              <span className="text-[10px] text-text-secondary font-medium uppercase tracking-wider">Battery</span>
              <span className={`text-xs font-bold mt-0.5 ${shown?.battery > 0 && shown.battery < 25 ? 'text-warning' : 'text-text'}`}>
                {Number.isFinite(shown?.battery) && shown.battery > 0 ? `${shown.battery}%` : '—'}
              </span>
            </div>
            <div className="flex flex-col items-center justify-center p-2 rounded-xl bg-sunken border border-border text-center">
              <span className="text-[10px] text-text-secondary font-medium uppercase tracking-wider">Speed</span>
              <span className="text-xs font-bold text-text mt-0.5">
                {shown?.speed > 0 ? `${Math.round(shown.speed)} km/h` : '0 km/h'}
              </span>
            </div>
          </div>

          <div className="flex flex-col divide-y divide-border">
            {onNavigate && (shown?.lat != null && shown?.lng != null) && (
              <ListRow
                leading={<Navigation size={20} className="text-blue-600 dark:text-blue-400" />}
                title={MEMBER_OPTIONS.navigate(first)}
                description={place ? `${place.distance} away · live directions` : 'Set destination & navigate'}
                onClick={act(onNavigate)}
              />
            )}
            <ListRow
              leading={<Radio size={20} className="text-emerald-600 dark:text-emerald-400" />}
              title={MEMBER_OPTIONS.ping(first)}
              description="Transmit sonar ping to their device"
              onClick={act((m) => onPing(m.id))}
            />
            {place && (
              <>
                <ListRow
                  leading={<MapPin size={20} className="text-amber-600 dark:text-amber-400" />}
                  title={MEMBER_OPTIONS.showOnMap}
                  description="Center and zoom on member position"
                  onClick={act(onShowOnMap)}
                />
                <ListRow
                  leading={<ScanLine size={20} className="text-purple-600 dark:text-purple-400" />}
                  title={MEMBER_OPTIONS.arScan}
                  description="Scan surroundings using AR camera"
                  onClick={act(onArScan)}
                />
              </>
            )}
            {friend && friend.status === 'none' && (
              <ListRow leading={<Heart size={20} />} title={FRIENDS.add} description={FRIENDS.addHelp} onClick={act(friend.onAdd)} />
            )}
            {friend && friend.status === 'asked' && (
              <ListRow leading={<Heart size={20} />} title={FRIENDS.acceptRequest} description={FRIENDS.acceptHelp} onClick={act(friend.onAccept)} />
            )}
            {friend && friend.status === 'sent' && (
              <ListRow leading={<HeartOff size={20} />} title={FRIENDS.sent} description={FRIENDS.sentHelp} onClick={act(friend.onRemove)} />
            )}
            {friend && friend.status === 'friends' && (
              <ListRow leading={<HeartOff size={20} />} title={FRIENDS.remove} description={FRIENDS.removeHelp} onClick={act(friend.onRemove)} />
            )}
            {moderator && (
              <ListRow
                leading={moderator.is ? <ShieldOff size={20} /> : <ShieldCheck size={20} />}
                title={moderator.is ? MEMBER_OPTIONS.removeModerator : MEMBER_OPTIONS.makeModerator}
                description={moderator.is ? MEMBER_OPTIONS.removeModeratorHelp : MEMBER_OPTIONS.makeModeratorHelp}
                onClick={() => { moderator.onChange(member, !moderator.is); onClose(); }}
              />
            )}
            {isLead && onRemove && (
              <ListRow
                danger
                leading={<UserMinus size={20} />}
                title={MEMBER_OPTIONS.remove}
                description={MEMBER_OPTIONS.removeHelp}
                onClick={() => { setConfirming({ member, block: false }); onClose(); }}
              />
            )}
            {isLead && onRemoveAndBlock && (
              <ListRow
                danger
                leading={<Ban size={20} />}
                title={MEMBER_OPTIONS.removeAndBlock}
                description={MEMBER_OPTIONS.removeAndBlockHelp}
                onClick={() => { setConfirming({ member, block: true }); onClose(); }}
              />
            )}
          </div>
          <Button variant="secondary" block className="mt-3.5 mb-2" onClick={onClose}>
            {MEMBER_OPTIONS.cancel}
          </Button>
        </div>
      </Sheet>

      {/* Remove, or remove and block, confirmed: solid opaque */}
      <Sheet open={Boolean(confirming)} onClose={() => setConfirming(null)} label={removal.title(confirming?.name || '?')} panelClassName={solidPanelClass}>
        <div data-testid={blocking ? 'remove-and-block-confirm' : 'remove-confirm'} className="px-5 flex flex-col gap-4">
          <span className="flex items-center justify-center w-14 h-14 rounded-full bg-danger-soft text-danger" aria-hidden="true">
            {blocking ? <Ban size={26} /> : <UserMinus size={26} />}
          </span>
          <div className="flex flex-col gap-2">
            <h2 className="text-title">{removal.title(confirming?.name || '?')}</h2>
            <p className="text-body text-text-secondary">{removal.body(firstName(confirming?.name))}</p>
          </div>
          <Button
            variant="danger"
            size="large"
            block
            onClick={() => {
              const id = confirming.id;
              setConfirming(null);
              if (blocking) onRemoveAndBlock(id);
              else onRemove(id);
            }}
          >
            {removal.confirm}
          </Button>
          <Button variant="plain" block onClick={() => setConfirming(null)}>{removal.cancel}</Button>
        </div>
      </Sheet>
    </>
  );
}
