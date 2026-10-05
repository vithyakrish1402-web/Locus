import React from 'react';
import { BUTTON_FOCUS } from './Button';

// A round button that is only an icon (close, share, map controls). Always 44 px or more
// to touch, and always named (`label`) for screen readers, since there is no text.
//
//   plain    no fill (close X, overflow menu)
//   tonal    accent-soft disc (share)
//   raised   a floating control over the map: raised surface with a shadow

const VARIANTS = {
  plain: 'text-text-secondary',
  tonal: 'bg-accent-soft text-accent',
  raised: 'bg-raised text-text shadow-[var(--shadow-2)]',
};

/**
 * @param {{ label: string, icon: React.ComponentType<{size?: number}>, variant?: keyof VARIANTS,
 *   size?: number, ref?: React.Ref<HTMLButtonElement> } & React.ButtonHTMLAttributes<HTMLButtonElement>} props
 *   size: the icon's size in px (default 22)
 */
export default function IconButton(allProps) {
  const { label, icon: Icon, variant = 'plain', size = 22, className = '', type = 'button', ref, ...props } = allProps;
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={`inline-flex items-center justify-center rounded-full min-w-[var(--size-touch)] min-h-[var(--size-touch)] ${VARIANTS[variant]} ${BUTTON_FOCUS} disabled:opacity-40 disabled:pointer-events-none ${className}`}
      {...props}
    >
      <Icon size={size} aria-hidden="true" />
    </button>
  );
}
