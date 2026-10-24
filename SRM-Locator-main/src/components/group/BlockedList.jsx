import React from 'react';
import { Ban } from 'lucide-react';
import { Avatar, Button, Sheet } from '../ui';
import { BLOCKED } from '../../copy/group';

// Who is blocked from this Group (backend/groupRoles.js), for the Group Lead only,
// each with Unblock: they can then ask to join again (and are decided on as anyone else).

/**
 * @param {{ open: boolean, onClose: () => void, blocked: Array<{uid: string, name: string|null}>,
 *   onUnblock: (uid: string) => void }} props
 */
export default function BlockedList({ open, onClose, blocked, onUnblock }) {
  return (
    <Sheet open={open} onClose={onClose} title={BLOCKED.title}>
      <div data-testid="blocked-list" className="px-4 flex flex-col gap-3">
        <p className="text-secondary text-text-secondary">{BLOCKED.help}</p>
        {blocked.length === 0 ? (
          <div className="py-8 flex flex-col items-center text-center gap-3" data-testid="blocked-empty">
            <span className="flex items-center justify-center w-14 h-14 rounded-full bg-accent-soft text-accent" aria-hidden="true">
              <Ban size={26} />
            </span>
            <p className="text-body text-text-secondary">{BLOCKED.empty}</p>
          </div>
        ) : blocked.map(({ uid, name }) => (
          <div key={uid} data-testid="blocked-person" className="rounded-2xl glass-panel p-4 flex items-center gap-3">
            <Avatar name={name || '?'} />
            <p className="flex-1 min-w-0 text-heading truncate">{name || BLOCKED.someone}</p>
            <Button variant="secondary" aria-label={BLOCKED.unblockFor(name || BLOCKED.someone)} onClick={() => onUnblock(uid)}>
              {BLOCKED.unblock}
            </Button>
          </div>
        ))}
      </div>
    </Sheet>
  );
}
