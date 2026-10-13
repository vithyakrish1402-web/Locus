import React, { useEffect, useId, useRef } from 'react';
// eslint-disable-next-line no-unused-vars -- motion is used as <motion.div>, which this config can't see
import { motion, AnimatePresence, useAnimationControls, useDragControls, useReducedMotion } from 'framer-motion';
import { fade, releaseSheet, sheetSettle, REDUCED_MOTION_S } from '../../utils/motion';
import { LAYER } from '../../utils/layers';

// A bottom sheet over a dimmed backdrop: member options, Remove and block's confirmation,
// Join requests, the permission explainers. It rises on SHEET_SPRING; drag its handle down
// (or tap the backdrop, or press Escape) to close it, decided from where the throw would come
// to rest (releaseSheet), as the squad sheet already does. Let go short of that, it settles
// back open on SHEET_SPRING. With reduced motion it fades in, still follows the finger while
// dragged, and settles back with a 150 ms ease instead of the spring.
//
// A modal dialog to assistive tech: focus moves into it when it opens, Tab stays inside it,
// and focus goes back where it was when it closes. `dismissible={false}` keeps it open
// until one of its own buttons closes it (no handle, no backdrop tap, no Escape).

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * @param {{ open: boolean, onClose: () => void, title?: React.ReactNode, label?: string,
 *   dismissible?: boolean, children: React.ReactNode }} props
 *   title: drawn as the sheet's heading and names the dialog; without one, `label` names it
 *   layer: the z-index to stand on (default LAYER.sheet); AR Scan's own sheets pass one above it
 */
export default function Sheet({ open, onClose, title, label, dismissible = true, layer = LAYER.sheet, children }) {
  const reduceMotion = useReducedMotion();
  const dragControls = useDragControls();
  // Drives the panel in, and back open after a release: the same y the drag moves.
  const controls = useAnimationControls();
  const panelRef = useRef(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = document.activeElement;
    const panel = panelRef.current;
    (panel?.querySelector(FOCUSABLE) ?? panel)?.focus();
    return () => {
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) previouslyFocused.focus();
    };
  }, [open]);

  const onKeyDown = (event) => {
    if (event.key === 'Escape' && dismissible) {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...(panelRef.current?.querySelectorAll(FOCUSABLE) ?? [])];
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  // In: rises on the sheet spring, or fades in with reduced motion. Started once the panel is
  // mounted (this effect runs after its children's), so the controls are already bound.
  useEffect(() => {
    if (!open) return;
    controls.start(reduceMotion ? { opacity: 1, transition: { duration: REDUCED_MOTION_S } } : { y: 0, transition: sheetSettle(false) });
  }, [open, reduceMotion, controls]);

  const panelMotion = reduceMotion
    ? { initial: { opacity: 0 }, exit: { opacity: 0, transition: { duration: REDUCED_MOTION_S } } }
    : { initial: { y: '100%' }, exit: { y: '100%', transition: sheetSettle(false) } };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0" style={{ zIndex: layer }} onKeyDown={onKeyDown}>
          <motion.div
            {...fade()}
            data-testid="sheet-backdrop"
            className="absolute inset-0 bg-backdrop"
            onClick={() => { if (dismissible) onClose(); }}
            aria-hidden="true"
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            aria-label={title ? undefined : label}
            tabIndex={-1}
            {...panelMotion}
            animate={controls}
            drag={dismissible ? 'y' : false}
            dragListener={false}
            dragControls={dragControls}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.06, bottom: 0.95 }}
            dragMomentum={false}
            onDragEnd={(_event, info) => {
              const height = panelRef.current?.offsetHeight || window.innerHeight;
              const release = releaseSheet(info.offset.y, info.velocity.y, height, reduceMotion);
              // Settled here rather than by the drag's own snap-back, which is always a spring:
              // this runs after it and takes over the same value.
              if (release.close) onClose();
              else controls.start({ y: 0, transition: release.transition });
            }}
            className="absolute inset-x-0 bottom-0 md:mx-auto md:max-w-xl max-h-[90dvh] [@media(max-height:699px)]:max-h-[94dvh] overflow-y-auto rounded-t-sheet glass-floating text-text font-ui outline-none"
            // Its last buttons end above the Emergency button, which stands over every sheet.
            style={{ paddingBottom: 'var(--emergency-clearance)' }}
          >
            {dismissible ? (
              <div
                className="flex justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing touch-none"
                onPointerDown={(event) => dragControls.start(event)}
                data-no-ping
                aria-hidden="true"
              >
                <span className="w-10 h-1 rounded-full bg-[var(--glass-border)]" />
              </div>
            ) : (
              <div className="pt-4" />
            )}
            {title && <h2 id={titleId} className="px-4 pb-2 text-title">{title}</h2>}
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
