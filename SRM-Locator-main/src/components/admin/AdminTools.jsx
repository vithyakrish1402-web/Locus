import React, { useEffect, useId, useState } from 'react';
// eslint-disable-next-line no-unused-vars -- motion is used as <motion.div>, which this config can't see
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Crosshair, MapPin, Route, ShieldAlert, Terminal, X } from 'lucide-react';
import { Button, IconButton } from '../ui';
import { modalBackdrop, modalCard } from '../../utils/motion';
import { pushBackHandler } from '../../utils/backHandlers';
import { REMOVE_PLACE } from '../../copy/addPlace';

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
 *   onClose: () => void, added?: object[], onAddPlace?: () => void,
 *   onRemovePlace?: (place: object) => void, removingId?: string|null }} props
 *   removingId: the place whose removal is out, if any: every Remove waits until it answers
 */
export default function AdminTools({ open, email, name, recording, points, onRecord, onPublish, onAbort, onClose, added = [], onAddPlace = () => {}, onRemovePlace = () => {}, removingId = null }) {
  const reduceMotion = useReducedMotion();
  const titleId = useId();
  // The place whose Remove is waiting on its confirmation. Remove used to act on the first tap,
  // for every phone, with no way back.
  const [confirming, setConfirming] = useState(null);
  // Closing the tools drops a question left open, so it is not there on the next opening.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) setConfirming(null);
  }
  // Back with the confirmation open closes the confirmation, and only it.
  useEffect(() => {
    if (!confirming) return undefined;
    return pushBackHandler(() => { setConfirming(null); return true; });
  }, [confirming]);
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

              <section aria-labelledby={`${titleId}-places`} className="flex flex-col gap-3 mt-6">
                <h4 id={`${titleId}-places`} className="flex items-center gap-2 text-label">
                  <MapPin size={18} className="text-accent" aria-hidden="true" />
                  SECTION_02 // ADD_PLACE
                </h4>
                <p className="text-secondary text-text-secondary">
                  Tap the map to drop a new place. It is saved for everyone and shows up in the list, search and navigation.
                </p>
                <Button variant="tonal" block icon={MapPin} onClick={onAddPlace}>ADD_PLACE</Button>
                {added.length > 0 && (
                  <ul data-testid="added-places" className="flex flex-col gap-2">
                    {added.map((place) => (confirming?.id === place.id ? (
                      <li key={place.id} data-testid="remove-place-confirm" role="alertdialog" aria-label={REMOVE_PLACE.title(place.name)} className="flex flex-col gap-2 rounded-card border border-border px-3 py-3">
                        <p className="text-label break-words">{REMOVE_PLACE.title(place.name)}</p>
                        <p className="text-secondary text-text-secondary">{REMOVE_PLACE.body}</p>
                        <div className="flex gap-2">
                          {/* Not red: red is for the Emergency alert and actions on people (the
                              note at the top of this file, tests/emergencyRedGuard.test.js). */}
                          <Button block onClick={() => { setConfirming(null); onRemovePlace(place); }}>{REMOVE_PLACE.confirm}</Button>
                          <Button block variant="secondary" onClick={() => setConfirming(null)}>{REMOVE_PLACE.cancel}</Button>
                        </div>
                      </li>
                    ) : (
                      <li key={place.id} className="flex items-center gap-2 rounded-card border border-border px-3 py-2">
                        <span className="flex-1 min-w-0 break-words text-secondary">{place.name}</span>
                        <Button variant="secondary" onClick={() => setConfirming(place)} disabled={Boolean(removingId)} aria-label={`Remove ${place.name}`} className="shrink-0">
                          {removingId === place.id ? REMOVE_PLACE.removing : 'REMOVE'}
                        </Button>
                      </li>
                    )))}
                  </ul>
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
