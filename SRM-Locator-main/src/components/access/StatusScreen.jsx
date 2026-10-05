import React, { useEffect, useId, useRef } from 'react';

// A full-screen moment on the way in (Waiting for approval, Request not approved, You're in):
// a tinted round icon, a title, a sentence, and one action at the bottom.
//
// Drawn over the map screen, its tab bar and its floating meeting-point button (z 1100 and
// below), and under the Emergency button (z 1150), which stays where it always is. The action
// sits at the very bottom, under that button's spot, so the two never overlap.
//
// role="dialog": focus moves to its heading when it appears, so a screen reader announces
// where the person now is.

export const STATUS_SCREEN_Z = 1120;

const TONES = {
  accent: 'bg-accent-soft text-accent',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
};

/**
 * @param {{ icon: React.ReactNode, tone?: keyof TONES, title: React.ReactNode,
 *   children?: React.ReactNode, action?: React.ReactNode, testId?: string }} props
 *   children: the sentence, and anything under it (a status chip)
 */
export default function StatusScreen({ icon, tone = 'accent', title, children, action, testId }) {
  const titleId = useId();
  const headingRef = useRef(null);
  useEffect(() => { headingRef.current?.focus(); }, []);

  return (
    <div
      role="dialog"
      aria-labelledby={titleId}
      data-testid={testId}
      className="fixed inset-0 flex flex-col bg-bg text-text font-ui px-5 pointer-events-auto"
      style={{ zIndex: STATUS_SCREEN_Z, paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
    >
      <div className="flex-1 flex flex-col items-center justify-center text-center max-w-md w-full mx-auto">
        <span className={`flex items-center justify-center w-22 h-22 rounded-full ${TONES[tone]}`} aria-hidden="true">{icon}</span>
        <h1 id={titleId} ref={headingRef} tabIndex={-1} className="mt-6 text-display outline-none">{title}</h1>
        <div className="mt-3 text-body text-text-secondary flex flex-col items-center gap-5">{children}</div>
      </div>
      {action && <div className="max-w-md w-full mx-auto">{action}</div>}
    </div>
  );
}
