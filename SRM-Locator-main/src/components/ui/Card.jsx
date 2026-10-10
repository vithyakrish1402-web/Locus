import React from 'react';

// A surface card: rounded 16 px, the light first shadow, 16 px inside. `padded={false}`
// for cards whose rows run edge to edge (lists of options). It never shrinks: in a column
// layout, a card that clips its rows to its corners could otherwise be squeezed to nothing.

/**
 * @param {{ as?: React.ElementType, padded?: boolean } & React.HTMLAttributes<HTMLElement>} props
 */
export default function Card(allProps) {
  const { as: Tag = 'div', padded = true, className = '', children, ...props } = allProps;
  return (
    <Tag className={`shrink-0 bg-surface text-text font-ui rounded-card shadow-[var(--shadow-1)] ${padded ? 'p-4' : 'overflow-hidden'} ${className}`} {...props}>
      {children}
    </Tag>
  );
}

/** A small heading above a card or group ("Appearance", "Location refresh rate"). */
export function SectionLabel(allProps) {
  const { as: Tag = 'h2', className = '', children, ...props } = allProps;
  return (
    <Tag className={`font-ui text-secondary font-semibold text-text-secondary px-1 mb-2 ${className}`} {...props}>
      {children}
    </Tag>
  );
}
