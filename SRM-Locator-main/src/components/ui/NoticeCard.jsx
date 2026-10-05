import React from 'react';
import { AlertTriangle, Check, Info, OctagonAlert, X } from 'lucide-react';
import IconButton from './IconButton';

// A message on a card: a tinted round icon, a short title, an optional sentence under it,
// and optionally a close button and an action. The same card serves the notifications that
// drop in under the top bar and the cards that sit on a screen (Location is off).
//
//   info     neutral news, and pings
//   success  something worked
//   warning  every ordinary problem: amber, with the alert icon
//   danger   only an emergency or a destructive action's own message. Never for errors.

const TONES = {
  info: { Icon: Info, disc: 'bg-accent-soft text-accent' },
  success: { Icon: Check, disc: 'bg-success-soft text-success' },
  warning: { Icon: AlertTriangle, disc: 'bg-warning-soft text-warning' },
  danger: { Icon: OctagonAlert, disc: 'bg-danger-soft text-danger' },
};

/**
 * @param {{ tone?: keyof TONES, title: React.ReactNode, children?: React.ReactNode,
 *   icon?: React.ComponentType<{size?: number}>, onDismiss?: () => void, action?: React.ReactNode,
 *   role?: string }} props
 */
export default function NoticeCard({ tone = 'info', title, children, icon, onDismiss, action, role = 'status', className = '', ...props }) {
  const { Icon: ToneIcon, disc } = TONES[tone];
  const Icon = icon ?? ToneIcon;
  return (
    <div
      role={role}
      className={`bg-raised text-text font-ui rounded-card shadow-[var(--shadow-2)] p-4 ${className}`}
      {...props}
    >
      <div className="flex items-start gap-3">
        <span className={`shrink-0 flex items-center justify-center w-10 h-10 rounded-full ${disc}`} aria-hidden="true">
          <Icon size={20} />
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="text-heading">{title}</p>
          {children && <div className="mt-0.5 text-secondary text-text-secondary">{children}</div>}
        </div>
        {onDismiss && <IconButton label="Dismiss" icon={X} onClick={onDismiss} className="-mr-2 -mt-2 shrink-0" />}
      </div>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
