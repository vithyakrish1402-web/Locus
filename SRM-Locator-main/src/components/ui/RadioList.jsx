import React, { useRef } from 'react';

// Choices as rows, each with a line explaining it (Location refresh rate: Battery saver /
// Standard / Fast). Meant to sit in a Card with padded={false}. Same keyboard behaviour as a
// native radio group: one Tab stop, arrows move the choice.

/**
 * @param {{ label: string, value: string, onChange: (value: string) => void,
 *   options: Array<{ value: string, label: React.ReactNode, description?: React.ReactNode }> }} props
 */
export default function RadioList({ label, value, onChange, options, className = '' }) {
  const rows = useRef([]);

  const onKeyDown = (event, index) => {
    const moves = { ArrowDown: index + 1, ArrowRight: index + 1, ArrowUp: index - 1, ArrowLeft: index - 1, Home: 0, End: options.length - 1 };
    if (!(event.key in moves)) return;
    event.preventDefault();
    const next = (moves[event.key] + options.length) % options.length;
    onChange(options[next].value);
    rows.current[next]?.focus();
  };

  return (
    <div role="radiogroup" aria-label={label} className={`font-ui divide-y divide-border ${className}`}>
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => { rows.current[index] = el; }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            data-no-press
            className="w-full flex items-center gap-4 px-4 py-3 min-h-14 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
          >
            <span
              className={`shrink-0 flex items-center justify-center w-6 h-6 rounded-full border-2 ${selected ? 'border-accent' : 'border-border-control'}`}
              aria-hidden="true"
            >
              {selected && <span className="w-3 h-3 rounded-full bg-accent" />}
            </span>
            <span className="min-w-0">
              <span className="block text-body text-text">{option.label}</span>
              {option.description && <span className="block text-secondary text-text-secondary">{option.description}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
