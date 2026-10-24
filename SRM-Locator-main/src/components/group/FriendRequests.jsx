import React from 'react';
import { Avatar, Button, Sheet } from '../ui';
import { FRIENDS } from '../../copy/group';

// The friend requests waiting for this person (utils/friends.js), with Accept and Decline.

/**
 * @param {{ open: boolean, onClose: () => void, requests: Array<{uid: string, name: string|null}>,
 *   onAccept: (uid: string) => void, onDecline: (uid: string) => void }} props
 */
export default function FriendRequests({ open, onClose, requests, onAccept, onDecline }) {
  return (
    <Sheet open={open} onClose={onClose} title={FRIENDS.requestsTitle}>
      <div data-testid="friend-requests" className="px-4 flex flex-col gap-3">
        <p className="text-secondary text-text-secondary">{FRIENDS.requestsHelp}</p>
        {requests.length === 0 ? (
          <p className="py-6 text-center text-body text-text-secondary" data-testid="friend-requests-empty">{FRIENDS.noRequests}</p>
        ) : requests.map(({ uid, name }) => (
          <div key={uid} data-testid="friend-request" className="rounded-2xl glass-panel p-4 flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <Avatar name={name || '?'} />
              <div className="min-w-0">
                <p className="text-heading truncate">{name || FRIENDS.someone}</p>
                <p className="text-secondary text-text-secondary">{FRIENDS.wants}</p>
              </div>
            </div>
            <div className="flex gap-3">
              <Button variant="secondary" block aria-label={FRIENDS.declineFor(name || FRIENDS.someone)} onClick={() => onDecline(uid)}>{FRIENDS.decline}</Button>
              <Button block aria-label={FRIENDS.acceptFor(name || FRIENDS.someone)} onClick={() => onAccept(uid)}>{FRIENDS.accept}</Button>
            </div>
          </div>
        ))}
      </div>
    </Sheet>
  );
}
