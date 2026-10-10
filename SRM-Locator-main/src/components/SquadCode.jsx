import React, { useEffect, useId, useRef, useState } from 'react';
import { Check, Copy, RefreshCw, Share2 } from 'lucide-react';
import { haptic } from '../utils/haptics';
import { notify } from '../utils/notify';
import { copyText } from '../utils/clipboard';
import { Button } from './ui';
import { LOBBY } from '../copy/access';

// The lobby's group code, both ways round (redesign P3).
//
// CodeTiles shows a generated code as six tiles. One tap on them copies it; under them, Share
// code opens the phone's share sheet (Copy code where there isn't one) and New code makes
// another. (The tiles used to "decrypt" into place through random letters; they now simply
// show the code.)
//
// CodeInput is the join side: the same tiles, filled as you type or paste. Underneath is one
// real, transparent <input>, so the phone's keyboard, paste and autofill all behave normally,
// and Enter submits.

/** One character's tile. `tone`: 'filled' (a code you have), 'empty', 'active' (where the next
 *  character goes) or 'problem' (a code the server turned down: amber, never red). */
function Tile({ char, tone }) {
  const look = {
    filled: 'border-border-control bg-accent-soft text-text',
    empty: 'border-border-control bg-surface text-text',
    active: 'border-2 border-accent bg-surface text-text',
    problem: 'border-2 border-warning bg-surface text-text',
  }[tone];
  return (
    // Tiles share the row (a joining code can run to eight), up to 48 px each.
    <span className={`relative flex-1 min-w-0 max-w-12 flex items-center justify-center h-14 rounded-input border font-ui text-title tabular-nums ${look}`}>
      {char}
      {tone === 'active' && !char && (
        <span className="absolute bottom-3 left-1/2 -translate-x-1/2 w-4 h-0.5 rounded-full bg-accent locus-caret" aria-hidden="true" />
      )}
    </span>
  );
}

/**
 * A generated code, with copy, share and a new code.
 * @param {{ code: string, onNewCode?: () => void }} props
 */
export function CodeTiles({ code, onNewCode }) {
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef(null);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  const copy = async () => {
    if (!code) return;
    if (await copyText(code)) {
      haptic('confirm');
      setCopied(true);
      clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 1800);
    } else {
      notify.warning(LOBBY.copyFailed);
    }
  };

  const share = async () => {
    try {
      await navigator.share({ title: LOBBY.shareTitle, text: LOBBY.shareText(code) });
    } catch (err) {
      if (err?.name !== 'AbortError') copy(); // cancelled is fine; anything else, just copy
    }
  };

  const shown = code || '';
  return (
    <div className="flex flex-col gap-4 font-ui">
      {/* The real code, for screen readers (and tests). */}
      <span className="sr-only">{code || LOBBY.generating}</span>
      <button type="button" onClick={copy} aria-label={LOBBY.codeLabel(code)} className="flex justify-between gap-2" data-no-press>
        {Array.from({ length: Math.max(6, shown.length) }, (_, i) => (
          <Tile key={i} char={shown[i]} tone="filled" />
        ))}
      </button>
      <div className="flex gap-3">
        {canShare ? (
          <Button variant="tonal" icon={Share2} onClick={share} disabled={!code} className="flex-1">{LOBBY.share}</Button>
        ) : (
          <Button variant="tonal" icon={copied ? Check : Copy} onClick={copy} disabled={!code} className="flex-1">
            {copied ? LOBBY.copied : LOBBY.copy}
          </Button>
        )}
        {onNewCode && <Button variant="secondary" icon={RefreshCw} onClick={onNewCode} className="flex-1">{LOBBY.newCode}</Button>}
      </div>
    </div>
  );
}

/**
 * The join side: tiles over one real input.
 * @param {{ value: string, onChange: (code: string) => void, onSubmit?: () => void,
 *   problem?: boolean, describedBy?: string, maxLength?: number }} props
 *   problem: the server turned this code down (amber tiles); describedBy: the id of the text
 *   that says why, read with the field
 */
export function CodeInput({ value, onChange, onSubmit, problem = false, describedBy, maxLength = 8 }) {
  const [focused, setFocused] = useState(false);
  const inputRef = useRef(null);
  const id = useId();
  const tiles = Math.max(6, value.length);
  const activeIndex = Math.min(value.length, tiles - 1);

  const toneOf = (i) => {
    if (problem) return 'problem';
    if (focused && i === activeIndex && value.length < maxLength) return 'active';
    return 'empty';
  };

  return (
    <div className="relative" onClick={() => inputRef.current?.focus()}>
      <div className="flex justify-between gap-2" aria-hidden="true">
        {Array.from({ length: tiles }, (_, i) => <Tile key={i} char={value[i]} tone={toneOf(i)} />)}
      </div>
      <input
        ref={inputRef}
        id={id}
        type="text"
        placeholder={LOBBY.joinPlaceholder}
        aria-label={LOBBY.joinCode}
        aria-invalid={problem || undefined}
        aria-describedby={describedBy}
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
