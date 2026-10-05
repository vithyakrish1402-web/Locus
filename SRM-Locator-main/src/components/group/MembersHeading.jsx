import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, Users } from 'lucide-react';
import { Button, Skeleton } from '../ui';
import { copyText } from '../../utils/clipboard';
import { MEMBERS_LIST } from '../../copy/group';

// The members list's heading and its states (redesign Group panel batch, piece 7): "Members ·
// 4" and when the list last came in; while it hasn't yet, a few placeholder rows; and in a
// group of one, "Just you so far" with the code to copy (Copy only: sharing is on the Later
// list).

/** Re-renders every `ms`, so "Updated 2 min ago" keeps counting. */
function useNow(ms) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** @param {{ count: number, updatedAt: number|null }} props  updatedAt: null while loading */
export function MembersHeading({ count, updatedAt }) {
  const now = useNow(15000);
  const minutes = updatedAt === null ? null : Math.floor(Math.max(0, now - updatedAt) / 60000);
  return (
    <div className="pt-4 pb-1 flex items-baseline justify-between gap-3 font-ui" data-testid="members-heading">
      <h3 className="text-heading text-text">{updatedAt === null ? MEMBERS_LIST.loadingHeading : MEMBERS_LIST.heading(count)}</h3>
      <p className="text-secondary text-text-secondary" aria-live="polite">
        {minutes === null ? MEMBERS_LIST.loading : minutes < 1 ? MEMBERS_LIST.updatedJustNow : MEMBERS_LIST.updated(minutes)}
      </p>
    </div>
  );
}

/** Placeholder rows while the list hasn't come in. */
export function MembersLoading() {
  return (
    <div data-testid="members-loading" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3 py-3 border-b border-border">
          <Skeleton className="w-[var(--size-avatar)] h-[var(--size-avatar)] rounded-full" />
          <div className="flex-1 flex flex-col gap-2">
            <Skeleton className="h-4 w-1/2 rounded-full" />
            <Skeleton className="h-3 w-1/3 rounded-full" />
          </div>
          <Skeleton className="w-12 h-12 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/** @param {{ code: string, isLead: boolean }} props */
export function MembersEmpty({ code, isLead }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    if (!(await copyText(code))) return;
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1800);
  };
  return (
    <div data-testid="members-empty" className="mt-2 rounded-card border border-dashed border-border-control p-6 flex flex-col items-center text-center gap-3 font-ui text-text">
      <span className="flex items-center justify-center w-14 h-14 rounded-full bg-accent-soft text-accent" aria-hidden="true">
        <Users size={26} />
      </span>
      <p className="text-heading">{MEMBERS_LIST.emptyTitle}</p>
      <p className="text-body text-text-secondary">{isLead ? MEMBERS_LIST.emptyLead(code) : MEMBERS_LIST.emptyMember(code)}</p>
      <Button icon={copied ? Check : Copy} onClick={copy}>{copied ? MEMBERS_LIST.codeCopied : MEMBERS_LIST.copyCode}</Button>
    </div>
  );
}
