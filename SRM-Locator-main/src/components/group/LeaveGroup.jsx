import React from 'react';
import { LogOut } from 'lucide-react';
import { Button, Sheet } from '../ui';
import { LEAVE_GROUP } from '../../copy/group';

// Leave group (redesign Group panel batch, piece 4): the old DISCONNECT, now red and behind a
// confirmation for everyone. The confirmation tells a Group Lead what happens to the group:
// leadership passes to another member, or, if they are alone, the group ends.

/** The red button at the foot of the members list. */
export function LeaveGroupButton({ onClick }) {
  return (
    <Button variant="plain" icon={LogOut} onClick={onClick} className="mt-4 text-danger self-start" data-testid="leave-group">
      {LEAVE_GROUP.button}
    </Button>
  );
}

/**
 * @param {{ open: boolean, code: string, isLead: boolean, alone: boolean,
 *   onLeave: () => void, onCancel: () => void }} props
 *   alone: nobody else is in the group (it ends when its last member leaves)
 */
export function LeaveGroupConfirm({ open, code, isLead, alone, onLeave, onCancel }) {
  return (
    <Sheet open={open} onClose={onCancel} label={LEAVE_GROUP.title}>
      <div data-testid="leave-group-confirm" className="px-5 flex flex-col gap-4">
        <span className="flex items-center justify-center w-14 h-14 rounded-full bg-danger-soft text-danger" aria-hidden="true">
          <LogOut size={26} />
        </span>
        <div className="flex flex-col gap-2">
          <h2 className="text-title">{LEAVE_GROUP.title}</h2>
          {isLead && <p className="text-body font-semibold text-text">{alone ? LEAVE_GROUP.leadAlone : LEAVE_GROUP.leadPasses}</p>}
          {!(isLead && alone) && <p className="text-body text-text-secondary">{LEAVE_GROUP.body(code)}</p>}
        </div>
        <Button variant="danger" size="large" block onClick={onLeave}>{LEAVE_GROUP.confirm}</Button>
        <Button variant="plain" block onClick={onCancel}>{LEAVE_GROUP.cancel}</Button>
      </div>
    </Sheet>
  );
}
