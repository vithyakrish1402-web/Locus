import React from 'react';
import LocusMark from '../LocusMark';

// The LOCUS logo mark. It follows the theme (navy on light, white on dark), so it sits
// straight on the screen with no tile behind it.
// Supports sizes: large (auth/boot screens), medium, and small (top bar pill).

const SIZES = {
  large: 'w-16 h-16',
  medium: 'w-10 h-10',
  small: 'w-6 h-6',
};

export default function BrandMark({ size = 'large', className = '' }) {
  return (
    <span
      className={`inline-flex items-center justify-center shrink-0 ${SIZES[size] ?? SIZES.medium} ${className}`}
      aria-hidden="true"
    >
      <LocusMark className="w-full h-full" />
    </span>
  );
}
