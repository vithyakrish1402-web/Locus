import React, { useEffect, useRef, useState } from 'react';
// eslint-disable-next-line no-unused-vars -- motion is used as <motion.span>, which this config can't see
import { motion, useReducedMotion } from 'framer-motion';
import { Check, Copy, Share2 } from 'lucide-react';
import { SQUAD_CODE_ALPHABET } from '../utils/squadCode';
import { haptic } from '../utils/haptics';
import { notify } from '../utils/notify';
import { copyText } from '../utils/clipboard';

// The lobby's squad code, both ways round.
//
// CodeTiles shows a generated code as six tiles that "decrypt" into place, and gives the
// lobby what its own caption asked for but never offered: a way to share the code. One tap
// copies it; where the platform has a share sheet, a second button opens it.
//
// CodeInput is the join side: the same tiles, filled as you type or paste. Underneath is
// one real, transparent <input>, so the phone's keyboard, paste and autofill all behave
// normally, and Enter submits (it used to do nothing).

const DECRYPT_TICK_MS = 45;
const DECRYPT_BASE_MS = 260; // first tile settles after this; each next one a beat later
const DECRYPT_STEP_MS = 70;

const randomChar = () => SQUAD_CODE_ALPHABET[Math.floor(Math.random() * SQUAD_CODE_ALPHABET.length)];

function Tile({ char, settled, active, reduceMotion }) {
  return (
    <span
      className={`relative flex items-center justify-center w-10 h-12 sm:w-11 sm:h-13 border font-dot text-2xl transition-colors duration-200 ${
        active
          ? 'border-red-500 bg-red-500/10 text-red-400 shadow-[0_0_14px_rgba(239,68,68,0.35)]'
          : settled
            ? 'border-red-500/45 bg-red-500/[0.06] text-red-500'
            : 'border-white/15 bg-white/[0.03] text-zinc-500'
      }`}
    >
      {char ? (
        <motion.span
          key={settled ? `set-${char}` : 'scramble'}
          initial={settled && !reduceMotion ? { y: -6, opacity: 0.4, filter: 'blur(3px)' } : false}
          animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
          transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
        >
          {char}
        </motion.span>
      ) : null}
      {active && <span className="absolute bottom-2 left-1/2 -translate-x-1/2 w-4 h-0.5 bg-red-500 locus-caret" aria-hidden="true" />}
    </span>
  );
}

/** A generated code, decrypted into six tiles, with copy and share. */
export function CodeTiles({ code }) {
  const reduceMotion = useReducedMotion();
  // The decrypt animation's latest frame, tagged with the code it belongs to. Only the timer
  // writes it; a frame for an older code is ignored, and with reduced motion (or no code)
  // the tiles simply show the code.
  const [frame, setFrame] = useState({ for: code, shown: code || '', settled: code ? code.length : 0 });
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef(null);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  useEffect(() => {
    if (!code || reduceMotion) return undefined;
    const started = performance.now();
    const timer = setInterval(() => {
      const elapsed = performance.now() - started;
      const settled = Math.min(code.length, Math.max(0, Math.floor((elapsed - DECRYPT_BASE_MS) / DECRYPT_STEP_MS) + 1));
      setFrame({ for: code, shown: code.split('').map((c, i) => (i < settled ? c : randomChar())).join(''), settled });
      if (settled >= code.length) clearInterval(timer);
    }, DECRYPT_TICK_MS);
    return () => clearInterval(timer);
  }, [code, reduceMotion]);

  const animating = Boolean(code) && !reduceMotion;
  const current = animating && frame.for === code ? frame : null;
  const shown = animating ? (current?.shown ?? '') : (code || '');
  const settledCount = animating ? (current?.settled ?? 0) : (code ? code.length : 0);

  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  const copy = async () => {
    if (!code) return;
    if (await copyText(code)) {
      haptic('confirm');
      setCopied(true);
      clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 1800);
    } else {
      notify.warning('Could not reach the clipboard. Read the code out instead.', { title: 'COPY_FAILED' });
    }
  };

  const share = async () => {
    try {
      await navigator.share({ title: 'LOCUS squad', text: `Join my LOCUS squad with code ${code}` });
    } catch (err) {
      if (err?.name !== 'AbortError') copy(); // cancelled is fine; anything else, just copy
    }
  };

  return (
    <div className="flex flex-col items-center gap-3">
      {/* The real code, for screen readers (and tests) - the tiles may be mid-scramble. */}
      <span className="sr-only">{code || 'GENERATING...'}</span>
      <button
        type="button"
        onClick={copy}
        aria-label={`Squad code ${code ? code.split('').join(' ') : 'generating'}. Tap to copy.`}
        className="flex gap-1.5 sm:gap-2"
        data-no-press
      >
        {Array.from({ length: Math.max(6, shown.length) }, (_, i) => (
          <Tile key={i} char={shown[i]} settled={i < settledCount} reduceMotion={reduceMotion} />
        ))}
      </button>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={copy}
          disabled={!code}
          className={`flex items-center gap-1.5 px-3 py-1.5 border font-dot text-[10px] uppercase tracking-widest ${
            copied ? 'border-emerald-500/60 text-emerald-400 bg-emerald-500/10' : 'border-white/20 text-zinc-300 hover:border-white/50'
          }`}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'COPIED' : 'COPY CODE'}
        </button>
        {canShare && (
          <button
            type="button"
            onClick={share}
            disabled={!code}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-white/20 text-zinc-300 hover:border-white/50 font-dot text-[10px] uppercase tracking-widest"
          >
            <Share2 size={12} /> SHARE
          </button>
        )}
      </div>
    </div>
  );
}

/** The join side: tiles over one real input. */
export function CodeInput({ value, onChange, onSubmit, placeholder = 'E.G. KTR7X9', maxLength = 8 }) {
  const reduceMotion = useReducedMotion();
  const [focused, setFocused] = useState(false);
  const inputRef = useRef(null);
  const tiles = Math.max(6, value.length);

  return (
    <div className="relative" onClick={() => inputRef.current?.focus()}>
      <div className="flex justify-center gap-1.5 sm:gap-2" aria-hidden="true">
        {Array.from({ length: tiles }, (_, i) => (
          <Tile
            key={i}
            char={value[i] ?? (value.length === 0 && !focused ? placeholder.replace(/^E\.G\.\s*/, '')[i] : '')}
            settled={i < value.length}
            active={focused && i === Math.min(value.length, tiles - 1) && value.length < maxLength}
            reduceMotion={reduceMotion}
          />
        ))}
      </div>
      <input
        ref={inputRef}
        type="text"
        placeholder={placeholder}
        aria-label="Squad code"
        value={value}
        maxLength={maxLength}
        autoCapitalize="characters"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="go"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => onChange(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, maxLength))}
        onKeyDown={(e) => { if (e.key === 'Enter' && value) onSubmit?.(); }}
        className="absolute inset-0 w-full h-full bg-transparent text-transparent caret-transparent placeholder:text-transparent outline-none cursor-text"
        data-no-ping
      />
    </div>
  );
}
