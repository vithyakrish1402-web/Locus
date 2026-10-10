import React from 'react';

// A row: something at the start (an avatar, an icon), a title with an optional line under
// it, and something at the end (a distance, a badge, a menu button). With `onClick` the row
// is one button (an action in a sheet: Ping Meera, Find with AR Scan). `danger` is only for
// the destructive actions (Remove and block, Vote to remove). Put rows in a container with
// `divide-y divide-border` for the dividers.

/**
 * @param {{ leading?: React.ReactNode, title: React.ReactNode, description?: React.ReactNode,
 *   trailing?: React.ReactNode, onClick?: () => void, danger?: boolean, disabled?: boolean }} props
 */
export default function ListRow({ leading, title, description, trailing, onClick, danger = false, disabled = false, className = '' }) {
  const body = (
    <>
      {leading && <span className={`shrink-0 flex items-center ${danger ? 'text-danger' : 'text-accent'}`}>{leading}</span>}
      <span className="min-w-0 flex-1">
        <span className={`block text-body ${danger ? 'text-danger' : 'text-text'}`}>{title}</span>
        {description && <span className="block text-secondary text-text-secondary">{description}</span>}
      </span>
      {trailing && <span className="shrink-0 flex items-center gap-2 text-text-secondary">{trailing}</span>}
    </>
  );
  const box = `w-full flex items-center gap-4 px-4 py-3 min-h-14 font-ui text-left ${className}`;
  if (!onClick) return <div className={box}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-no-press
      className={`${box} active:bg-sunken focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent disabled:opacity-40`}
    >
      {body}
    </button>
  );
}
