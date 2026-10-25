import React, { useRef, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useResolvedTheme } from '../../theme/useResolvedTheme';
import { transitionTheme } from '../../theme/transition';

/** Existing type prop is retained for compatibility; reveal starts at the button. */
export function AnimatedThemeToggleButton({ type = 'vertical', className = '' }) {
  const buttonRef = useRef(null);
  const theme = useResolvedTheme();
  const darkMode = theme === 'dark';
  const [busy, setBusy] = useState(false);
  const reduceMotion = useReducedMotion();
  const label = darkMode ? 'Light mode' : 'Dark mode';
  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    try { await transitionTheme(darkMode ? 'light' : 'dark', buttonRef.current); }
    finally { setBusy(false); }
  };
  return (
    <button ref={buttonRef} type="button" onClick={toggle} disabled={busy} aria-label={label}
      title={`Switch to ${label}`} aria-busy={busy}
      className={`inline-flex shrink-0 items-center justify-center rounded-full border border-accent/20 bg-accent-soft/85 text-accent shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent cursor-pointer disabled:cursor-wait ${className}`}
      style={{ width: 44, height: 44 }}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={theme} aria-hidden="true" className="inline-flex"
          initial={reduceMotion ? false : { opacity: 0, scale: 0.55, rotate: darkMode ? 25 : -25 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }} exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.33 }}>
          {darkMode ? <Sun size={22} className="text-yellow-400" /> : <Moon size={22} />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
