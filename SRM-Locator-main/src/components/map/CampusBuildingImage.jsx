import React, { useState } from 'react';
import { Building2 } from 'lucide-react';

/**
 * High-performance, fault-tolerant building image component.
 * Features shimmer loading, multi-source fallback, and beautiful glassmorphic vector backup.
 */
export default function CampusBuildingImage({
  src,
  alt = 'Building',
  className = '',
  containerClassName = '',
  aspectRatio = 'aspect-video',
  fallbackSrc = null
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [triedFallback, setTriedFallback] = useState(false);

  const handleError = () => {
    if (!triedFallback && fallbackSrc && fallbackSrc !== src) {
      setTriedFallback(true);
    } else {
      setFailed(true);
    }
  };

  const currentSrc = triedFallback ? fallbackSrc : src;

  return (
    <div
      className={`relative overflow-hidden bg-slate-100 dark:bg-slate-800/60 ${aspectRatio} ${containerClassName}`}
    >
      {/* Shimmer skeleton while loading */}
      {!loaded && !failed && (
        <div className="absolute inset-0 bg-gradient-to-r from-slate-200 via-slate-100 to-slate-200 dark:from-slate-800 dark:via-slate-700 dark:to-slate-800 animate-pulse" />
      )}

      {failed ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-blue-50/80 to-indigo-100/80 dark:from-slate-800 dark:to-slate-900 text-blue-600 dark:text-blue-400 p-2 text-center select-none">
          <div className="w-10 h-10 rounded-xl bg-white/80 dark:bg-slate-800/80 shadow-xs flex items-center justify-center border border-white/60 dark:border-white/10 mb-1">
            <Building2 size={20} className="stroke-[1.75]" />
          </div>
          <span className="text-[11px] font-medium tracking-tight opacity-75 line-clamp-1">{alt}</span>
        </div>
      ) : (
        <img
          src={currentSrc}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={handleError}
          className={`w-full h-full object-cover transition-[transform,opacity] duration-300 ${
            loaded ? 'opacity-100 scale-100' : 'opacity-0 scale-[1.02]'
          } ${className}`}
        />
      )}
    </div>
  );
}
