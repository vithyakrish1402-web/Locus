import React, { useId, useState } from 'react';
// eslint-disable-next-line no-unused-vars -- motion is used as <motion.div>, which this config can't see
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { MapPin, X } from 'lucide-react';
import { Button, IconButton } from '../ui';
import { modalBackdrop, modalCard } from '../../utils/motion';
import { ALIAS_MAX, INFO_MAX, NAME_MAX, PLACE_CATEGORIES } from '../../utils/campusPlaces';
import { CATEGORY_LABELS } from '../../copy/addPlace';

// The owner's Add Place tool: the bar on the map while choosing the spot, and the form that
// follows. What is saved reaches every phone (Firestore `campus_places`), so the form says so.

/**
 * The bar on the map while the spot is being chosen.
 * @param {{ onCancel: () => void }} props
 */
export function PlacingBar({ onCancel }) {
  return (
    <div data-testid="placing-bar" className="absolute top-24 right-6 z-[600] w-64 max-w-[calc(100vw-3rem)] pointer-events-auto">
      <div className="rounded-card border border-border bg-surface text-text font-ui shadow-[var(--shadow-2)] p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2 text-label">
          <MapPin size={16} className="text-accent shrink-0" aria-hidden="true" />
          <span role="status">Tap the map where the place is</span>
        </div>
        <Button block variant="secondary" onClick={onCancel}>CANCEL</Button>
      </div>
    </div>
  );
}

const fieldClass = 'w-full rounded-xl border border-border bg-sunken px-3 py-2.5 text-text font-ui text-[15px] outline-none focus:border-accent';

/**
 * The form for the spot just chosen.
 * @param {{ open: boolean, lat?: number, lng?: number, saving: boolean, problem: string|null,
 *   onSave: (fields: object) => void, onCancel: () => void }} props
 */
export default function AddPlaceSheet({ open, lat, lng, saving, problem, onSave, onCancel }) {
  const reduceMotion = useReducedMotion();
  const titleId = useId();
  const [name, setName] = useState('');
  const [aliases, setAliases] = useState('');
  const [category, setCategory] = useState('ACADEMIC');
  const [info, setInfo] = useState('');

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          {...modalBackdrop()}
          data-testid="add-place"
          className="fixed inset-0 bg-backdrop z-[6000] flex items-center justify-center p-4 pointer-events-auto"
          style={{ paddingBottom: 'var(--emergency-clearance)' }}
        >
          <motion.form
            {...modalCard(reduceMotion)}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onSubmit={(e) => { e.preventDefault(); onSave({ name, aliases, category, info, lat, lng }); }}
            className="w-full max-w-md max-h-full flex flex-col rounded-card border border-border bg-surface text-text font-ui shadow-[var(--shadow-3)] overflow-hidden"
          >
            <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
              <span className="flex items-center justify-center w-10 h-10 shrink-0 rounded-full bg-accent-soft text-accent" aria-hidden="true">
                <MapPin size={20} />
              </span>
              <div className="flex-1 min-w-0">
                <h3 id={titleId} className="text-title">Add a place</h3>
                <p className="text-secondary text-text-secondary tabular-nums">
                  {Number.isFinite(lat) ? `${lat.toFixed(6)}, ${lng.toFixed(6)}` : ''}
                </p>
              </div>
              <IconButton label="Close" icon={X} onClick={onCancel} data-testid="add-place-close" />
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col gap-3">
              <p className="text-secondary text-text-secondary">Everyone who opens LOCUS will see this place.</p>
              <label className="flex flex-col gap-1 text-label">
                Name
                <input className={fieldClass} value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} autoFocus />
              </label>
              <label className="flex flex-col gap-1 text-label">
                Other names students use (separate with commas)
                <input className={fieldClass} value={aliases} maxLength={ALIAS_MAX * 4} onChange={(e) => setAliases(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1 text-label">
                Kind of place
                <select className={fieldClass} value={category} onChange={(e) => setCategory(e.target.value)}>
                  {PLACE_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-label">
                A line about it (optional)
                <input className={fieldClass} value={info} maxLength={INFO_MAX} onChange={(e) => setInfo(e.target.value)} />
              </label>
              {problem && <p role="alert" className="text-secondary text-text">{problem}</p>}
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
              <Button variant="secondary" onClick={onCancel} disabled={saving}>CANCEL</Button>
              <Button type="submit" disabled={saving}>{saving ? 'SAVING…' : 'SAVE PLACE'}</Button>
            </div>
          </motion.form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
