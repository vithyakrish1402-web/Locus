import React from 'react';
import { UserPlus } from 'lucide-react';
import { Avatar } from '../ui';
import { GROUP_HEADER, PEEK } from '../../copy/group';

// What the group panel's header adds at its peek height on a phone (redesign Group panel
// batch, piece 6): for a Group Lead with requests waiting, a pill saying how many, which opens
// them (the design shows none; owner's choice, so a waiting request is never missed), and the
// whole group at a glance: a row with every member (you first), swiped sideways when they do not
// all fit, and under it how many are live, paused, waiting or lost. A tap on someone opens their
// options. This is what the Group tab opens to.

const STATE_LABEL = { paused: 'paused', waiting: 'waiting', lost: 'lost connection', hidden: 'hidden' };

/**
 * @param {{ requests: number, onRequests: (() => void)|null,
 *   members: { id: string, name: string, photo?: string|null, state: 'live'|'paused'|'waiting'|'lost'|'hidden', self?: boolean }[],
 *   onMember?: ((id: string) => void)|null,
 *   counts: {live:number, paused:number, waiting:number, lost:number} }} props
 *   onRequests: null for anyone but the Group Lead
 */
export default function PeekLines({ requests, onRequests, members, onMember = null, counts }) {
  const summary = PEEK.summary(counts);
  return (
    <div className="pt-3 flex flex-col gap-3" data-testid="peek-lines">
      {onRequests && requests > 0 && (
        <button
          type="button"
          data-testid="peek-requests"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onRequests(); }}
          className="self-start inline-flex items-center gap-2 min-h-11 px-4 rounded-full bg-accent-soft text-accent font-ui text-label focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <UserPlus size={18} aria-hidden="true" />
          {GROUP_HEADER.requests(requests)}
        </button>
      )}
      <ul
        data-testid="peek-members"
        aria-label={PEEK.members}
        className="flex gap-3 overflow-x-auto no-scrollbar -mx-4 px-4 touch-pan-x"
        // Swiping it sideways is not a drag of the panel.
        onPointerDown={(e) => e.stopPropagation()}
      >
        {members.map((m) => (
          <li key={m.id} className="shrink-0">
            <button
              type="button"
              data-testid="peek-member"
              disabled={!onMember || m.self}
              onClick={(e) => { e.stopPropagation(); onMember?.(m.id); }}
              className="flex flex-col items-center gap-1 w-16 rounded-2xl py-1 cursor-pointer disabled:cursor-default focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <Avatar name={m.name} photo={m.photo ?? null} dashed={m.state !== 'live'} className={m.state === 'lost' ? 'opacity-70' : ''} />
              <span className="max-w-full truncate font-ui text-[12px] leading-4 text-text">{m.self ? PEEK.you : m.name}</span>
              {m.state !== 'live' && <span className="max-w-full truncate font-ui text-[11px] leading-3 text-text-secondary">{STATE_LABEL[m.state]}</span>}
            </button>
          </li>
        ))}
      </ul>
      <p className="font-ui text-secondary text-text-secondary truncate" data-testid="peek-summary">{summary || PEEK.justYou}</p>
    </div>
  );
}
