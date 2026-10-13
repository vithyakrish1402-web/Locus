import React from 'react';
import { UserPlus } from 'lucide-react';
import { Avatar, Button, Sheet } from '../ui';
import { JOIN_REQUESTS } from '../../copy/group';

// The Group Lead's join requests (redesign Group panel batch, piece 5): who is waiting, with
// Approve and Decline, answered exactly as before. Waiting only: the old BLACKLIST tab and its
// REVOKE are gone, because the server has no unblock.

/**
 * @param {{ open: boolean, onClose: () => void, requests: Array<{targetId: string, name: string}>,
 *   code: string, onAnswer: (request: object, approved: boolean) => void }} props
 */
export default function JoinRequests({ open, onClose, requests, code, onAnswer }) {
  return (
    <Sheet open={open} onClose={onClose} title={JOIN_REQUESTS.title}>
      <div data-testid="join-requests" className="px-4 flex flex-col gap-3">
        <p className="text-secondary text-text-secondary">{JOIN_REQUESTS.help}</p>
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
