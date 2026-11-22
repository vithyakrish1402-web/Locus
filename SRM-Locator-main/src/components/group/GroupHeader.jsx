import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, ShieldCheck } from 'lucide-react';
import { Chip, AnimatedThemeToggler } from '../ui';
import { copyText } from '../../utils/clipboard';
import { GROUP_HEADER } from '../../copy/group';

// The group panel's header (redesign Group panel batch), on one row: your role, the group code as
// one chip that copies it when tapped, and the light/dark mode switch. No title of its own: the
// page's title bar above it already says "Your group" (it used to say it twice).

/**
 * @param {{ isLead: boolean, code: string, children?: React.ReactNode }} props
 *   children: drawn under the code row (the peek height's lines)
 */
export default function GroupHeader({ isLead, code, children }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    if (!(await copyText(code))) return;
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div data-testid="group-header" className="px-4 pb-3 font-ui text-text">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {isLead ? (
          <Chip icon={ShieldCheck}>{GROUP_HEADER.lead}</Chip>
        ) : (
          <Chip tone="neutral">{GROUP_HEADER.member}</Chip>
        )}
        <button
          type="button"
          onClick={copy}
          disabled={!code}
          aria-label={copied ? GROUP_HEADER.copied : GROUP_HEADER.copy}
          title={copied ? GROUP_HEADER.copied : GROUP_HEADER.copy}
          className="inline-flex items-center gap-2 min-h-11 px-3.5 rounded-full border border-border bg-sunken text-secondary font-semibold text-text tabular-nums active:scale-95 transition-transform focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
        >
          <span data-testid="group-code">{GROUP_HEADER.code(code)}</span>
          {copied ? <Check size={16} className="text-success" aria-hidden="true" /> : <Copy size={16} className="text-text-secondary" aria-hidden="true" />}
        </button>
        <span className="ml-auto flex items-center" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          <AnimatedThemeToggler className="w-10 h-10 rounded-xl bg-surface-raised border border-border-control/25 hover:border-accent/40 shadow-xs active:scale-95 transition-all text-text" />
        </span>
      </div>
      {children}
    </div>
  );
}
