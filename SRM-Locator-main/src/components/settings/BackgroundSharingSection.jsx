import React, { useEffect } from 'react';
import { MapPin } from 'lucide-react';
import { Button, Card, SectionLabel, Sheet, Switch } from '../ui';
import { BACKGROUND_SHARING as COPY } from '../../copy/settings';
import { spacedCode } from '../../copy/access';
import { stateLine } from '../../utils/backgroundStateLine';

// "Keep sharing when the app is closed" (Stage 3b). Shown only when this phone's app can do it
// and the server has it switched on (`backgroundSharing.available`); otherwise nothing at all.
// The first time it is turned on, a plain consent step comes before anything else, including the
// permission requests. Words: copy/settings.js (BACKGROUND_SHARING).

/**
 * @param {{ backgroundSharing?: { available: boolean, on: boolean, status: { state: string, reason?: string },
 *     consentOpen: boolean, requestChange: (on: boolean) => void, acceptConsent: () => void,
 *     declineConsent: () => void, refresh: () => void },
 *   group: string, layer: number }} props
 *   group: the code of the Group, as the person would say it; layer: the z-index the consent step stands on
 */
export default function BackgroundSharingSection({ backgroundSharing, group, layer }) {
  const refresh = backgroundSharing?.refresh;
  // Opening Settings asks the server again, so a switch the server has just turned on or off is noticed.
  useEffect(() => { refresh?.(); }, [refresh]);

  if (!backgroundSharing?.available) return null;
  const { on, status, consentOpen, requestChange, acceptConsent, declineConsent, sosAlerts } = backgroundSharing;

  return (
    <section className="mb-6" data-testid="background-sharing">
      <SectionLabel className="flex items-center gap-1.5">
        <MapPin size={13} className="opacity-70" />
        {COPY.section}
      </SectionLabel>
      <Card padded={false} className="shadow-sm">
        <Switch
          label={COPY.switchLabel}
          description={<span data-testid="background-sharing-state">{stateLine(status, group ? spacedCode(group) : '')}</span>}
          checked={on}
          onChange={requestChange}
        />
        {sosAlerts && (
          // Heard by the same service, so it can only be on while sharing is: shown as off and locked
          // otherwise, with the reason in words.
          <div className="border-t border-border" data-testid="sos-alerts">
            <Switch
              label={COPY.sos.label}
              description={COPY.sos.description}
              checked={on && sosAlerts.on}
              locked={!on}
              onChange={sosAlerts.setOn}
            />
          </div>
        )}
      </Card>
      <p className="mt-2 px-1 text-caption text-text-secondary">{COPY.help}</p>
      {sosAlerts && <p className="mt-2 px-1 text-caption text-text-secondary" data-testid="sos-alerts-note">{COPY.sos.needsSharing}</p>}
      {sosAlerts && on && sosAlerts.on && !sosAlerts.audible && (
        <p className="mt-2 px-1 text-caption text-warning" data-testid="sos-alerts-silenced">{COPY.sos.notAudible}</p>
      )}
      {sosAlerts && on && sosAlerts.on && !sosAlerts.fullScreen && (
        <p className="mt-2 px-1 text-caption text-text-secondary" data-testid="sos-alerts-no-fullscreen">{COPY.sos.noFullScreen}</p>
      )}

      <Sheet open={consentOpen} onClose={declineConsent} label={COPY.consent.title} layer={layer}>
        <div data-testid="background-sharing-consent" className="px-5 flex flex-col gap-4">
          <span className="flex items-center justify-center w-14 h-14 rounded-full bg-accent-soft text-accent" aria-hidden="true">
            <MapPin size={26} />
          </span>
          <div className="flex flex-col gap-2">
            <h2 className="text-title">{COPY.consent.title}</h2>
            <p className="text-body text-text-secondary">{COPY.consent.body}</p>
          </div>
          <Button size="large" block onClick={acceptConsent}>{COPY.consent.accept}</Button>
          <Button variant="plain" block onClick={declineConsent}>{COPY.consent.decline}</Button>
        </div>
      </Sheet>
    </section>
  );
}
