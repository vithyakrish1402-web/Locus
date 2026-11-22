import React from 'react';
import { Hourglass } from 'lucide-react';
import { Button } from '../ui';
import { LEAVE_REQUEST, LEAVE_REQUESTS } from '../../copy/group';
import { useNow } from '../../hooks/useNow';
import { clockLabel, countdownLabel, msLeft } from '../../utils/timedPrivacy';

// Request to leave (Stage 5): the member's own request while it waits, where the Leave button was.
// Calm, with when it is approved on its own (the server's clock, the phone's own time of day), and a
// way to take it back.

/**
 * @param {{ deadline: number, offset: number, pending?: boolean, onCancel: () => void }} props
 */
export function LeaveRequestWaiting({ deadline, offset, pending = false, onCancel }) {
  const now = useNow(1000);
  const left = msLeft(deadline, offset, now);
  return (
    <section data-testid="leave-request-waiting" className="mt-4 rounded-2xl glass-panel p-4 flex flex-col gap-3" aria-live="polite">
      <div className="flex items-start gap-3">
        <span className="flex items-center justify-center w-10 h-10 shrink-0 rounded-full bg-accent-soft text-accent" aria-hidden="true">
          <Hourglass size={20} />
        </span>
        <div className="min-w-0">
          <p className="text-heading">{LEAVE_REQUEST.waitingTitle}</p>
          <p className="text-secondary text-text-secondary tabular-nums" data-testid="leave-request-countdown">
            {LEAVE_REQUEST.waitingBody(countdownLabel(left), clockLabel(deadline, offset))}
          </p>
        </div>
      </div>
      <Button variant="secondary" block disabled={pending} onClick={onCancel}>{LEAVE_REQUEST.cancel}</Button>
    </section>
  );
}

/**
 * The requests to leave a Group Lead or moderator may answer, in the join requests sheet's style.
 * The Commander's own request has no Reject; a moderator's reaches only the Group Lead, and says so.
 * @param {{ requests: Array<object>, offset: number, pending?: boolean,
 *   onAnswer: (request: object, approved: boolean) => void }} props
 */
export function LeaveRequestList({ requests, offset, pending = false, onAnswer }) {
  const now = useNow(1000);
  return (
    <div data-testid="leave-requests" className="flex flex-col gap-3">
      <h3 className="font-ui text-label text-text-secondary uppercase tracking-wide">{LEAVE_REQUESTS.leaveSection}</h3>
      {requests.map((request) => {
        const left = msLeft(request.deadline, offset, now);
        return (
          <div key={request.uid} data-testid="leave-request" className="rounded-2xl glass-panel p-4 flex flex-col gap-3">
            <div className="min-w-0">
              <p className="text-heading truncate">{request.name || '?'}</p>
              <p className="text-secondary text-text-secondary">{LEAVE_REQUESTS.wants}</p>
              <p className="text-secondary text-text-secondary tabular-nums" data-testid="leave-request-left">
                {LEAVE_REQUESTS.autoIn(countdownLabel(left), clockLabel(request.deadline, offset))}
              </p>
              {request.fromCommander && <p className="mt-1 text-secondary text-text" data-testid="leave-rule-commander">{LEAVE_REQUESTS.commanderRule}</p>}
              {!request.fromCommander && request.fromModerator && <p className="mt-1 text-secondary text-text" data-testid="leave-rule-moderator">{LEAVE_REQUESTS.moderatorRule}</p>}
            </div>
            <div className="flex gap-3">
              {!request.fromCommander && (
                <Button variant="secondary" block disabled={pending} aria-label={LEAVE_REQUESTS.rejectFor(request.name)} onClick={() => onAnswer(request, false)}>
                  {LEAVE_REQUESTS.reject}
                </Button>
              )}
              <Button block disabled={pending} aria-label={LEAVE_REQUESTS.approveFor(request.name)} onClick={() => onAnswer(request, true)}>
                {LEAVE_REQUESTS.approve}
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
