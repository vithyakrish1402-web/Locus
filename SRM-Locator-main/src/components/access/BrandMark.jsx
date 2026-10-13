import React from 'react';
import { ChevronUp } from 'lucide-react';

// The official LOCUS logo mark, showcasing the physical building emblem.
// Supports sizes: large (auth/boot screens), medium, and small (top bar pill).

const SIZES = {
  large: 'w-16 h-16 rounded-2xl shadow-md',
  medium: 'w-10 h-10 rounded-xl shadow-xs',
  small: 'w-6 h-6 rounded-lg',
};

export default function BrandMark({ size = 'large', className = '' }) {
  return (
    <span
      className={`inline-flex items-center justify-center overflow-hidden border border-black/10 dark:border-white/15 bg-white shrink-0 ${SIZES[size] ?? SIZES.medium} ${className}`}
      aria-hidden="true"
    >
      <img
        src="/logo_mark.jpg"
        alt="LOCUS Logo"
        className="w-full h-full object-cover"
      />
    </span>
  );
}
