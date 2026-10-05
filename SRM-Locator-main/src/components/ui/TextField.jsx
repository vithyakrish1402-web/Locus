import React, { useId } from 'react';
import { AlertTriangle } from 'lucide-react';

// A labelled text input: label above, a 52 px field, an optional hint or problem below. A
// problem is amber with the alert icon (ordinary problems are never red), tied to the field
// so a screen reader reads it with it. `trailing` sits inside the field's right edge (the
// show-password eye).

/**
 * @param {{ label: React.ReactNode, hint?: React.ReactNode, problem?: React.ReactNode,
 *   trailing?: React.ReactNode, ref?: React.Ref<HTMLInputElement> }
 *   & React.InputHTMLAttributes<HTMLInputElement>} props
 */
export default function TextField({ label, hint, problem, trailing, id, className = '', ref, ...inputProps }) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const noteId = `${inputId}-note`;
  const note = problem ?? hint;
  return (
    <div className={`font-ui ${className}`}>
      <label htmlFor={inputId} className="block mb-2 text-label text-text">{label}</label>
      <div className="relative">
        <input
          ref={ref}
          id={inputId}
          aria-invalid={problem ? true : undefined}
          aria-describedby={note ? noteId : undefined}
          className={`w-full min-h-[var(--size-input)] rounded-input border bg-surface px-4 text-body text-text placeholder:text-text-secondary outline-none focus-visible:border-accent focus-visible:ring-[3px] focus-visible:ring-accent-halo ${problem ? 'border-warning' : 'border-border-control'} ${trailing ? 'pr-14' : ''}`}
          {...inputProps}
        />
        {trailing && <div className="absolute inset-y-0 right-1 flex items-center">{trailing}</div>}
      </div>
      {note && (
        <p id={noteId} className={`mt-2 flex items-start gap-1.5 text-secondary ${problem ? 'text-warning' : 'text-text-secondary'}`}>
          {problem && <AlertTriangle size={16} className="shrink-0 mt-px" aria-hidden="true" />}
          {note}
        </p>
      )}
    </div>
  );
}
