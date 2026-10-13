import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, ShieldCheck, Sun, Moon } from 'lucide-react';
import { Chip, IconButton } from '../ui';
import { copyText } from '../../utils/clipboard';
import { GROUP_HEADER } from '../../copy/group';
import { setThemePreference } from '../../theme/theme';
import { useResolvedTheme } from '../../theme/useResolvedTheme';

// The group panel's header (redesign Group panel batch): "Your group", your role, the group
// code, Copy and light/dark mode switch.

/**
 * @param {{ isLead: boolean, code: string, children?: React.ReactNode }} props
 *   children: drawn under the code row (the peek height's lines)
 */
export default function GroupHeader({ isLead, code, children }) {
  const [copied, setCopied] = useState(false);
  const theme = useResolvedTheme();
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
      <div className="flex items-center gap-3">
        <h2 className="flex-1 min-w-0 text-title truncate">{GROUP_HEADER.title}</h2>
        <span className="flex items-center gap-1.5" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          <IconButton
            variant="tonal"
            label={theme === 'dark' ? 'Light mode' : 'Dark mode'}
            icon={theme === 'dark' ? Sun : Moon}
            onClick={() => setThemePreference(theme === 'dark' ? 'light' : 'dark')}
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          />
          <IconButton
            variant="tonal"
            label={copied ? GROUP_HEADER.copied : GROUP_HEADER.copy}
            icon={copied ? Check : Copy}
            onClick={copy}
            disabled={!code}
          />
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        {isLead ? (
          <Chip icon={ShieldCheck}>{GROUP_HEADER.lead}</Chip>
        ) : (
          <Chip tone="neutral">{GROUP_HEADER.member}</Chip>
        )}
        <span className="text-secondary text-text-secondary tabular-nums" data-testid="group-code">{GROUP_HEADER.code(code)}</span>
      </div>
      {children}
    </div>
  );
}
