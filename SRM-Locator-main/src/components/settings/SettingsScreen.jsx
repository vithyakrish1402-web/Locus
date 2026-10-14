import React, { useEffect, useId, useRef, useState } from 'react';
import {
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  Info,
  LogOut,
  Map as MapIcon,
  Moon,
  Radio,
  RefreshCw,
  ShieldAlert,
  Sliders,
  Smartphone,
  Sun,
  UserRound,
  Volume2
} from 'lucide-react';
import { Button, Card, IconButton, ListRow, RadioList, SectionLabel, SegmentedControl, Switch } from '../ui';
import SendApp from '../SendApp';
import { SETTINGS } from '../../copy/settings';
import { setThemePreference, subscribeTheme, getThemePreference } from '../../theme/theme';
import LocusMark from '../LocusMark';
import { AR_FEATURE_OPTIONS } from '../../utils/arFeatures';
import { MAP_STATUS_LABEL, MAP_STATUS_REASON_TEXT } from '../../utils/mapEngineStatus';

// Settings, as a full screen (redesign P9). Opened from the gear in the map's right-hand
// column. Organized cleanly with iOS/macOS styled categorized cards and collapsible advanced tools.
export const SETTINGS_Z = 5000;

const THEME_ICONS = { system: Smartphone, light: Sun, dark: Moon };

/**
 * @param {{ onClose: () => void,
 *   polling: 'eco'|'standard'|'max', onPolling: (v: string) => void,
 *   arFidelity: 'efficient'|'standard'|'realistic', onArFidelity: (v: string) => void,
 *   alertSounds: boolean, onAlertSounds: (on: boolean) => void,
 *   isSatellite: boolean, onSatellite: (on: boolean) => void,
 *   mapStatus: { engine: 'google'|'backup', reason: string },
 *   arFeatureOverrides: Record<string, string>, onArFeatureOverride: (feature: string, value: string) => void,
 *   update: { installedVersion: string|null, supported: boolean, status: string, onCheck: () => void },
 *   onOpenGuide: () => void,
 *   onSignOut?: () => void, onAdmin?: () => void }} props
 */
export default function SettingsScreen({
  onClose, polling, onPolling, arFidelity, onArFidelity, alertSounds, onAlertSounds,
  isSatellite, onSatellite, mapStatus, arFeatureOverrides, onArFeatureOverride, update, onOpenGuide,
  onSignOut, onAdmin,
}) {
  const titleId = useId();
  const headingRef = useRef(null);
  const [theme, setTheme] = useState(getThemePreference);
  const [moreExpanded, setMoreExpanded] = useState(false);

  useEffect(() => subscribeTheme(({ preference }) => setTheme(preference)), []);
  useEffect(() => { headingRef.current?.focus(); }, []);

  const checking = update.status === 'checking';
  const updateLine = update.supported ? SETTINGS.updateStatus[update.status] : SETTINGS.updatesWebOnly;

  return (
    <div
      role="dialog"
      aria-labelledby={titleId}
      data-testid="settings"
      className="fixed inset-0 overflow-y-auto bg-bg text-text font-ui pointer-events-auto"
      style={{ zIndex: SETTINGS_Z, paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'calc(var(--emergency-clearance) + 1rem)' }}
    >
      <div className="max-w-xl mx-auto px-4 pb-8">
        {/* Header Bar */}
        <div className="pt-3 -ml-2 flex items-center justify-between">
          <IconButton label={SETTINGS.back} icon={ChevronLeft} size={26} onClick={onClose} />
        </div>
        <h1 id={titleId} ref={headingRef} tabIndex={-1} className="mt-2 mb-6 text-display font-semibold outline-none tracking-tight">
          {SETTINGS.title}
        </h1>

        {/* 1. Interface & Experience */}
        <section className="mb-6">
          <SectionLabel className="flex items-center gap-1.5">
            <Sun size={13} className="opacity-70" />
            {SETTINGS.appearance}
          </SectionLabel>
          <Card className="flex flex-col gap-3.5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-body font-medium">{SETTINGS.theme}</span>
              <span className="text-caption text-text-secondary">{SETTINGS.themeHelp[theme]}</span>
            </div>
            <SegmentedControl
              label={SETTINGS.theme}
              value={theme}
              onChange={setThemePreference}
              options={['system', 'light', 'dark'].map((v) => ({
                value: v,
                label: SETTINGS.themeOptions[v],
                icon: THEME_ICONS[v],
              }))}
            />
          </Card>
        </section>

        {/* 2. Map & Navigation Mode */}
        <section className="mb-6">
          <SectionLabel className="flex items-center gap-1.5">
            <MapIcon size={13} className="opacity-70" />
            {SETTINGS.mapView}
          </SectionLabel>
          <Card className="flex flex-col gap-3 shadow-sm">
            <SegmentedControl
              label={SETTINGS.mapView}
              value={isSatellite ? 'satellite' : 'map'}
              onChange={(v) => onSatellite(v === 'satellite')}
              options={['map', 'satellite'].map((v) => ({ value: v, label: SETTINGS.mapViewOptions[v] }))}
            />
            <div className="text-caption text-text-secondary flex items-center justify-between px-1" data-testid="map-engine-status">
              <span>{MAP_STATUS_LABEL[mapStatus.engine]}</span>
              {mapStatus.reason !== 'ok' && <span>· {MAP_STATUS_REASON_TEXT[mapStatus.reason]}</span>}
            </div>
          </Card>
        </section>

        {/* 3. Location Performance */}
        <section className="mb-6">
          <SectionLabel id={`${titleId}-refresh`} className="flex items-center gap-1.5">
            <Radio size={13} className="opacity-70" />
            {SETTINGS.refresh}
          </SectionLabel>
          <Card padded={false} className="shadow-sm">
            <RadioList
              label={SETTINGS.refresh}
              value={polling}
              onChange={onPolling}
              options={['eco', 'standard', 'max'].map((v) => ({ value: v, ...SETTINGS.refreshOptions[v] }))}
            />
          </Card>
        </section>

        {/* 4. AR Scanner Fidelity */}
        <section className="mb-6">
          <SectionLabel className="flex items-center gap-1.5">
            <Eye size={13} className="opacity-70" />
            {SETTINGS.arQuality}
          </SectionLabel>
          <Card className="flex flex-col gap-3 shadow-sm">
            <SegmentedControl
              label={SETTINGS.arQuality}
              value={arFidelity}
              onChange={onArFidelity}
              options={['efficient', 'standard', 'realistic'].map((v) => ({ value: v, label: SETTINGS.arQualityOptions[v] }))}
            />
            <p className="text-caption text-text-secondary px-1">{SETTINGS.arQualityHelp}</p>
          </Card>
        </section>

        {/* 5. Alerts & Audio */}
        <section className="mb-6">
          <SectionLabel className="flex items-center gap-1.5">
            <Volume2 size={13} className="opacity-70" />
            {SETTINGS.notifications}
          </SectionLabel>
          <Card padded={false} className="divide-y divide-border shadow-sm">
            <Switch label={SETTINGS.alertSounds} description={SETTINGS.alertSoundsHelp} checked={alertSounds} onChange={onAlertSounds} />
            <Switch label={SETTINGS.emergencyAlerts} description={SETTINGS.emergencyAlertsHelp} checked locked />
          </Card>
        </section>

        {/* 6. System & Application Info */}
        <section className="mb-6">
          <SectionLabel className="flex items-center gap-1.5">
            <Info size={13} className="opacity-70" />
            {SETTINGS.about}
          </SectionLabel>
          <Card padded={false} className="divide-y divide-border shadow-sm">
            <div className="p-4 flex items-center gap-3.5 bg-surface/50">
              <LocusMark className="w-12 h-12 shrink-0" title="LOCUS" />
              <div className="flex flex-col">
                <p className="text-body font-semibold tracking-wide">LOCUS</p>
                <p className="text-caption text-text-secondary">Find your group on campus</p>
              </div>
            </div>
            <div className="flex items-center justify-between gap-4 px-4 py-3 min-h-12">
              <span className="text-body font-medium">{SETTINGS.version}</span>
              <span className="text-body text-text-secondary tabular-nums" data-testid="settings-version">
                {update.installedVersion ?? SETTINGS.versionUnknown}
              </span>
            </div>
            <div className="px-4 py-3 flex flex-col gap-2">
              <Button variant="secondary" icon={RefreshCw} block onClick={update.onCheck} disabled={!update.supported || checking}>
                {checking ? SETTINGS.checking : SETTINGS.checkForUpdates}
              </Button>
              {updateLine && <p className="text-caption text-text-secondary px-0.5" role="status">{updateLine}</p>}
            </div>
            <ListRow
              leading={<BookOpen size={18} className="text-text-secondary" />}
              title={SETTINGS.howItWorks}
              trailing={<ChevronRight size={18} className="text-text-secondary" />}
              onClick={onOpenGuide}
            />
          </Card>
        </section>

        {/* 7. Collapsible Advanced & Sharing Controls */}
        <section className="mb-6">
          <Card padded={false} className="shadow-sm overflow-hidden border border-border">
            <button
              type="button"
              onClick={() => setMoreExpanded(!moreExpanded)}
              className="w-full flex items-center justify-between px-4 py-3.5 text-left duration-150 hover:bg-sunken"
              aria-expanded={moreExpanded}
            >
              <div className="flex items-center gap-2.5">
                <Sliders size={16} className="text-text-secondary" />
                <span className="text-body font-medium">{SETTINGS.more}</span>
              </div>
              <ChevronDown
                size={18}
                className={`text-text-secondary transition-transform duration-200 ${moreExpanded ? 'rotate-180' : ''}`}
              />
            </button>

            {moreExpanded && (
              <div className="border-t border-border p-4 flex flex-col gap-5 bg-surface/40">
                {/* AR Custom Overrides */}
                <div className="flex flex-col gap-3">
                  <div>
                    <p className="text-body font-medium">{SETTINGS.arParts}</p>
                    <p className="text-caption text-text-secondary mt-0.5">{SETTINGS.arPartsHelp}</p>
                  </div>
                  <div className="flex flex-col gap-3">
                    {Object.entries(AR_FEATURE_OPTIONS).map(([feature, options]) => (
                      <div key={feature} className="flex flex-col gap-1.5 bg-bg/40 p-2.5 rounded-xl border border-border/60">
                        <p className="text-caption font-semibold text-text-secondary">{SETTINGS.arPartNames[feature]}</p>
                        <SegmentedControl
                          label={SETTINGS.arPartNames[feature]}
                          value={arFeatureOverrides[feature]}
                          onChange={(v) => onArFeatureOverride(feature, v)}
                          options={['auto', ...options].map((v) => ({ value: v, label: SETTINGS.arPartOptions[v] }))}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Send App */}
                <div className="border-t border-border pt-4">
                  <SendApp />
                </div>
              </div>
            )}
          </Card>
        </section>

        {/* 8. Account. The redesigned map has no top-bar buttons, so signing out (and the
            owner's admin tools) live here. */}
        {(onSignOut || onAdmin) && (
          <section className="mb-6">
            <SectionLabel className="flex items-center gap-1.5">
              <UserRound size={13} className="opacity-70" />
              {SETTINGS.account}
            </SectionLabel>
            <Card padded={false} className="divide-y divide-border shadow-sm">
              {onAdmin && (
                <ListRow
                  leading={<ShieldAlert size={18} className="text-text-secondary" />}
                  title={SETTINGS.adminTools}
                  trailing={<ChevronRight size={18} className="text-text-secondary" />}
                  onClick={onAdmin}
                />
              )}
              {onSignOut && (
                <div className="px-4 py-3">
                  <Button variant="secondary" icon={LogOut} block onClick={onSignOut}>
                    {SETTINGS.signOut}
                  </Button>
                </div>
              )}
            </Card>
          </section>
        )}
      </div>
    </div>
  );
}
