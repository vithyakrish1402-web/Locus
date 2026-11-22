import React, { useEffect, useState } from 'react';
import { Check, Radar, Users } from 'lucide-react';
import { Avatar, Button, Card, InlineMessage, Sheet, Switch } from '../ui';
import { NEARBY } from '../../copy/group';
import { useNow } from '../../hooks/useNow';
import { countdownLabel, msLeft } from '../../utils/timedPrivacy';
import { INVITE_ACCEPT_ARM_MS } from '../../utils/nearby';

// Nearby Join (Stage 6): the lobby's opt-in, the indicator while it is on, the presser's list, and
// an invite. Names only, never where anyone is; nobody joins without their own tap.

/** The lobby's opt-in: "Let people nearby find me", with what it does and why it asks for location. */
export function DiscoverableToggle({ on, starting = false, onChange }) {
  return (
    <Card className="mt-5" data-testid="discoverable-toggle">
      <Switch label={NEARBY.toggle} description={NEARBY.toggleHelp} checked={on} onChange={onChange} />
      <p className="px-4 pb-3 text-caption text-text-secondary">{starting ? NEARBY.finding : NEARBY.permissionHelp}</p>
    </Card>
  );
}

/** Shown all the while the person can be found, with a one-tap off. */
export function DiscoverableIndicator({ onOff }) {
  return (
    <div data-testid="discoverable-indicator" role="status" className="flex items-center gap-2 self-start rounded-full bg-accent-soft text-accent pl-3 pr-1 py-1 font-ui text-label">
      <Radar size={16} aria-hidden="true" />
      <span className="font-medium">{NEARBY.visible}</span>
      <Button variant="plain" className="!min-h-8 px-3 text-accent" onClick={onOff}>{NEARBY.turnOff}</Button>
    </div>
  );
}

/** The Nearby button: for the Group Lead and moderators in a group, or in the lobby to start one. */
export function NearbyButton({ onClick, label = NEARBY.button }) {
  return (
    <Button variant="tonal" block icon={Radar} onClick={onClick} data-testid="nearby-button">{label}</Button>
  );
}

const STATE_WORDS = { rough: NEARBY.tooRough, limited: NEARBY.tooMany, unreachable: NEARBY.unreachable };

/**
 * The presser's list: names only, each selectable, Invite selected and Add all, and what each
 * invite came to. Says plainly that each person still has to accept.
 * @param {{ open: boolean, onClose: () => void, state: string, rows: Array<object>,
 *   onScan: () => void, onToggle: (id: string) => void, onInvite: (ids: string[]) => void, onInviteAll: () => void }} props
 */
export function NearbySheet({ open, onClose, state, rows, onScan, onToggle, onInvite, onInviteAll }) {
  const waiting = rows.filter((row) => row.status === 'idle');
  const selected = waiting.filter((row) => row.selected).map((row) => row.id);
  const scanning = state === 'scanning';
  return (
    <Sheet open={open} onClose={onClose} title={NEARBY.title}>
      <div data-testid="nearby-sheet" className="px-4 flex flex-col gap-3">
        <p className="text-secondary text-text-secondary" data-testid="nearby-each-accepts">{NEARBY.eachAccepts}</p>
        {scanning && <p className="text-body text-text-secondary" role="status">{NEARBY.scanning}</p>}
        {STATE_WORDS[state] && <div data-testid="nearby-state"><InlineMessage tone="info">{STATE_WORDS[state]}</InlineMessage></div>}
        {state === 'done' && rows.length === 0 && (
          <div className="py-6 flex flex-col items-center text-center gap-3" data-testid="nearby-empty">
            <span className="flex items-center justify-center w-14 h-14 rounded-full bg-accent-soft text-accent" aria-hidden="true">
              <Users size={26} />
            </span>
            <p className="text-body text-text-secondary">{NEARBY.empty}</p>
          </div>
        )}
        {rows.length > 0 && (
          <ul className="flex flex-col gap-2" data-testid="nearby-list">
            {rows.map((row) => (
              <li key={row.id}>
                {row.status === 'idle' ? (
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={row.selected}
                    aria-label={NEARBY.select(row.name)}
                    onClick={() => onToggle(row.id)}
                    data-testid="nearby-row"
                    className={`w-full flex items-center gap-3 p-3 rounded-2xl glass-panel text-left ${row.selected ? 'ring-2 ring-accent' : ''}`}
                  >
                    <Avatar name={row.name || '?'} />
                    <span className="flex-1 min-w-0 text-heading truncate">{row.name}</span>
                    <span className={`flex items-center justify-center w-6 h-6 rounded-full border ${row.selected ? 'bg-accent border-accent text-accent-on' : 'border-border-control'}`} aria-hidden="true">
                      {row.selected && <Check size={14} />}
                    </span>
                  </button>
                ) : (
                  <div data-testid="nearby-row" className="w-full flex items-center gap-3 p-3 rounded-2xl glass-panel">
                    <Avatar name={row.name || '?'} />
                    <span className="flex-1 min-w-0 text-heading truncate">{row.name}</span>
                    <span className="text-secondary text-text-secondary" data-testid="nearby-row-status">{NEARBY.rowStatus[row.status]}</span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {waiting.length > 0 && (
          <div className="flex gap-3">
            <Button variant="secondary" block disabled={selected.length === 0} onClick={() => onInvite(selected)}>{NEARBY.inviteSelected(selected.length)}</Button>
            <Button block onClick={onInviteAll}>{NEARBY.addAll(waiting.length)}</Button>
          </div>
        )}
        <Button variant="plain" block disabled={scanning} onClick={onScan}>{NEARBY.scanAgain}</Button>
      </div>
    </Sheet>
  );
}

/**
 * An invite: who, their group, how long it stays open (the server's clock), and Not now / Join
 * group. Not now comes first, so it is what has focus; Join group works only after
 * INVITE_ACCEPT_ARM_MS, so a tap meant for something else can never accept it.
 * @param {{ invite: { inviteId: string, fromName: string, expiresAt: number, offset: number, shownAt: number }|null,
 *   onRespond: (accept: boolean) => void }} props
 */
export function InvitePrompt({ invite, onRespond }) {
  const now = useNow(1000);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!invite) return undefined;
    const wait = Math.max(0, INVITE_ACCEPT_ARM_MS - (Date.now() - invite.shownAt));
    const timer = setTimeout(() => setArmed(true), wait);
    return () => {
      clearTimeout(timer);
      setArmed(false);
    };
  }, [invite]);
  const left = invite ? msLeft(invite.expiresAt, invite.offset, now) : 0;
  return (
    <Sheet open={Boolean(invite)} onClose={() => onRespond(false)} label={invite ? NEARBY.inviteTitle(invite.fromName) : ''}>
      {invite && (
        <div data-testid="nearby-invite" className="px-5 flex flex-col gap-4">
          <span className="flex items-center justify-center w-14 h-14 rounded-full bg-accent-soft text-accent" aria-hidden="true">
            <Users size={26} />
          </span>
          <div className="flex flex-col gap-2">
            <h2 className="text-title">{NEARBY.inviteTitle(invite.fromName)}</h2>
            <p className="text-body text-text-secondary">{NEARBY.inviteBody(invite.fromName)}</p>
            <p className="text-secondary text-text-secondary tabular-nums" data-testid="nearby-invite-left">{NEARBY.inviteExpiresIn(countdownLabel(left))}</p>
          </div>
          <Button variant="secondary" size="large" block onClick={() => onRespond(false)}>{NEARBY.decline}</Button>
          <Button size="large" block disabled={!armed} aria-disabled={!armed} onClick={() => armed && onRespond(true)}>{NEARBY.accept}</Button>
        </div>
      )}
    </Sheet>
  );
}
