import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, ShieldCheck } from 'lucide-react';
import { Chip, IconButton } from '../ui';
import { copyText } from '../../utils/clipboard';
import { GROUP_HEADER } from '../../copy/group';

// The group panel's header (redesign Group panel batch): "Your group", your role, the group
// code and Copy (the design's share button; sharing needs a native plugin, on the Later list).
// On a phone it is also the panel's drag handle, so its own buttons stop the press from
// starting a drag or a tap on the header.

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
      <div className="flex items-center gap-3">
        <h2 className="flex-1 min-w-0 text-title truncate">{GROUP_HEADER.title}</h2>
        <span onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
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
