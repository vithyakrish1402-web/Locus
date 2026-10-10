import React, { useId } from 'react';
// eslint-disable-next-line no-unused-vars -- motion is used as <motion.div>, which this config can't see
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Crosshair, Route, ShieldAlert, Terminal, X } from 'lucide-react';
import { Button, IconButton } from '../ui';
import { modalBackdrop, modalCard } from '../../utils/motion';

// The owner's admin tools (the path recorder) and the bar shown on the map while recording, in
// the new look (Stop 2 leftovers). Owner only. Their words are unchanged until the wording pass
// (docs/step0-report.md, "Admin"); only the look changed. ABORT only throws away the points
// recorded so far, so it is a neutral button: red is for the Emergency alert and destructive
// actions on people and groups.

/**
 * The bar on the map while a path is being recorded: how many points, Publish and Abort.
 * @param {{ points: number, onPublish: () => void, onAbort: () => void }} props
 */
export function RecordingBar({ points, onPublish, onAbort }) {
  return (
    <div data-testid="recording-bar" className="absolute top-24 right-6 z-[600] w-64 max-w-[calc(100vw-3rem)] pointer-events-auto">
      <div className="rounded-card border border-border bg-surface text-text font-ui shadow-[var(--shadow-2)] p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2 text-label">
          <span className="w-2 h-2 rounded-full bg-accent shrink-0" aria-hidden="true" />
          <span className="tabular-nums" role="status">RECORDING_NODES: {points}</span>
        </div>
        <div className="flex gap-2">
          <Button block onClick={onPublish}>PUBLISH</Button>
          <Button block variant="secondary" onClick={onAbort}>ABORT</Button>
        </div>
      </div>
    </div>
  );
}

/**
 * @param {{ open: boolean, email?: string|null, name?: string|null, recording: boolean,
 *   points: number, onRecord: () => void, onPublish: () => void, onAbort: () => void,
 *   onClose: () => void }} props
 */
export default function AdminTools({ open, email, name, recording, points, onRecord, onPublish, onAbort, onClose }) {
  const reduceMotion = useReducedMotion();
  const titleId = useId();
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          {...modalBackdrop()}
          data-testid="admin-tools"
          className="fixed inset-0 bg-backdrop z-[6000] flex items-center justify-center p-4 pointer-events-auto"
          // Its buttons end above the Emergency button, which stands over it.
          style={{ paddingBottom: 'var(--emergency-clearance)' }}
        >
          <motion.div
            {...modalCard(reduceMotion)}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="w-full max-w-2xl max-h-full flex flex-col rounded-card border border-border bg-surface text-text font-ui shadow-[var(--shadow-3)] overflow-hidden"
          >
            <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
              <span className="flex items-center justify-center w-10 h-10 shrink-0 rounded-full bg-accent-soft text-accent" aria-hidden="true">
                <ShieldAlert size={20} />
              </span>
              <div className="flex-1 min-w-0">
                <h3 id={titleId} className="text-title">ADMIN_OVERRIDE</h3>
                <p className="text-secondary text-text-secondary break-words">RESTRICTED ACCESS // {email}</p>
              </div>
              <IconButton label="Close" icon={X} onClick={onClose} data-testid="admin-tools-close" />
            </div>

            <p className="px-5 py-3 border-b border-border bg-sunken text-secondary text-text-secondary">
              CLASSIFIED // COMMANDER-LEVEL CONTROLS — ALL ACTIONS PUSH TO GLOBAL MATRIX
            </p>

            <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
              <section aria-labelledby={`${titleId}-recorder`} className="flex flex-col gap-3">
                <h4 id={`${titleId}-recorder`} className="flex items-center gap-2 text-label">
                  <Route size={18} className="text-accent" aria-hidden="true" />
                  SECTION_01 // PATH_RECORDER
                </h4>
                <p className="text-secondary text-text-secondary">
                  Activate map recording mode to trace custom tactical routes between campus nodes. Click points on the map canvas, then publish to broadcast across all squad members.
                </p>
                {!recording ? (
                  <Button variant="tonal" block icon={Crosshair} onClick={onRecord}>INITIATE_RECORD_PATH</Button>
                ) : (
                  <div className="rounded-card border border-border p-4 flex flex-col gap-3">
                    <p className="flex items-center gap-2 text-label tabular-nums" role="status">
                      <span className="w-2 h-2 rounded-full bg-accent shrink-0" aria-hidden="true" />
                      RECORDING ACTIVE — {points} NODES CAPTURED
                    </p>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <Button block icon={Terminal} onClick={onPublish}>PUBLISH_ROUTE</Button>
                      <Button block variant="secondary" icon={X} onClick={onAbort}>ABORT</Button>
                    </div>
                  </div>
                )}
              </section>
            </div>

            <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-border">
              <span className="text-secondary text-text-secondary min-w-0 break-words">COMMANDER // {name || email}</span>
              <Button variant="secondary" onClick={onClose} className="shrink-0">CLOSE_TERMINAL</Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
