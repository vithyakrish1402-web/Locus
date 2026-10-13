import React, { useId, useRef } from 'react';
// eslint-disable-next-line no-unused-vars -- motion is used as <motion.span>, which this config can't see
import { motion, useReducedMotion } from 'framer-motion';
import { INDICATOR_SPRING } from '../../utils/motion';

// A row of mutually exclusive choices on one track (Live / Paused / Hidden; System / Light /
// Dark; Efficient / Standard / Realistic). The selected one sits on a raised thumb that
// slides between them on INDICATOR_SPRING; with reduced motion it jumps.
//
// A radio group to assistive tech: one stop in the Tab order (the selected option), and the
// arrow keys, Home and End move the choice, as a native radio group does.

/**
 * @param {{ label: string, value: string, onChange: (value: string) => void,
 *   options: Array<{ value: string, label: React.ReactNode, icon?: React.ComponentType<{size?: number}>,
 *   leading?: React.ReactNode }> }} props
 *   label: names the group for screen readers (it may have no visible heading)
 *   leading: something drawn before an option's label, e.g. a StatusDot's dot
 */
export default function SegmentedControl({ label, value, onChange, options, className = '' }) {
  const reduceMotion = useReducedMotion();
  const thumbId = useId();
  const buttons = useRef([]);

  const choose = (index) => {
    const option = options[(index + options.length) % options.length];
    onChange(option.value);
    buttons.current[options.indexOf(option)]?.focus();
  };

  const onKeyDown = (event, index) => {
    const moves = { ArrowRight: index + 1, ArrowDown: index + 1, ArrowLeft: index - 1, ArrowUp: index - 1, Home: 0, End: options.length - 1 };
    if (!(event.key in moves)) return;
    event.preventDefault();
    choose(moves[event.key]);
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`flex p-1 rounded-full bg-[var(--glass-sunken)] backdrop-blur-xl border border-[var(--glass-border-subtle)] font-ui shadow-inner ${className}`}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            ref={(el) => { buttons.current[index] = el; }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={`relative flex-1 min-h-[var(--size-touch)] px-3 rounded-full text-label focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent select-none cursor-pointer duration-200 ${
              selected ? 'text-text font-semibold' : 'text-text-secondary hover:text-text'
            }`}
            data-no-press
          >
            {selected && (
              <motion.span
                layoutId={`segment-thumb-${thumbId}`}
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : { type: 'spring', stiffness: 450, damping: 35, mass: 0.8 }
                }
                className="absolute inset-0 rounded-full bg-[var(--color-surface)] border border-[var(--glass-border)]"
                style={{
                  boxShadow: '0 2px 10px rgba(0,0,0,0.1), var(--glass-specular)',
                }}
                aria-hidden="true"
              />
            )}
            <span className="relative z-10 inline-flex items-center justify-center gap-2 transition-transform duration-150">
              {option.leading}
              {Icon && <Icon size={18} aria-hidden="true" className="transition-transform duration-200" />}
              {option.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
