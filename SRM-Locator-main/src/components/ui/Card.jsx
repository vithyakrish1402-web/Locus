import React from 'react';

// A surface card: rounded 16 px, the light first shadow, 16 px inside. `padded={false}`
// for cards whose rows run edge to edge (lists of options). It never shrinks: in a column
// layout, a card that clips its rows to its corners could otherwise be squeezed to nothing.

/**
 * @param {{ as?: React.ElementType, padded?: boolean } & React.HTMLAttributes<HTMLElement>} props
 */
export default function Card(allProps) {
  const { as: Tag = 'div', padded = true, glass = true, className = '', children, ...props } = allProps;
  const glassClasses = glass
    ? 'backdrop-blur-2xl bg-[var(--glass-bg)] border border-[var(--glass-border)] shadow-[var(--glass-shadow)]'
    : 'bg-surface border border-border shadow-[var(--shadow-1)]';

  return (
    <Tag
      className={`shrink-0 text-text font-ui rounded-[20px] transition-[transform,opacity] duration-200 ${glassClasses} ${padded ? 'p-4' : 'overflow-hidden'} ${className}`}
      style={{
        boxShadow: glass ? 'var(--glass-shadow), var(--glass-specular)' : undefined,
        ...props.style,
      }}
      {...props}
    >
      {children}
    </Tag>
  );
}

/** A refined Apple-style small heading above a card or group ("Appearance", "Location refresh rate"). */
export function SectionLabel(allProps) {
  const { as: Tag = 'h2', className = '', children, ...props } = allProps;
  return (
    <Tag className={`font-ui text-caption uppercase tracking-wider font-semibold text-text-secondary px-2 mb-2 select-none ${className}`} {...props}>
      {children}
    </Tag>
  );
}
