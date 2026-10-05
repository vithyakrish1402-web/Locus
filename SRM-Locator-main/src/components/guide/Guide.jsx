import React, { useEffect, useId, useRef, useState } from 'react';
// eslint-disable-next-line no-unused-vars -- motion is used as <motion.div>, which this config can't see
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Button } from '../ui';
import { GUIDE } from '../../copy/guide';
import { ArPicture, EmergencyPicture, GroupPicture, MapPicture, SharingPicture } from './GuidePictures';
import { screenTransition } from '../../utils/motion';

// "How LOCUS works" (redesign P11): five steps, one screen each. Shown once on first run,
// before sign-in, and always from Settings › About. Skip (on steps 1-4) and Get started (on
// step 5) both end it, through `onDone`; App.jsx remembers that on the phone.

export const GUIDE_STEPS = GUIDE.steps.length;
const PICTURES = [GroupPicture, MapPicture, ArPicture, SharingPicture, EmergencyPicture];

/**
 * @param {{ onDone: () => void, zIndex?: number, initialStep?: number }} props
 *   zIndex: set when the guide is opened over other screens (from Settings)
 *   initialStep: where it opens (the preview page shows each step)
 */
export default function Guide({ onDone, zIndex, initialStep = 0 }) {
  const [step, setStep] = useState(initialStep);
  const [direction, setDirection] = useState('forward');
  const reduceMotion = useReducedMotion();
  const titleId = useId();
  const headingRef = useRef(null);
  const last = step === GUIDE_STEPS - 1;
  const { title, body } = GUIDE.steps[step];
  const Picture = PICTURES[step];

  // Each step's heading takes focus, so a screen reader reads the new step.
  useEffect(() => { headingRef.current?.focus(); }, [step]);

  const go = (to) => {
    setDirection(to > step ? 'forward' : 'back');
    setStep(to);
  };

  return (
    <div
      role="dialog"
      aria-labelledby={titleId}
      data-testid="guide"
      className="fixed inset-0 flex flex-col bg-bg text-text font-ui overflow-hidden"
      style={{ zIndex, paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
    >
      <div className="flex-1 flex flex-col max-w-md w-full mx-auto px-5 min-h-0">
        <div className="flex items-center justify-between min-h-14">
          <p className="text-label text-text-secondary" data-testid="guide-progress">{GUIDE.progress(step + 1, GUIDE_STEPS)}</p>
          {!last && <Button variant="plain" onClick={onDone}>{GUIDE.skip}</Button>}
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={step} {...screenTransition(direction, reduceMotion)} className="flex-1 flex flex-col min-h-0">
            <div className="shrink-0 h-[min(40vh,340px)] rounded-sheet bg-accent-soft overflow-hidden flex items-center justify-center" aria-hidden="true">
              <Picture />
            </div>
            <h1 id={titleId} ref={headingRef} tabIndex={-1} className="mt-6 text-display outline-none">{title}</h1>
            <p className="mt-3 text-body text-text-secondary">{body}</p>
          </motion.div>
        </AnimatePresence>

        <div className="flex justify-center gap-2 py-5" aria-hidden="true">
          {GUIDE.steps.map((s, i) => (
            <span key={s.title} className={`h-2 rounded-full transition-transform ${i === step ? 'w-6 bg-accent' : 'w-2 bg-border'}`} />
          ))}
        </div>
        <Button block size="large" onClick={last ? onDone : () => go(step + 1)}>{last ? GUIDE.done : GUIDE.next}</Button>
      </div>
    </div>
  );
}
