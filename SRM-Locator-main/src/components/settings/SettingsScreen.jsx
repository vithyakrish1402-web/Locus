import React, { useEffect, useId, useRef, useState } from 'react';
import { BookOpen, ChevronLeft, ChevronRight, Moon, RefreshCw, Smartphone, Sun } from 'lucide-react';
import { Button, Card, IconButton, ListRow, RadioList, SectionLabel, SegmentedControl, Switch } from '../ui';
import SendApp from '../SendApp';
import { SETTINGS } from '../../copy/settings';
import { setThemePreference, subscribeTheme, getThemePreference } from '../../theme/theme';
import { AR_FEATURE_OPTIONS } from '../../utils/arFeatures';
import { MAP_STATUS_LABEL, MAP_STATUS_REASON_TEXT } from '../../utils/mapEngineStatus';

// Settings, as a full screen (redesign P9). Opened from the gear in the map's right-hand
// column, as before. Sections, in the design's order: Appearance (theme), Location refresh
// rate, AR Scan quality, Notifications (Alert sounds, and Emergency alerts, always on), and
// About (version, Check for updates, How LOCUS works). Under them, "More" keeps everything
// the old settings had that the design leaves out: Map or Satellite with the map's status
// line, AR Scan's per-part overrides, and Send LOCUS to someone.
//
// Only the theme is remembered after a restart (src/theme/theme.js); the rest starts from
// its default each time, as it always has.
//
// Drawn over the map screen and its Emergency button, as the old settings window was.
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
 *   onOpenGuide: () => void }} props
 */
export default function SettingsScreen({
  onClose, polling, onPolling, arFidelity, onArFidelity, alertSounds, onAlertSounds,
  isSatellite, onSatellite, mapStatus, arFeatureOverrides, onArFeatureOverride, update, onOpenGuide,
}) {
  const titleId = useId();
  const headingRef = useRef(null);
  const [theme, setTheme] = useState(getThemePreference);
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
      style={{ zIndex: SETTINGS_Z, paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'calc(2rem + env(safe-area-inset-bottom))' }}
    >
      <div className="max-w-xl mx-auto px-4">
        <div className="pt-3 -ml-2">
          <IconButton label={SETTINGS.back} icon={ChevronLeft} size={26} onClick={onClose} />
        </div>
        <h1 id={titleId} ref={headingRef} tabIndex={-1} className="mt-2 mb-5 text-display outline-none">{SETTINGS.title}</h1>

        <section className="mb-6">
          <SectionLabel>{SETTINGS.appearance}</SectionLabel>
          <Card className="flex flex-col gap-3">
            <p className="text-body">{SETTINGS.theme}</p>
            <SegmentedControl
              label={SETTINGS.theme}
              value={theme}
              onChange={setThemePreference}
              options={['system', 'light', 'dark'].map((v) => ({ value: v, label: SETTINGS.themeOptions[v], icon: THEME_ICONS[v] }))}
            />
            <p className="text-secondary text-text-secondary">{SETTINGS.themeHelp[theme]}</p>
          </Card>
        </section>

        <section className="mb-6">
          <SectionLabel id={`${titleId}-refresh`}>{SETTINGS.refresh}</SectionLabel>
          <Card padded={false}>
            <RadioList
              label={SETTINGS.refresh}
              value={polling}
              onChange={onPolling}
              options={['eco', 'standard', 'max'].map((v) => ({ value: v, ...SETTINGS.refreshOptions[v] }))}
            />
          </Card>
        </section>

        <section className="mb-6">
          <SectionLabel>{SETTINGS.arQuality}</SectionLabel>
          <Card className="flex flex-col gap-3">
            <SegmentedControl
              label={SETTINGS.arQuality}
              value={arFidelity}
              onChange={onArFidelity}
              options={['efficient', 'standard', 'realistic'].map((v) => ({ value: v, label: SETTINGS.arQualityOptions[v] }))}
            />
            <p className="text-secondary text-text-secondary">{SETTINGS.arQualityHelp}</p>
          </Card>
        </section>

        <section className="mb-6">
          <SectionLabel>{SETTINGS.notifications}</SectionLabel>
          <Card padded={false} className="divide-y divide-border">
            <Switch label={SETTINGS.alertSounds} description={SETTINGS.alertSoundsHelp} checked={alertSounds} onChange={onAlertSounds} />
            <Switch label={SETTINGS.emergencyAlerts} description={SETTINGS.emergencyAlertsHelp} checked locked />
          </Card>
        </section>

        <section className="mb-6">
          <SectionLabel>{SETTINGS.about}</SectionLabel>
          <Card padded={false} className="divide-y divide-border">
            <div className="flex items-center justify-between gap-4 px-4 py-3 min-h-14">
              <span className="text-body">{SETTINGS.version}</span>
              <span className="text-body text-text-secondary" data-testid="settings-version">{update.installedVersion ?? SETTINGS.versionUnknown}</span>
            </div>
            <div className="px-4 py-3 flex flex-col gap-2">
              <Button variant="secondary" icon={RefreshCw} block onClick={update.onCheck} disabled={!update.supported || checking}>
                {checking ? SETTINGS.checking : SETTINGS.checkForUpdates}
              </Button>
              {updateLine && <p className="text-secondary text-text-secondary" role="status">{updateLine}</p>}
            </div>
            <ListRow leading={<BookOpen size={20} />} title={SETTINGS.howItWorks} trailing={<ChevronRight size={20} className="text-text-secondary" />} onClick={onOpenGuide} />
          </Card>
        </section>

        <section className="mb-6">
          <SectionLabel>{SETTINGS.more}</SectionLabel>
          <Card className="flex flex-col gap-5">
            <div className="flex flex-col gap-3">
              <p className="text-body">{SETTINGS.mapView}</p>
              <SegmentedControl
                label={SETTINGS.mapView}
                value={isSatellite ? 'satellite' : 'map'}
                onChange={(v) => onSatellite(v === 'satellite')}
                options={['map', 'satellite'].map((v) => ({ value: v, label: SETTINGS.mapViewOptions[v] }))}
              />
              <p className="text-secondary text-text-secondary" data-testid="map-engine-status">
                {MAP_STATUS_LABEL[mapStatus.engine]}
                {mapStatus.reason !== 'ok' && <><br />{MAP_STATUS_REASON_TEXT[mapStatus.reason]}</>}
              </p>
            </div>

            <div className="flex flex-col gap-3 border-t border-border pt-4">
              <p className="text-body">{SETTINGS.arParts}</p>
              {Object.entries(AR_FEATURE_OPTIONS).map(([feature, options]) => (
                <div key={feature} className="flex flex-col gap-1.5">
                  <p className="text-secondary text-text-secondary">{SETTINGS.arPartNames[feature]}</p>
                  <SegmentedControl
                    label={SETTINGS.arPartNames[feature]}
                    value={arFeatureOverrides[feature]}
                    onChange={(v) => onArFeatureOverride(feature, v)}
                    options={['auto', ...options].map((v) => ({ value: v, label: SETTINGS.arPartOptions[v] }))}
                  />
                </div>
              ))}
              <p className="text-secondary text-text-secondary">{SETTINGS.arPartsHelp}</p>
            </div>

            <div className="border-t border-border pt-4">
              <SendApp />
            </div>
          </Card>
        </section>
      </div>
    </div>
  );
}
