import React, { useId } from 'react';
// eslint-disable-next-line no-unused-vars -- motion is used as <motion.div>, which this config can't see
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Activity, Loader2, X } from 'lucide-react';
import { Button, IconButton } from '../ui';
import { modalBackdrop, modalCard } from '../../utils/motion';

// The Group Lead's locations table, opened by Refresh locations: where each member was last,
// their battery and how fresh their signal is, refreshed every 5 s. In the new look (Stop 2
// leftovers); its words are unchanged until the wording pass (docs/step0-report.md, the table's
// rows), so they are written here as they were.

/** A value, with its label in front of it on a phone (the column headings show from md up). */
function Cell({ label, className = '', children }) {
  return (
    <div className={`flex md:block justify-between items-baseline gap-3 text-secondary ${className}`}>
      <span className="md:hidden text-text-secondary">{label}</span>
      <span className="text-right md:text-left">{children}</span>
    </div>
  );
}

/**
 * @param {{ open: boolean, members: Array<{id: string, name: string}>,
 *   rowFor: (member: object) => { latitude: number|null, longitude: number|null,
 *     battery: { text: string, color: string }, freshness: { text: string, color: string } },
 *   sync: { status: string, message: string|null }, onRefresh: () => void, onClose: () => void }} props
 */
export default function LocationsTable({ open, members, rowFor, sync, onRefresh, onClose }) {
  const reduceMotion = useReducedMotion();
  const titleId = useId();
  const pending = sync.status === 'pending';
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          {...modalBackdrop()}
          data-testid="locations-table"
          onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
          className="fixed inset-0 bg-backdrop z-[4000] flex items-center justify-center p-4 pointer-events-auto"
          // Its last row and its button end above the Emergency button, which stands over it.
          style={{ paddingBottom: 'var(--emergency-clearance)' }}
        >
          <motion.div
            {...modalCard(reduceMotion)}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="w-full max-w-4xl h-[80vh] max-h-full flex flex-col rounded-card border border-border bg-surface text-text font-ui shadow-[var(--shadow-3)] overflow-hidden"
          >
            <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
              <span className="flex items-center justify-center w-10 h-10 shrink-0 rounded-full bg-accent-soft text-accent" aria-hidden="true">
                <Activity size={20} />
              </span>
              <div className="flex-1 min-w-0">
                <h3 id={titleId} className="text-title break-words">SYS_TELEMETRY // MATRIX</h3>
                <p className="text-secondary text-text-secondary">COMMANDER CLASSIFIED CLEARANCE</p>
              </div>
              <IconButton label="Close" icon={X} onClick={onClose} data-testid="locations-table-close" />
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-5 py-2">
              <div className="hidden md:grid md:grid-cols-4 gap-4 py-2 border-b border-border text-label text-text-secondary">
                <div>NODE_DESIGNATION</div>
                <div>LAST_KNOWN_COORDS</div>
                <div>POWER_CORE</div>
                <div>SIGNAL_INTEGRITY</div>
              </div>
              {members.length === 0 && (
                <p className="py-8 text-center text-body text-text-secondary">NO OTHER OPERATIVES IN THE SQUAD YET.</p>
              )}
              {members.map((member) => {
                const { latitude, longitude, battery, freshness } = rowFor(member);
                const hasPosition = latitude !== null && longitude !== null;
                return (
                  <div key={member.id} data-testid="locations-row" className="grid grid-cols-1 md:grid-cols-4 gap-1.5 md:gap-4 py-3 border-b border-border last:border-b-0 md:items-center">
                    <div className="text-body font-semibold break-words">{member.name}</div>
                    <Cell label="COORDS:" className="text-text-secondary tabular-nums">
                      {hasPosition ? <>LAT: {latitude.toFixed(5)}<br />LNG: {longitude.toFixed(5)}</> : 'NO_CACHE_DATA'}
                    </Cell>
                    <Cell label="POWER:" className={`font-semibold tabular-nums ${battery.color}`}>{battery.text}</Cell>
                    <Cell label="SIGNAL:" className={`font-semibold ${freshness.color}`}>{freshness.text}</Cell>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-border">
              {sync.status === 'error'
                ? <span className="text-secondary text-warning">{sync.message}</span>
                : <span className="text-secondary text-text-secondary">AUTO-REFRESHING EVERY 5 SECONDS</span>}
              <Button variant="secondary" onClick={onRefresh} disabled={pending} icon={pending ? null : Activity} className="shrink-0" data-testid="locations-table-refresh">
                {pending ? <><Loader2 size={18} className="animate-spin" aria-hidden="true" /> SYNCING...</> : 'FORCE_SYNC'}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
