import { describe, it, expect } from 'vitest';
import { e2eServer, once, settle } from './helpers/e2eServer.js';

// The dead man's switch on the real server (2026-10-24): when a member's connection drops, the
// group is told where they last REALLY were, exactly, and nothing that could move them on: no
// speed or heading (those only fed the old app's dead reckoning, still on phones with js-1.1.72).
const api = e2eServer();

describe("the dead man's switch", () => {
  it('sends the last real report, and no trajectory', async () => {
    const { room, alpha, bravo } = await api.squadOfThree();
    const lost = once(alpha, 'member-signal-lost');
    for (const [lat, lng] of [[12.823, 80.044], [12.8232, 80.0442], [12.8234, 80.0444]]) {
      bravo.emit('update-location', { roomCode: room, lat, lng, speed: 18, heading: 45, battery: 70, name: 'uB', status: 'ACTIVE' });
    }
    await settle(bravo);
    bravo.disconnect();
    const message = await lost;
    expect(message).toMatchObject({ uid: 'uB', name: 'uB' });
    expect(message.lastKnownLocation).toEqual({ latitude: 12.8234, longitude: 80.0444, batteryLevel: 70 });
    expect(message.timeDelta).toBeGreaterThanOrEqual(0);
  });
});
