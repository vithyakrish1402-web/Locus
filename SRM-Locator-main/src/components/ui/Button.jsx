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
  primary: 'bg-accent text-accent-on font-semibold shadow-[0_2px_10px_var(--color-accent-halo)] hover:opacity-95 active:scale-[0.98]',
  tonal: 'bg-accent-soft/80 text-accent font-semibold hover:bg-accent-soft active:scale-[0.98]',
  secondary: 'bg-sunken text-text font-medium hover:bg-surface active:scale-[0.98]',
  plain: 'bg-transparent text-text-secondary hover:text-text active:opacity-60',
  danger: 'bg-danger text-danger-on font-semibold shadow-[0_2px_10px_rgba(198,40,40,0.25)] hover:opacity-95 active:scale-[0.98]',
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
