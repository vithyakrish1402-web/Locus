import React from 'react';
import { UserPlus } from 'lucide-react';
import { Avatar, Button, Sheet } from '../ui';
import { JOIN_REQUESTS, LEAVE_REQUESTS } from '../../copy/group';
import { LeaveRequestList } from './LeaveRequestStatus';

// Join requests (redesign Group panel batch, piece 5), for the Group Lead and moderators: who is
// waiting, with Approve and Decline, answered exactly as before. The Group Lead alone also has
// Admit all (`onAdmitAll`, backend/groupRoles.js). Blocked people are their own list
// (BlockedList.jsx).

/**
 * @param {{ open: boolean, onClose: () => void, requests: Array<{targetId: string, name: string}>,
 *   code: string, onAnswer: (request: object, approved: boolean) => void, onAdmitAll?: () => void,
 *   leave?: { requests: Array<object>, offset: number, pending?: boolean,
 *     onAnswer: (request: object, approved: boolean) => void } }} props
 *   leave: requests to leave (Stage 5), shown first, in this sheet's style
 */
export default function JoinRequests({ open, onClose, requests, code, onAnswer, onAdmitAll, leave }) {
  const leaving = leave?.requests?.length ? leave : null;
  return (
    <Sheet open={open} onClose={onClose} title={leaving ? LEAVE_REQUESTS.tile : JOIN_REQUESTS.title}>
      <div data-testid="join-requests" className="px-4 flex flex-col gap-3">
        {leaving && <LeaveRequestList requests={leaving.requests} offset={leaving.offset} pending={leaving.pending} onAnswer={leaving.onAnswer} />}
        {leaving && <h3 className="font-ui text-label text-text-secondary uppercase tracking-wide pt-2">{LEAVE_REQUESTS.joinSection}</h3>}
        <p className="text-secondary text-text-secondary">{JOIN_REQUESTS.help}</p>
        {onAdmitAll && requests.length > 1 && (
          <Button block onClick={onAdmitAll}>{JOIN_REQUESTS.admitAll(requests.length)}</Button>
        )}
        {requests.length === 0 ? (
          <div className="py-8 flex flex-col items-center text-center gap-3" data-testid="join-requests-empty">
            <span className="flex items-center justify-center w-14 h-14 rounded-full bg-accent-soft text-accent" aria-hidden="true">
              <UserPlus size={26} />
            </span>
            <p className="text-heading">{JOIN_REQUESTS.emptyTitle}</p>
            <p className="text-body text-text-secondary">{JOIN_REQUESTS.emptyBody(code)}</p>
          </div>
        ) : requests.map((request) => (
          <div key={request.targetId} data-testid="join-request" className="rounded-2xl glass-panel p-4 flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <Avatar name={request.name || '?'} />
              <div className="min-w-0">
                <p className="text-heading truncate">{request.name}</p>
                <p className="text-secondary text-text-secondary">{JOIN_REQUESTS.wants}</p>
              </div>
            </div>
            <div className="flex gap-3">
              <Button variant="secondary" block aria-label={JOIN_REQUESTS.declineFor(request.name)} onClick={() => onAnswer(request, false)}>
                {JOIN_REQUESTS.decline}
              </Button>
              <Button block aria-label={JOIN_REQUESTS.approveFor(request.name)} onClick={() => onAnswer(request, true)}>
                {JOIN_REQUESTS.approve}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Sheet>
  );
}
