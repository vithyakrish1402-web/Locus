import React from 'react';
import { UserPlus } from 'lucide-react';
import { Avatar } from '../ui';
import { GROUP_HEADER, PEEK } from '../../copy/group';

// What the group panel's header adds at its peek height on a phone (redesign Group panel
// batch, piece 6): for a Group Lead with requests waiting, a pill saying how many, which opens
// them (the design shows none; owner's choice, so a waiting request is never missed), and the
// members at a glance: a few initials and how many are live, paused, waiting or lost.

/**
 * @param {{ requests: number, onRequests: (() => void)|null, names: string[],
 *   counts: {live:number, paused:number, waiting:number, lost:number} }} props
 *   onRequests: null for anyone but the Group Lead
 */
export default function PeekLines({ requests, onRequests, names, counts }) {
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
      <div className="flex items-center gap-3 min-w-0">
        {names.length > 0 && (
          <span className="flex shrink-0 -space-x-2" aria-hidden="true">
            {names.slice(0, 3).map((name, i) => <Avatar key={`${name}-${i}`} name={name} className="ring-2 ring-surface" />)}
          </span>
        )}
        <p className="min-w-0 font-ui text-secondary text-text-secondary truncate" data-testid="peek-summary">{summary || PEEK.justYou}</p>
      </div>
    </div>
  );
}
