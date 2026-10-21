import React from 'react';
import { AlertCircle, Flag, Loader2, RefreshCw, UserPlus, X } from 'lucide-react';
import { Badge, Button } from '../ui';
import { LEAD_TOOLS, REFRESH_FAILED } from '../../copy/group';

// The Group Lead's tools (redesign Group panel batch, piece 4): Join requests with its count,
// Refresh locations (the old SYNC_TELEMETRY, which also opens the location table as before)
// and Meeting point (choose a spot on the map, as the map's own button does). A refresh that
// didn't work says why in an amber notice with Retry. Remove meeting point stays a quiet
// button while one is set.

const TILE = 'relative flex-1 min-w-0 min-h-[5.5rem] px-2 py-3 rounded-2xl glass-panel text-accent font-ui text-label flex flex-col items-center justify-center gap-1.5 text-center transition-all duration-150 hover:bg-surface/80 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50';

/**
 * @param {{ requests: number, onRequests: () => void, refresh: { status: string, message: string|null },
 *   onRefresh: () => void, choosing: boolean, onMeetingPoint: () => void,
 *   hasMeetingPoint: boolean, onRemoveMeetingPoint: () => void }} props
 */
export default function LeadTools({ requests, onRequests, refresh, onRefresh, choosing, onMeetingPoint, hasMeetingPoint, onRemoveMeetingPoint }) {
  const refreshing = refresh.status === 'pending';
  return (
    <section data-testid="lead-tools" className="pt-2 flex flex-col gap-3">
      <div className="flex gap-2">
        <button type="button" className={TILE} onClick={onRequests}>
          <UserPlus size={22} aria-hidden="true" />
          {LEAD_TOOLS.joinRequests}
          <Badge count={requests} label={LEAD_TOOLS.waiting(requests)} className="absolute top-2 right-2" />
        </button>
        <button type="button" className={TILE} onClick={onRefresh} disabled={refreshing} aria-busy={refreshing}>
          {refreshing
            ? <Loader2 size={22} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
            : <RefreshCw size={22} aria-hidden="true" />}
          {refreshing ? LEAD_TOOLS.refreshing : LEAD_TOOLS.refresh}
        </button>
        <button type="button" className={`${TILE} ${choosing ? 'ring-2 ring-accent' : ''}`} onClick={onMeetingPoint} aria-pressed={choosing}>
          {choosing ? <X size={22} aria-hidden="true" /> : <Flag size={22} aria-hidden="true" />}
          {choosing ? LEAD_TOOLS.cancelMeetingPoint : LEAD_TOOLS.meetingPoint}
        </button>
      </div>

      {refresh.status === 'error' && (
        <div role="alert" data-testid="refresh-failed" className="flex items-center gap-3 rounded-card bg-warning-soft px-4 py-3 font-ui text-text">
          <AlertCircle size={22} className="shrink-0 text-warning" aria-hidden="true" />
          <p className="flex-1 min-w-0 text-secondary">
            <span className="font-semibold">{REFRESH_FAILED.title}</span> {refresh.message}
          </p>
          <Button variant="plain" onClick={onRefresh}>{REFRESH_FAILED.retry}</Button>
        </div>
      )}

      {hasMeetingPoint && (
        <Button variant="plain" icon={X} onClick={onRemoveMeetingPoint} className="self-start">{LEAD_TOOLS.removeMeetingPoint}</Button>
      )}
    </section>
  );
}
