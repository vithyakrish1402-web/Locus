import React, { useId } from 'react';
import { AlertTriangle } from 'lucide-react';

// A labelled text input: label above, a 52 px field, an optional hint or problem below. A
// problem is amber with the alert icon (ordinary problems are never red), tied to the field
// so a screen reader reads it with it. `trailing` sits inside the field's right edge (the
// show-password eye). `invalid` outlines the field in amber without a note of its own, for a
// problem told elsewhere (an InlineMessage above the form). Disabled (while signing in), it
// greys out.

/**
 * @param {{ label: React.ReactNode, hint?: React.ReactNode, problem?: React.ReactNode,
 *   invalid?: boolean, trailing?: React.ReactNode, ref?: React.Ref<HTMLInputElement> }
 *   & React.InputHTMLAttributes<HTMLInputElement>} props
 */
export default function TextField({ label, hint, problem, invalid = false, trailing, id, className = '', ref, ...inputProps }) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const noteId = `${inputId}-note`;
  const note = problem ?? hint;
  return (
    <div className={`font-ui ${className}`}>
      <label htmlFor={inputId} className="block mb-2 text-caption uppercase tracking-wider font-semibold text-text-secondary px-1 select-none">{label}</label>
      <div className="relative">
        <input
          ref={ref}
          id={inputId}
          aria-invalid={problem || invalid ? true : undefined}
          aria-describedby={note ? noteId : undefined}
          className={`w-full min-h-[var(--size-input)] rounded-[16px] backdrop-blur-xl bg-[var(--glass-bg)] border px-4 text-body text-text placeholder:text-text-secondary/70 outline-none transition-[transform,opacity] duration-200 focus-visible:border-accent focus-visible:ring-[3px] focus-visible:ring-accent-halo disabled:bg-sunken disabled:text-text-secondary ${problem || invalid ? 'border-2 border-warning' : 'border-[var(--glass-border)]'} ${trailing ? 'pr-14' : ''}`}
          style={{
            boxShadow: 'var(--glass-shadow), var(--glass-specular)',
          }}
          {...inputProps}
        />
        {trailing && <div className="absolute inset-y-0 right-1 flex items-center">{trailing}</div>}
      </div>
      {note && (
        <p id={noteId} className={`mt-2 flex items-start gap-1.5 text-secondary px-1 ${problem ? 'text-warning font-medium' : 'text-text-secondary'}`}>
          {problem && <AlertTriangle size={15} className="shrink-0 mt-0.5" aria-hidden="true" />}
          {note}
        </p>
      )}
    </div>
  );
}
