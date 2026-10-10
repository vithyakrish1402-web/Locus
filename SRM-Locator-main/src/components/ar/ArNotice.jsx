import React from 'react';
import { AlertCircle } from 'lucide-react';

// One AR Scan notice (redesign AR Scan batch, piece 9): a translucent plate under the top
// controls, with an amber icon, a short title and plain words. Calibration, camera off and
// too dark are ordinary problems, so amber, never red. `visible` fades it in and out while it
// keeps its space (the calibration notice's no-jump rule); `steps` adds a short numbered list.
// eslint-disable-next-line no-unused-vars -- Icon is used as <Icon> (the linter can't see JSX use here)
export default function ArNotice({ testId, icon: Icon = AlertCircle, title, body, steps = null, visible = true }) {
  return (
    <div
      data-testid={testId}
      data-visible={visible ? 'true' : 'false'}
      role={visible ? 'status' : undefined}
      aria-hidden={!visible}
      className={`ar-plate mt-3 flex items-start gap-3 rounded-card border border-border shadow-[var(--shadow-2)] px-4 py-3 font-ui text-text transition-opacity duration-500 ${visible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
    >
      <Icon size={20} className="shrink-0 mt-0.5 text-warning" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-body font-semibold">{title}</p>
        {body && <p className="text-secondary text-text-secondary">{body}</p>}
        {steps && (
          <ol className="mt-1 list-decimal pl-5 text-secondary text-text-secondary">
            {steps.map((step) => <li key={step}>{step}</li>)}
          </ol>
        )}
      </div>
    </div>
  );
}
