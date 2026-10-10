import React from 'react';
import { ChevronUp } from 'lucide-react';

// The LOCUS mark: a white rounded chevron on an accent tile (the launcher icon's in-app twin).
// Decorative: the word LOCUS beside or under it carries the name.

const SIZES = { large: 'w-14 h-14 rounded-card', medium: 'w-10 h-10 rounded-input' };

export default function BrandMark({ size = 'large', className = '' }) {
  return (
    <span className={`inline-flex items-center justify-center bg-accent text-accent-on ${SIZES[size]} ${className}`} aria-hidden="true">
      <ChevronUp size={size === 'large' ? 30 : 22} strokeWidth={2.5} />
    </span>
  );
}
