import React from 'react';
import { Download, History } from 'lucide-react';
import { Button, Sheet } from '../ui';
import { ACTIVITY_LOG } from '../../copy/group';
import { localTime } from '../../utils/activityLogExport';

// The Group's activity log (backend/activityLog.js), for the Group Lead and moderators: who hid
// their location and when they came back, who left, lost their connection, or was removed,
// newest first, with Export log (a CSV file, utils/activityLogExport.js).

/**
 * @param {{ open: boolean, onClose: () => void, entries: Array<{at: number, kind: string,
 *   name?: string|null, byName?: string|null}>, onExport: () => void }} props
 */
export default function ActivityLog({ open, onClose, entries, onExport }) {
  const newestFirst = [...entries].sort((a, b) => b.at - a.at);
  return (
    <Sheet open={open} onClose={onClose} title={ACTIVITY_LOG.title}>
      <div data-testid="activity-log" className="px-4 flex flex-col gap-3">
        <p className="text-secondary text-text-secondary">{ACTIVITY_LOG.help}</p>
        {newestFirst.length === 0 ? (
          <div className="py-8 flex flex-col items-center text-center gap-3" data-testid="activity-log-empty">
            <span className="flex items-center justify-center w-14 h-14 rounded-full bg-accent-soft text-accent" aria-hidden="true">
              <History size={26} />
            </span>
            <p className="text-body text-text-secondary">{ACTIVITY_LOG.empty}</p>
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-2xl glass-panel">
            {newestFirst.map((entry, i) => (
              <li key={`${entry.at}-${i}`} data-testid="activity-entry" className="px-4 py-3 font-ui">
                <p className="text-body text-text">
                  <span className="font-semibold">{entry.name || ACTIVITY_LOG.someone}</span>
                  {' '}{(ACTIVITY_LOG.kinds[entry.kind] ?? entry.kind).toLowerCase()}
                  {entry.byName ? ` ${ACTIVITY_LOG.by(entry.byName)}` : ''}
                </p>
                <p className="text-secondary text-text-secondary tabular-nums">{localTime(entry.at)}</p>
              </li>
            ))}
          </ul>
        )}
        <Button block icon={Download} onClick={onExport} disabled={newestFirst.length === 0}>
          {ACTIVITY_LOG.export}
        </Button>
      </div>
    </Sheet>
  );
}
