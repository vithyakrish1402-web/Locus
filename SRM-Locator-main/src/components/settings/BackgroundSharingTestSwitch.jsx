import React from 'react';
import { Radio } from 'lucide-react';
import { Card, SectionLabel, Switch } from '../ui';

// TEMPORARY - replace with Jose's design. The background sharing test switch (Stage 3b Part B).
// Rendered only in the LOCUS Test build and only where the plugin is present (the caller's
// condition on the build mode is what keeps this file, and its words, out of every other build).

// What the switch says is going on.
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

/** @param {{ backgroundSharing?: { available: boolean, on: boolean, setOn: (on: boolean) => void, status: { state: string, reason?: string } } }} props */
export default function BackgroundSharingTestSwitch({ backgroundSharing }) {
  if (!backgroundSharing?.available) return null;
  return (
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
  );
}
