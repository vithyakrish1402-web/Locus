import React from 'react';

// The redesign's buttons (docs/redesign/handoff.md; tokens in src/theme/tokens.css). Pill
// shaped, Inter label, at least 48 px tall (56 for `large`), and they grow with the text
// size rather than clipping it.
//
//   primary    the one main action on a screen (Sign in, Navigate)
//   tonal      a secondary action that still matters (AR Scan, Turn on location)
//   secondary  a neutral action on a surface (Cancel)
//   plain      a text link (Forgot password?)
//   danger     ONLY the Emergency alert, Leave group, Remove and block and Vote to remove.
//              Ordinary problems are never red; they use the warning (amber) role.

const VARIANTS = {
  primary: 'bg-accent text-accent-on active:bg-accent-pressed',
  tonal: 'bg-accent-soft text-accent',
  secondary: 'bg-surface text-text border border-border-control',
  plain: 'bg-transparent text-accent',
  danger: 'bg-danger text-danger-on active:bg-danger-pressed',
};

const SIZES = {
  medium: 'min-h-[var(--size-button)] px-5',
  large: 'min-h-[var(--size-button-large)] px-6',
};

export const BUTTON_FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

/**
 * @param {{ variant?: keyof VARIANTS, size?: 'medium'|'large', block?: boolean,
 *   icon?: React.ComponentType<{size?: number}>, ref?: React.Ref<HTMLButtonElement> }
 *   & React.ButtonHTMLAttributes<HTMLButtonElement>} props
 */
export default function Button({
  variant = 'primary',
  size = 'medium',
  block = false,
  icon: Icon = null,
  type = 'button',
  className = '',
  children,
  ref,
  ...props
}) {
  const box = variant === 'plain' ? 'min-h-[var(--size-touch)] px-2' : SIZES[size];
  return (
    <button
      ref={ref}
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded-full font-ui text-label text-center ${box} ${VARIANTS[variant]} ${block ? 'w-full' : ''} ${BUTTON_FOCUS} disabled:opacity-40 disabled:pointer-events-none ${className}`}
      {...props}
    >
      {Icon && <Icon size={20} aria-hidden="true" />}
      {children}
    </button>
  );
}
