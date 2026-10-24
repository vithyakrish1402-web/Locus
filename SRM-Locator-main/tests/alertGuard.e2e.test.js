import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { e2eServer, sleep, waitFor, settle } from './helpers/e2eServer.js';

/**
 * The SOS / Ping guard, end to end: the real backend/server.js, real Socket.IO clients, the
 * real join and approval flow. Every refusal, every relay, and who is told what.
 *
 * The server's class-hours clock is pinned to 11:00 on a Wednesday in India (05:30 UTC), and
 * the quiet-zone master switch is turned on, so the quiet zones are in force whatever time
 * this runs at. The switch's default (off) has its own describe at the end.
 */

const DURING_CLASS = '2026-01-07T05:30:00Z';
const INSIDE = { lat: 12.8247, lng: 80.04588 }; // inside TECH PARK 2
const BEYOND_BUFFER = { lat: 12.8247, lng: 80.0460398 + 0.0003 }; // ~33 m from its wall
const HOSTEL = { lat: 12.8222, lng: 80.0436 };

// Listens for everything the guard can tell a socket, and keeps it.
const track = (socket) => {
  Object.assign(socket, { pings: [], results: [], settings: [], notices: [], updates: [], logEntries: [], logs: [] });
  socket.on('receive-ping', (p) => socket.pings.push(p));
  socket.on('alert-result', (p) => socket.results.push(p));
  socket.on('group-settings', (p) => socket.settings.push(p));
  socket.on('group-notice', (p) => socket.notices.push(p));
  socket.on('sos-updated', (p) => socket.updates.push(p));
  socket.on('alert-log-entry', (p) => socket.logEntries.push(p));
  socket.on('alert-log', (p) => socket.logs.push(p));
  return socket;
};

const ask = (socket, event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve));
const last = (list) => list[list.length - 1];
const place = async (socket, room, where) => {
  socket.emit('update-location', { ...where, roomCode: room, name: 'x', heading: 0, battery: 90 });
  await settle(socket);
};
const ping = (from, to) => from.emit('ping-user', { targetId: to.id, senderName: 'P' });
const sos = (from, room, extra = {}) =>
  from.emit('sos-broadcast', { senderName: 'Bravo', lat: 12.8231, lng: 80.0442, roomCode: room, timestamp: Date.now(), ...extra });

// Alpha is Commander (uA), Bravo (uB) and Charlie (uC) are members; all tracked.
const group = async (api) => {
  const { room, alpha, bravo, charlie } = await api.squadOfThree();
  [alpha, bravo, charlie].forEach(track);
  return { room, alpha, bravo, charlie };
};

describe('Group Lead controls', () => {
  const api = e2eServer({ env: { LOCUS_QUIET_ZONES_ENABLED: 'true', LOCUS_CLASS_CLOCK_ISO: DURING_CLASS } });

  it('are refused for a member, who is told why, and change nothing for anyone', async () => {
    const { room, alpha, bravo } = await group(api);
    alpha.settings.length = 0;

    expect(await ask(bravo, 'set-group-settings', { roomCode: room, sosEnabled: false })).toEqual({ ok: false, reason: 'not-commander' });
    expect(await ask(bravo, 'set-member-ping-mute', { roomCode: room, targetId: alpha.id, muted: true })).toEqual({ ok: false, reason: 'not-commander' });
    await settle(alpha);
    expect(alpha.settings).toEqual([]);

    // And SOS still works.
    sos(bravo, room);
    await waitFor(() => alpha.sos.length);
  });

  it('are refused from someone in no Group, or naming a Group they are not in', async () => {
    const { room } = await group(api);
    const stranger = track(await api.connect());
    expect(await ask(stranger, 'set-group-settings', { roomCode: room, sosEnabled: false })).toEqual({ ok: false, reason: 'not-in-squad' });
    expect(await ask(stranger, 'set-group-settings', undefined)).toEqual({ ok: false, reason: 'not-in-squad' });
    expect(await ask(stranger, 'get-alert-log', { roomCode: room })).toEqual({ ok: false, reason: 'not-owner' });
  });

  it('reach every member at once, and tell only the Group Lead who is muted', async () => {
    const { room, alpha, bravo, charlie } = await group(api);
    [alpha, bravo, charlie].forEach((s) => (s.settings.length = 0));

    expect(await ask(alpha, 'set-group-settings', { roomCode: room, pingEnabled: false })).toEqual({ ok: true });
    await waitFor(() => [alpha, bravo, charlie].every((s) => s.settings.length));
    for (const s of [alpha, bravo, charlie]) expect(last(s.settings)).toMatchObject({ roomCode: room, sosEnabled: true, pingEnabled: false, pingMuted: false });

    await ask(alpha, 'set-member-ping-mute', { roomCode: room, targetId: bravo.id, muted: true });
    await waitFor(() => last(bravo.settings).pingMuted);
    expect(last(alpha.settings).mutedMemberIds).toEqual([bravo.id]);
    expect(last(bravo.settings)).not.toHaveProperty('mutedMemberIds');
    expect(last(charlie.settings).pingMuted).toBe(false);
  });

  it('are sent to a member as they join, not only when they change', async () => {
    const { room, alpha } = await group(api);
    await ask(alpha, 'set-group-settings', { roomCode: room, sosEnabled: false });
    const latecomer = track(await api.connect());
    await api.admit(alpha, latecomer, room, 'uL');
    await waitFor(() => latecomer.settings.length);
    expect(last(latecomer.settings)).toMatchObject({ roomCode: room, sosEnabled: false, pingEnabled: true });
  });

  it('cannot mute themselves, a stranger, or with a nonsense value', async () => {
    const { room, alpha } = await group(api);
    const outsider = track(await api.connect());
    expect(await ask(alpha, 'set-member-ping-mute', { roomCode: room, targetId: alpha.id, muted: true })).toEqual({ ok: false, reason: 'bad-target' });
    expect(await ask(alpha, 'set-member-ping-mute', { roomCode: room, targetId: outsider.id, muted: true })).toEqual({ ok: false, reason: 'bad-target' });
    expect(await ask(alpha, 'set-member-ping-mute', { roomCode: room, targetId: 'nobody', muted: 'yes' })).toEqual({ ok: false, reason: 'bad-target' });
  });
});

describe('the startup line', () => {
  const api = e2eServer({ env: { LOCUS_QUIET_ZONES_ENABLED: 'true', LOCUS_CLASS_CLOCK_ISO: DURING_CLASS } });

  it('says quiet zones are on, and what is always on', () => {
    const line = api.serverOutput().split('\n').find((l) => l.startsWith('[GUARD] Always on'));
    expect(line).toContain('Group switches and mutes, Ping cooldown and cap, SOS coalescing, repeated-SOS notice, alert log');
    expect(line).toContain('quiet zones + class-hours position rule ON');
    expect(line).toContain('FORCE_CLASS_HOURS off');
  });
});

describe('SOS switched off', () => {
  const api = e2eServer({ env: { LOCUS_QUIET_ZONES_ENABLED: 'true', LOCUS_CLASS_CLOCK_ISO: DURING_CLASS } });

  it('is not relayed to anyone, and the sender is told the Group Lead turned it off', async () => {
    const { room, alpha, bravo, charlie } = await group(api);
    await ask(alpha, 'set-group-settings', { roomCode: room, sosEnabled: false });

    sos(bravo, room);
    await waitFor(() => bravo.results.length);
    expect(bravo.results[0]).toEqual({ type: 'sos', roomCode: room, allowed: false, mode: 'blocked', reasonCode: 'GROUP_DISABLED' });
    await settle(bravo);
    await sleep(150);
    expect(alpha.sos).toEqual([]);
    expect(charlie.sos).toEqual([]);

    // Nothing waits to be replayed either.
    charlie.emit('sos-sync');
    await settle(charlie);
    expect(charlie.sos).toEqual([]);
  });

  it('works again the moment the Group Lead turns it back on', async () => {
    const { room, alpha, bravo, charlie } = await group(api);
    await ask(alpha, 'set-group-settings', { roomCode: room, sosEnabled: false });
    await ask(alpha, 'set-group-settings', { roomCode: room, sosEnabled: true });
    await place(bravo, room, HOSTEL);
    sos(bravo, room);
    await waitFor(() => charlie.sos.length && bravo.results.length);
    expect(last(bravo.results)).toMatchObject({ allowed: true, mode: 'allow', reasonCode: null });
  });

  it('does not stop Pings, and Ping off does not stop SOS', async () => {
    const { room, alpha, bravo, charlie } = await group(api);
    await place(bravo, room, HOSTEL);
    await ask(alpha, 'set-group-settings', { roomCode: room, sosEnabled: false });
    ping(bravo, charlie);
    await waitFor(() => charlie.pings.length);

    await ask(alpha, 'set-group-settings', { roomCode: room, sosEnabled: true, pingEnabled: false });
    ping(bravo, charlie);
    await waitFor(() => last(bravo.results)?.reasonCode === 'GROUP_DISABLED');
    expect(charlie.pings).toHaveLength(1);
    sos(bravo, room);
    await waitFor(() => charlie.sos.length);
  });
});

describe('Ping rules', () => {
  const api = e2eServer({ env: { LOCUS_QUIET_ZONES_ENABLED: 'true', LOCUS_CLASS_CLOCK_ISO: DURING_CLASS } });

  it('refuse a muted member\'s pings, but still carry their SOS', async () => {
    const { room, alpha, bravo, charlie } = await group(api);
    await ask(alpha, 'set-member-ping-mute', { roomCode: room, targetId: bravo.id, muted: true });
    await place(bravo, room, HOSTEL);

    ping(bravo, charlie);
    await waitFor(() => bravo.results.length);
    expect(bravo.results[0]).toMatchObject({ type: 'ping', allowed: false, reasonCode: 'MEMBER_MUTED' });
    await sleep(150);
    expect(charlie.pings).toEqual([]);

    sos(bravo, room);
    await waitFor(() => charlie.sos.length);
  });

  it('are silently dropped for a member who muted the sender, while the sender is told it went', async () => {
    const { room, alpha, bravo, charlie } = await group(api);
    await place(bravo, room, HOSTEL);
    await place(alpha, room, HOSTEL);
    expect(await ask(charlie, 'set-personal-ping-mute', { roomCode: room, targetId: bravo.id, muted: true })).toEqual({ ok: true });

    ping(bravo, charlie);
    await waitFor(() => bravo.results.length);
    expect(bravo.results[0]).toMatchObject({ allowed: true, reasonCode: null });
    await sleep(150);
    expect(charlie.pings).toEqual([]);

    // Others still hear from Bravo, and Charlie still hears from others.
    ping(bravo, alpha);
    await waitFor(() => alpha.pings.length);
    ping(alpha, charlie);
    await waitFor(() => charlie.pings.length);
  });

  it('are limited to one a cooldown to the same person, with the wait in the reply', async () => {
    const { room, alpha, bravo, charlie } = await group(api);
    await place(bravo, room, HOSTEL);

    ping(bravo, charlie);
    await waitFor(() => charlie.pings.length);
    ping(bravo, charlie);
    await waitFor(() => bravo.results.length === 2);
    expect(bravo.results[1]).toMatchObject({ allowed: false, reasonCode: 'COOLDOWN' });
    expect(bravo.results[1].retryAfterSec).toBeGreaterThan(15);
    expect(bravo.results[1].retryAfterSec).toBeLessThanOrEqual(20);
    await sleep(150);
    expect(charlie.pings).toHaveLength(1);

    // Pinging someone else is another matter.
    ping(bravo, alpha);
    await waitFor(() => alpha.pings.length);
  });

  it('are refused in a quiet zone during class hours, and allowed just beyond its buffer', async () => {
    const { room, bravo, charlie } = await group(api);
    await place(bravo, room, INSIDE);
    ping(bravo, charlie);
    await waitFor(() => bravo.results.length);
    expect(bravo.results[0]).toMatchObject({ allowed: false, mode: 'blocked', reasonCode: 'QUIET_ZONE' });
    await sleep(150);
    expect(charlie.pings).toEqual([]);

    await place(bravo, room, BEYOND_BUFFER);
    ping(bravo, charlie);
    await waitFor(() => charlie.pings.length && bravo.results.length === 2);
    expect(last(bravo.results)).toMatchObject({ allowed: true, mode: 'allow' });
  });

  it('are refused when the server has no position for the sender during class hours', async () => {
    const { bravo, charlie } = await group(api);
    ping(bravo, charlie);
    await waitFor(() => bravo.results.length);
    expect(bravo.results[0]).toMatchObject({ allowed: false, reasonCode: 'LOCATION_UNKNOWN' });
    await sleep(150);
    expect(charlie.pings).toEqual([]);
  });

  it('are not relayed to a target in another Group even when the guard would allow them', async () => {
    const { room, bravo } = await group(api);
    await place(bravo, room, HOSTEL);
    const other = track(await api.connect());
    await api.createSquad(other, api.newRoom(), 'uOther');
    ping(bravo, other);
    await settle(bravo);
    await sleep(150);
    expect(other.pings).toEqual([]);
    expect(bravo.results).toEqual([]);
  });
});

describe('Ping limits over a window', () => {
  const api = e2eServer({ env: { LOCUS_QUIET_ZONES_ENABLED: 'true', LOCUS_CLASS_CLOCK_ISO: DURING_CLASS, LOCUS_PING_COOLDOWN_SEC: '0', LOCUS_PING_MAX_PER_WINDOW: '3' } });

  it('cap how many one person can send, and a refused ping does not count towards the cap', async () => {
    const { room, alpha, bravo, charlie } = await group(api);
    await place(bravo, room, HOSTEL);
    for (let i = 0; i < 3; i++) ping(bravo, i % 2 ? alpha : charlie);
    await waitFor(() => bravo.results.length === 3);
    expect(bravo.results.every((r) => r.allowed)).toBe(true);

    ping(bravo, charlie);
    ping(bravo, alpha);
    await waitFor(() => bravo.results.length === 5);
    expect(bravo.results.slice(3)).toEqual([
      expect.objectContaining({ allowed: false, reasonCode: 'COOLDOWN' }),
      expect.objectContaining({ allowed: false, reasonCode: 'COOLDOWN' }),
    ]);
    expect(bravo.results[3].retryAfterSec).toBeGreaterThan(590);
    expect(alpha.pings).toHaveLength(1);
    expect(charlie.pings).toHaveLength(2);
  });
});

describe('SOS rules', () => {
  const api = e2eServer({ env: { LOCUS_QUIET_ZONES_ENABLED: 'true', LOCUS_CLASS_CLOCK_ISO: DURING_CLASS } });

  it('go out flagged from a quiet zone during class hours, and the sender is told', async () => {
    const { room, alpha, bravo } = await group(api);
    await place(bravo, room, INSIDE);
    sos(bravo, room);
    await waitFor(() => alpha.sos.length && bravo.results.length);
    expect(alpha.sos[0].flag).toBe('QUIET_ZONE');
    expect(bravo.results[0]).toMatchObject({ type: 'sos', allowed: true, mode: 'guarded', reasonCode: 'QUIET_ZONE' });
  });

  it('go out flagged when the server cannot tell where the sender is', async () => {
    const { room, alpha, bravo } = await group(api);
    sos(bravo, room); // no update-location: no position on file
    await waitFor(() => alpha.sos.length);
    expect(alpha.sos[0].flag).toBe('LOCATION_UNKNOWN');
  });

  it('go out unflagged from anywhere else', async () => {
    const { room, alpha, bravo } = await group(api);
    await place(bravo, room, HOSTEL);
    sos(bravo, room);
    await waitFor(() => alpha.sos.length);
    expect(alpha.sos[0]).not.toHaveProperty('flag');
  });

  it('refuse a second alarm from the same person inside the cooldown, saying how long is left', async () => {
    const { room, alpha, bravo } = await group(api);
    await place(bravo, room, HOSTEL);
    for (let i = 0; i < 3; i++) sos(bravo, room);
    await waitFor(() => bravo.results.length === 3);
    expect(bravo.results[0]).toMatchObject({ allowed: true });
    for (const refused of bravo.results.slice(1)) {
      expect(refused).toMatchObject({ type: 'sos', allowed: false, mode: 'blocked', reasonCode: 'COOLDOWN' });
      // The default cooldown is 3 minutes.
      expect(refused.retryAfterSec).toBeGreaterThan(170);
      expect(refused.retryAfterSec).toBeLessThanOrEqual(180);
    }
    await sleep(100);
    expect(alpha.sos).toHaveLength(1);
    expect(alpha.updates).toEqual([]);
  });

  it('follow the cooldown the Group Lead picked, which must be one of the presets', async () => {
    const { room, alpha, bravo } = await group(api);
    // Not a preset: ignored, the default stands.
    await ask(alpha, 'set-group-settings', { roomCode: room, sosCooldownMs: 1234 });
    await ask(alpha, 'set-group-settings', { roomCode: room, sosCooldownMs: 60000 });
    await waitFor(() => bravo.settings.some((s) => s.sosCooldownMs === 60000));
    expect(last(bravo.settings)).toMatchObject({ sosCooldownMs: 60000, sosCooldownPresetsMs: [60000, 180000, 300000] });
    sos(bravo, room);
    sos(bravo, room);
    await waitFor(() => bravo.results.length === 2);
    expect(bravo.results[1].retryAfterSec).toBeLessThanOrEqual(60);
    // A member cannot change it.
    expect(await ask(bravo, 'set-group-settings', { roomCode: room, sosCooldownMs: 300000 })).toEqual({ ok: false, reason: 'not-commander' });
  });

  it('keep one person\'s cooldown to themselves', async () => {
    const { room, alpha, bravo, charlie } = await group(api);
    sos(bravo, room);
    await waitFor(() => alpha.sos.length === 1);
    sos(charlie, room, { senderName: 'Charlie' });
    await waitFor(() => alpha.sos.length === 2);
  });

  it('do not crash the server on a malformed cooldown or payload', async () => {
    const { room, alpha, bravo } = await group(api);
    for (const bad of [null, 'x', 7, { sosCooldownMs: 'soon' }, { roomCode: room, sosCooldownMs: -1 }, { roomCode: room, sosCooldownMs: Infinity }]) {
      alpha.emit('set-group-settings', bad);
      bravo.emit('sos-broadcast', bad);
    }
    sos(bravo, room);
    await waitFor(() => alpha.sos.length === 1);
  });
});

describe('SOS rules with a cooldown shorter than coalescing', () => {
  // A cooldown of 0 is how the coalescing and repeat-notice behaviour beneath it is checked.
  const api = e2eServer({ env: { LOCUS_QUIET_ZONES_ENABLED: 'true', LOCUS_CLASS_CLOCK_ISO: DURING_CLASS, LOCUS_SOS_COOLDOWN_DEFAULT_MS: '0' } });

  it('update the sender\'s earlier one instead of sounding a second alarm', async () => {
    const { room, alpha, bravo, charlie } = await group(api);
    sos(bravo, room);
    await waitFor(() => alpha.sos.length && charlie.sos.length);
    charlie.emit('sos-ack', { id: charlie.sos[0].id });

    sos(bravo, room, { lat: 12.9, lng: 80.1 });
    await waitFor(() => alpha.updates.length && bravo.results.length === 2);
    expect(alpha.updates[0]).toMatchObject({ id: alpha.sos[0].id, lat: 12.9, lng: 80.1 });
    expect(last(bravo.results)).toMatchObject({ allowed: true });
    await sleep(150);
    expect(alpha.sos).toHaveLength(1); // no second 'sos-received'
    expect(charlie.sos).toHaveLength(1);

    // Charlie's acknowledgement stands: a catch-up does not bring it back.
    charlie.sos.length = 0;
    charlie.emit('sos-sync');
    await settle(charlie);
    expect(charlie.sos).toEqual([]);
  });

  it('from two different people are two alerts', async () => {
    const { room, alpha, bravo, charlie } = await group(api);
    sos(bravo, room);
    sos(charlie, room, { senderName: 'Charlie' });
    await waitFor(() => alpha.sos.length === 2);
    expect(alpha.updates).toEqual([]);
  });
});

describe('SOS cooldown running out', () => {
  const api = e2eServer({ env: { LOCUS_SOS_COOLDOWN_DEFAULT_MS: '300', LOCUS_SOS_COALESCE_SEC: '0' } });

  it('lets the same person raise a new alarm once it has passed', async () => {
    const { room, alpha, bravo } = await group(api);
    sos(bravo, room);
    await waitFor(() => alpha.sos.length === 1);
    await sleep(400);
    sos(bravo, room);
    await waitFor(() => alpha.sos.length === 2);
    expect(bravo.results.every((r) => r.allowed)).toBe(true);
  });
});

describe('SOS repeats', () => {
  const api = e2eServer({ env: { LOCUS_QUIET_ZONES_ENABLED: 'true', LOCUS_CLASS_CLOCK_ISO: DURING_CLASS } });

  it('tell the Group Lead, once, when someone presses repeatedly, counting the presses the cooldown refused', async () => {
    const { room, alpha, bravo, charlie } = await group(api);
    for (let i = 0; i < 5; i++) sos(bravo, room);
    await waitFor(() => bravo.results.length === 5);
    await waitFor(() => alpha.notices.length);
    await sleep(150);
    expect(alpha.notices).toEqual([
      { roomCode: room, kind: 'sos-repeat', senderId: bravo.id, senderName: 'Bravo', count: 3, windowMin: 15 },
    ]);
    expect(charlie.notices).toEqual([]); // not an alarm for everyone
    expect(bravo.notices).toEqual([]);
  });

  it('are logged for the Group Lead, who sees each new entry live', async () => {
    const { room, alpha, bravo, charlie } = await group(api);
    await place(bravo, room, INSIDE);
    ping(bravo, charlie);
    sos(bravo, room);
    await waitFor(() => alpha.logEntries.length === 2);
    expect(alpha.logEntries[0].entry).toMatchObject({ type: 'ping', allowed: false, reasonCode: 'QUIET_ZONE', senderId: bravo.id });
    expect(alpha.logEntries[1].entry).toMatchObject({ type: 'sos', allowed: true, mode: 'guarded' });

    expect(await ask(alpha, 'get-alert-log', { roomCode: room })).toEqual({ ok: true });
    await waitFor(() => alpha.logs.length);
    expect(alpha.logs[0].log).toHaveLength(2);
    expect(alpha.logs[0].log.map((e) => e.type)).toEqual(['ping', 'sos']);

    // Not for members.
    expect(await ask(bravo, 'get-alert-log', { roomCode: room })).toEqual({ ok: false, reason: 'not-owner' });
    expect(bravo.logs).toEqual([]);
  });
});

describe('quiet zones as a strict setting', () => {
  const api = e2eServer({ env: { LOCUS_QUIET_ZONES_ENABLED: 'true', LOCUS_CLASS_CLOCK_ISO: DURING_CLASS, LOCUS_SOS_IN_QUIET_ZONE_MODE: 'blocked' } });

  it('can refuse an SOS from a quiet zone too, with the reason', async () => {
    const { room, alpha, bravo } = await group(api);
    await place(bravo, room, INSIDE);
    sos(bravo, room);
    await waitFor(() => bravo.results.length);
    expect(bravo.results[0]).toMatchObject({ type: 'sos', allowed: false, mode: 'blocked', reasonCode: 'QUIET_ZONE' });
    await sleep(150);
    expect(alpha.sos).toEqual([]);
  });
});

describe('outside class hours', () => {
  const api = e2eServer({ env: { LOCUS_QUIET_ZONES_ENABLED: 'true', LOCUS_CLASS_CLOCK_ISO: '2026-01-07T15:00:00Z' } }); // 20:30 in India

  it('the same position and no position behave normally', async () => {
    const { room, alpha, bravo, charlie } = await group(api);
    ping(bravo, charlie); // no position at all
    await waitFor(() => charlie.pings.length);
    await place(bravo, room, INSIDE);
    ping(bravo, alpha);
    await waitFor(() => alpha.pings.length);
    sos(bravo, room);
    await waitFor(() => alpha.sos.length);
    expect(alpha.sos[0]).not.toHaveProperty('flag');
  });
});

describe('forcing class hours', () => {
  const forced = e2eServer({ env: { LOCUS_QUIET_ZONES_ENABLED: 'true', LOCUS_CLASS_CLOCK_ISO: '2026-01-04T10:00:00Z', LOCUS_FORCE_CLASS_HOURS: 'true' } });

  it('makes the quiet zones apply on a Sunday', async () => {
    const { room, bravo, charlie } = await group(forced);
    await place(bravo, room, INSIDE);
    ping(bravo, charlie);
    await waitFor(() => bravo.results.length);
    expect(bravo.results[0]).toMatchObject({ allowed: false, reasonCode: 'QUIET_ZONE' });
  });
});

describe('forcing class hours in production', () => {
  const production = e2eServer({
    env: { LOCUS_QUIET_ZONES_ENABLED: 'true', LOCUS_CLASS_CLOCK_ISO: '2026-01-04T10:00:00Z', LOCUS_FORCE_CLASS_HOURS: 'true', NODE_ENV: 'production' },
  });

  it('is refused unless production is explicitly allowed as well, and the log says so', async () => {
    expect(production.serverOutput()).toContain('LOCUS_FORCE_CLASS_HOURS ignored: NODE_ENV is production');
    expect(production.serverOutput()).toContain('FORCE_CLASS_HOURS off');
    const { room, bravo, charlie } = await group(production);
    await place(bravo, room, INSIDE);
    ping(bravo, charlie);
    await waitFor(() => charlie.pings.length && bravo.results.length);
    expect(bravo.results[0]).toMatchObject({ allowed: true, mode: 'allow' });
  });
});

describe('a Group Lead changing hands', () => {
  const api = e2eServer({ env: { LOCUS_QUIET_ZONES_ENABLED: 'true', LOCUS_CLASS_CLOCK_ISO: DURING_CLASS } });

  it('keeps the settings, and a stand-in cannot change them', async () => {
    const { room, alpha, bravo } = await group(api);
    await ask(alpha, 'set-group-settings', { roomCode: room, sosEnabled: false });
    await ask(alpha, 'set-member-ping-mute', { roomCode: room, targetId: bravo.id, muted: true });

    // The Commander's phone drops. Bravo, a member the Commander let in, takes over for now.
    alpha.disconnect();
    await sleep(200);
    const standIn = track(await api.connect());
    expect(await api.returnToSquad(standIn, room, 'uB')).toEqual({ outcome: 'granted', role: 'OWNER', roomCode: room });
    await waitFor(() => standIn.settings.length);
    expect(last(standIn.settings)).toMatchObject({ sosEnabled: false, pingMuted: true });

    expect(await ask(standIn, 'set-group-settings', { roomCode: room, sosEnabled: true })).toEqual({ ok: false, reason: 'not-commander' });
    expect(await ask(standIn, 'set-member-ping-mute', { roomCode: room, targetId: standIn.id, muted: false })).toEqual({ ok: false, reason: 'not-commander' });

    // The Commander comes back to the squad exactly as they left it.
    const back = track(await api.connect());
    expect(await api.returnToSquad(back, room, 'uA')).toEqual({ outcome: 'granted', role: 'OWNER', roomCode: room });
    await waitFor(() => back.settings.length);
    expect(last(back.settings)).toMatchObject({ sosEnabled: false, pingEnabled: true });
    expect(await ask(back, 'set-group-settings', { roomCode: room, sosEnabled: true })).toEqual({ ok: true });
  });
});

describe('settings outliving the Group', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'locus-e2e-'));
  const file = path.join(dir, 'settings.json');
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  const api = e2eServer({
    env: {
      LOCUS_QUIET_ZONES_ENABLED: 'true', LOCUS_CLASS_CLOCK_ISO: DURING_CLASS, LOCUS_SETTINGS_FILE: file,
      LOCUS_ROOM_TTL_MS: '600', LOCUS_SWEEP_INTERVAL_MS: '100',
    },
  });

  it('come back when the same person sets the Group up again, and only for them', async () => {
    const room = api.newRoom();
    const alpha = track(await api.connect());
    await api.createSquad(alpha, room, 'uA');
    await ask(alpha, 'set-group-settings', { roomCode: room, sosEnabled: false, pingEnabled: false });

    // Saved to disk as soon as it changed: this is what a restart would read back.
    await waitFor(() => fs.existsSync(file));
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))[room]).toMatchObject({ commanderUid: 'uA', settings: { sosEnabled: false, pingEnabled: false } });

    // Everyone leaves; the sweep removes the empty Group.
    alpha.disconnect();
    await sleep(500);

    const stranger = track(await api.connect());
    expect(await api.requestJoin(stranger, room, 'uStranger')).toMatchObject({ outcome: 'granted', role: 'OWNER' });
    await waitFor(() => stranger.settings.length);
    expect(last(stranger.settings)).toMatchObject({ sosEnabled: true, pingEnabled: true });
    stranger.disconnect();
    await sleep(500);

    const again = track(await api.connect());
    expect(await api.requestJoin(again, room, 'uA')).toMatchObject({ outcome: 'granted', role: 'OWNER' });
    await waitFor(() => again.settings.length);
    expect(last(again.settings)).toMatchObject({ sosEnabled: false, pingEnabled: false });
  });

  it('stay with the Group when the Commander hands it on for good: the saved owner changes too', async () => {
    const room = api.newRoom();
    const [alpha, bravo] = [track(await api.connect()), track(await api.connect())];
    await api.createSquad(alpha, room, 'uA');
    await api.admit(alpha, bravo, room, 'uB');
    await ask(alpha, 'set-group-settings', { roomCode: room, pingEnabled: false });
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))[room].commanderUid).toBe('uA');

    // A deliberate exit (not a signal drop) gives the squad to Bravo for good.
    alpha.emit('leave-squad');
    await waitFor(() => JSON.parse(fs.readFileSync(file, 'utf8'))[room].commanderUid === 'uB');
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))[room].settings.pingEnabled).toBe(false);
    // Bravo, now the Commander, can change them.
    expect(await ask(bravo, 'set-group-settings', { roomCode: room, pingEnabled: true })).toEqual({ ok: true });
  });
});

describe('quiet zones with the master switch at its default (off)', () => {
  // Class hours forced on AND pinned inside class time AND a position inside a classroom
  // building: everything that would restrict an alert with the switch on, and nothing does.
  const api = e2eServer({ env: { LOCUS_CLASS_CLOCK_ISO: DURING_CLASS, LOCUS_FORCE_CLASS_HOURS: 'true', LOCUS_QUIET_ZONES_ENABLED: '' } });

  it('says so at startup, including that forcing class hours does nothing', () => {
    const line = api.serverOutput().split('\n').find((l) => l.startsWith('[GUARD] Always on'));
    expect(line).toContain('quiet zones + class-hours position rule OFF');
    expect(line).toContain('FORCE_CLASS_HOURS ON but has no effect while quiet zones are off');
  });

  it('lets a Ping and an SOS through from inside a quiet zone, and from no position at all', async () => {
    const { room, alpha, bravo, charlie } = await group(api);
    await place(bravo, room, INSIDE);
    ping(bravo, charlie);
    await waitFor(() => charlie.pings.length && bravo.results.length);
    expect(bravo.results[0]).toMatchObject({ allowed: true, mode: 'allow', reasonCode: null });
    sos(bravo, room);
    await waitFor(() => alpha.sos.length);
    expect(alpha.sos[0]).not.toHaveProperty('flag');

    // Charlie never sent a position.
    ping(charlie, alpha);
    await waitFor(() => alpha.pings.length);
    sos(charlie, room, { senderName: 'Charlie' });
    await waitFor(() => alpha.sos.length === 2);
    expect(alpha.sos[1]).not.toHaveProperty('flag');
  });

  it('still enforces every always-on rule', async () => {
    const { room, alpha, bravo, charlie } = await group(api);
    await place(bravo, room, INSIDE);

    // Ping cooldown.
    ping(bravo, charlie);
    await waitFor(() => charlie.pings.length);
    ping(bravo, charlie);
    await waitFor(() => bravo.results.length === 2);
    expect(bravo.results[1]).toMatchObject({ allowed: false, reasonCode: 'COOLDOWN' });

    // Member mute, and the Group switches.
    await ask(alpha, 'set-member-ping-mute', { roomCode: room, targetId: bravo.id, muted: true });
    ping(bravo, alpha);
    await waitFor(() => bravo.results.length === 3);
    expect(bravo.results[2]).toMatchObject({ allowed: false, reasonCode: 'MEMBER_MUTED' });
    await ask(alpha, 'set-group-settings', { roomCode: room, sosEnabled: false });
    sos(bravo, room);
    await waitFor(() => bravo.results.length === 4);
    expect(bravo.results[3]).toMatchObject({ allowed: false, reasonCode: 'GROUP_DISABLED' });
    await sleep(100);
    expect(alpha.sos).toEqual([]);
    await ask(alpha, 'set-group-settings', { roomCode: room, sosEnabled: true });

    // The SOS cooldown, the repeated-SOS notice and the log.
    for (let i = 0; i < 4; i++) sos(bravo, room);
    await waitFor(() => alpha.notices.length);
    await waitFor(() => bravo.results.length === 8);
    expect(alpha.sos).toHaveLength(1);
    expect(bravo.results.slice(5).every((r) => r.reasonCode === 'COOLDOWN')).toBe(true);
    expect(alpha.logEntries.length).toBeGreaterThanOrEqual(5);
  });
});
