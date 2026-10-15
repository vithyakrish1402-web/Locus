import React, { useEffect, useId, useRef, useState } from 'react';
import {
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  Info,
  Map as MapIcon,
  Moon,
  Radio,
  RefreshCw,
  Sliders,
  Smartphone,
  Sun,
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

// TEMPORARY - replace with Jose's design. What the test switch says is going on.
const BACKGROUND_REFUSED = {
  unsupported: 'This phone cannot do it.',
  'permission-denied': 'Location and notification permission are needed.',
  'location-denied': 'Location permission is needed.',
  'notifications-denied': 'Notifications must be allowed, so you can always see that it is on.',
  'server-off': 'The server has it switched off.',
  'no-group': 'The server has no Group with this code.',
  blocked: 'You are blocked from this Group.',
  'not-member': 'You are not a member of this Group.',
  'not-signed-in': 'Sign in again, then try again.',
  busy: 'The server is busy. Try again in a minute.',
  network: 'The server could not be reached.',
};
function backgroundSharingLine({ state, reason }) {
  if (state === 'running') return 'On: your position keeps going to your Group when the app is closed.';
  if (state === 'starting') return 'Starting…';
  if (state === 'refused') return `Not started. ${BACKGROUND_REFUSED[reason] ?? 'Try again.'}`;
  if (state === 'stopped') return `Stopped${reason ? ` (${reason})` : ''}.`;
  return 'Join a Group, then it starts by itself.';
}

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
 *   backgroundSharing?: { available: boolean, on: boolean, setOn: (on: boolean) => void,
 *     status: { state: string, reason?: string } },
 *   onOpenGuide: () => void }} props
 */
export default function SettingsScreen({
  onClose, polling, onPolling, arFidelity, onArFidelity, alertSounds, onAlertSounds,
  isSatellite, onSatellite, mapStatus, arFeatureOverrides, onArFeatureOverride, update, onOpenGuide, backgroundSharing,
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
      className="fixed inset-0 overflow-y-auto glass-floating !rounded-none bg-bg/85 backdrop-blur-2xl text-text font-ui pointer-events-auto"
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

        {/* TEMPORARY - replace with Jose's design. Background sharing test switch: only offered in the
            LOCUS Test build, inside an Android shell that has the plugin (see backgroundSharing.available). */}
        {backgroundSharing?.available && (
          <section className="mb-6" data-testid="background-sharing-test">
            <SectionLabel className="flex items-center gap-1.5">
              <Radio size={13} className="opacity-70" />
              Background sharing (test)
            </SectionLabel>
            <Card padded={false} className="shadow-sm">
              <Switch
                label="Keep sharing when the app is closed"
                description={backgroundSharingLine(backgroundSharing.status)}
                checked={backgroundSharing.on}
                onChange={backgroundSharing.setOn}
              />
            </Card>
          </section>
        )}

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
                <p className="text-caption text-text-secondary">Tactical Campus Navigation & Locator</p>
              </div>
            </div>
            <div className="flex items-center justify-between gap-4 px-4 py-3 min-h-12">
              <span className="text-body font-medium">{SETTINGS.version}</span>
              <span className="text-body text-text-secondary font-mono text-sm" data-testid="settings-version">
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
              className="w-full flex items-center justify-between px-4 py-3.5 text-left transition-colors duration-150 hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
              aria-expanded={moreExpanded}
            >
              <div className="flex items-center gap-2.5">
                <Sliders size={16} className="text-text-secondary" />
                <span className="text-body font-medium">{SETTINGS.more} (Advanced & Share)</span>
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
      </div>
    </div>
  );
}
