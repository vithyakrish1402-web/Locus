import React from 'react';
import { LogOut, ShieldAlert, Sliders } from 'lucide-react';
import BrandMark from '../access/BrandMark';
import { IconButton, StatusDot } from '../ui';
import { SHARING_CHIP, TOP_BAR } from '../../copy/map';
import { TOP_BAR_HEIGHT, TOP_BAR_TOP } from '../../utils/mapChrome';
import { SETTINGS } from '../../copy/settings';

// The map screen's top bar (redesign Map batch): the LOCUS mark, "LOCUS" and which map is
// showing, then Sign out. On a phone Settings stays the gear in the map's right-hand column
// (owner's decision); on a wider screen the bar also has Settings, and the admin tools for
// the admin account, as before.
//
// A floating card over the map at z-[1000], as the old bar was.

/**
 * @param {{ isSatellite: boolean, onSignOut: () => void, onSettings: () => void,
 *   isAdmin?: boolean, onAdmin?: () => void }} props
 */
export function TopBar({ isSatellite, onSignOut, onSettings, isAdmin = false, onAdmin }) {
  return (
    <nav
      aria-label="Top bar"
      data-testid="top-bar"
      className="absolute inset-x-3 z-[1000] flex items-center gap-3 rounded-card bg-raised text-text font-ui shadow-[var(--shadow-2)] pl-3 pr-1 pointer-events-auto md:inset-x-auto md:left-3 md:right-3"
      style={{ top: TOP_BAR_TOP, minHeight: TOP_BAR_HEIGHT }}
    >
      <BrandMark size="medium" />
      <div className="flex-1 min-w-0 leading-tight">
        <p className="text-heading">{TOP_BAR.name}</p>
        <p className="text-secondary text-text-secondary">{isSatellite ? TOP_BAR.satelliteView : TOP_BAR.mapView}</p>
      </div>
      {/* Wider screens only (a wrapper: the button's own inline-flex would beat "hidden"). */}
      <span className="hidden md:flex">
        {isAdmin && <IconButton label="Admin settings" icon={ShieldAlert} onClick={onAdmin} />}
        <IconButton label={SETTINGS.open} icon={Sliders} onClick={onSettings} />
      </span>
      <IconButton label={TOP_BAR.signOut} icon={LogOut} onClick={onSignOut} />
    </nav>
  );
}

const DOT = { ACTIVE: 'live', FROZEN: 'paused', GHOST: 'hidden' };

/**
 * The sharing chip, first in the stack under the top bar (App.jsx): your own setting, in
 * words. No button on it (the design's Pause on the chip is not in this phase).
 * @param {{ mode: 'ACTIVE'|'FROZEN'|'GHOST' }} props
 */
export function SharingChip({ mode }) {
  return (
    <div className="flex">
      <p
        data-testid="sharing-chip"
        data-mode={mode}
        className="inline-flex items-center min-h-11 max-w-full rounded-[1.375rem] bg-raised px-4 py-2 shadow-[var(--shadow-2)] font-ui"
      >
        <StatusDot status={DOT[mode] ?? 'live'}>
          <span className="text-label text-text">{SHARING_CHIP[mode] ?? SHARING_CHIP.ACTIVE}</span>
        </StatusDot>
      </p>
    </div>
  );
}
