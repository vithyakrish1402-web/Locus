import React from 'react';
import { AlertCircle, Check, Info } from 'lucide-react';

// A message that sits in the page, above what it is about (That email and password don't
// match; We sent a password reset link): a tinted card with an icon. Problems are amber,
// never red. A warning is announced as it appears (role="alert"); the others politely.

const TONES = {
  warning: { Icon: AlertCircle, box: 'bg-warning-soft', icon: 'text-warning', role: 'alert' },
  success: { Icon: Check, box: 'bg-success-soft', icon: 'text-success', role: 'status' },
  info: { Icon: Info, box: 'bg-accent-soft', icon: 'text-accent', role: 'status' },
};

/** @param {{ tone?: keyof TONES, children: React.ReactNode }} props */
export default function InlineMessage({ tone = 'warning', className = '', children }) {
  const { Icon, box, icon, role } = TONES[tone];
  return (
    <div role={role} className={`flex items-start gap-3 rounded-card p-4 font-ui text-body text-text ${box} ${className}`}>
      <Icon size={22} className={`shrink-0 mt-px ${icon}`} aria-hidden="true" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
