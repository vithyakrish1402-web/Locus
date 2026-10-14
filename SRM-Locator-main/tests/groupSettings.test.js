import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  defaultSettings, settingsOf, canChangeSettings, updateSwitches, setPingerMuted, isPingerMuted,
  setPersonallyMuted, isPersonallyMuted, settingsFor, createSettingsStore,
} from '../backend/groupSettings.js';
import { logAlert, pingHistory, recordPing, noteSosAttempt } from '../backend/alertLog.js';
import { recordSos, coalesceSos, toSosPayload } from '../backend/sosRelay.js';

/** A Group's switches, mutes and saved settings, and what the server remembers about alerts. */

describe('who may change a Group\'s settings', () => {
  const squad = { ownerId: 's1' };

  it('is the Commander, holding command', () => {
    expect(canChangeSettings(squad, 's1', 'uA', 'uA')).toBe(true);
  });

  it('is not a member, nor a stand-in who holds command for a while', () => {
    expect(canChangeSettings(squad, 's2', 'uB', 'uA')).toBe(false);
    expect(canChangeSettings(squad, 's1', 'uB', 'uA')).toBe(false); // owner socket, but not the Commander
  });

  it('falls back to command for a Group whose people have no uid (an old client)', () => {
    expect(canChangeSettings(squad, 's1', null, null)).toBe(true);
    expect(canChangeSettings(squad, 's2', null, null)).toBe(false);
  });

  it('is nobody in a Group that does not exist', () => {
    expect(canChangeSettings(undefined, 's1', 'uA', 'uA')).toBe(false);
  });
});

describe('switches and mutes', () => {
  it('start with everything on, and reading them creates nothing', () => {
    const squad = {};
    expect(settingsOf(squad)).toEqual({ sosEnabled: true, pingEnabled: true, mutedPingers: [] });
    expect(squad.settings).toBeUndefined();
  });

  it('change only for real booleans, and say whether anything changed', () => {
    const squad = {};
    expect(updateSwitches(squad, { sosEnabled: false })).toBe(true);
    expect(settingsOf(squad)).toMatchObject({ sosEnabled: false, pingEnabled: true });
    expect(updateSwitches(squad, { sosEnabled: false })).toBe(false);
    expect(updateSwitches(squad, { sosEnabled: 'no', pingEnabled: 0 })).toBe(false);
    expect(updateSwitches(squad, null)).toBe(false);
    expect(settingsOf(squad)).toMatchObject({ sosEnabled: false, pingEnabled: true });
  });

  it('mute and unmute one sender\'s pings', () => {
    const squad = {};
    expect(setPingerMuted(squad, 'uB', true)).toBe(true);
    expect(isPingerMuted(squad, 'uB')).toBe(true);
    expect(isPingerMuted(squad, 'uC')).toBe(false);
    expect(setPingerMuted(squad, 'uB', true)).toBe(false);
    expect(setPingerMuted(squad, 'uB', false)).toBe(true);
    expect(isPingerMuted(squad, 'uB')).toBe(false);
    expect(setPingerMuted(squad, 'uB', false)).toBe(false);
    expect(setPingerMuted(squad, '', true)).toBe(false);
  });

  it('keep a person\'s own mutes apart from the Group\'s, and safe from odd identities', () => {
    const squad = {};
    expect(setPersonallyMuted(squad, 'uC', 'uB', true)).toBe(true);
    expect(isPersonallyMuted(squad, 'uC', 'uB')).toBe(true);
    expect(isPersonallyMuted(squad, 'uA', 'uB')).toBe(false);
    expect(isPingerMuted(squad, 'uB')).toBe(false);
    expect(setPersonallyMuted(squad, '__proto__', 'uB', true)).toBe(true);
    expect({}.uB).toBeUndefined();
    expect(setPersonallyMuted(squad, 'uC', 'uB', false)).toBe(true);
    expect(isPersonallyMuted(squad, 'uC', 'uB')).toBe(false);
  });
});

describe('what a member is told', () => {
  const squad = { members: ['s1', 's2', 's3'] };
  updateSwitches(squad, { pingEnabled: false });
  setPingerMuted(squad, 'uB', true);
  const keyOf = (id) => ({ s1: 'uA', s2: 'uB', s3: 'uC' })[id];

  it('is the switches and whether you yourself are muted', () => {
    expect(settingsFor(squad, 'ROOM', { key: 'uB', isLead: false, keyOf })).toEqual({
      roomCode: 'ROOM', sosEnabled: true, pingEnabled: false, pingMuted: true,
    });
    expect(settingsFor(squad, 'ROOM', { key: 'uC', isLead: false, keyOf }).pingMuted).toBe(false);
  });

  it('also names who is muted, but only to whoever holds command', () => {
    expect(settingsFor(squad, 'ROOM', { key: 'uA', isLead: true, keyOf }).mutedMemberIds).toEqual(['s2']);
    expect(settingsFor(squad, 'ROOM', { key: 'uB', isLead: false, keyOf })).not.toHaveProperty('mutedMemberIds');
  });
});

describe('saved settings', () => {
  const dirs = [];
  afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
  const tmpFile = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'locus-settings-'));
    dirs.push(dir);
    return path.join(dir, 'settings.json');
  };
  const HOUR = 3600000;
  const custom = { sosEnabled: false, pingEnabled: true, mutedPingers: ['uB'] };

  it('come back for the person who saved them, and for nobody else', () => {
    const store = createSettingsStore({ ttlMs: 24 * HOUR });
    store.save('ROOM', 'uA', custom);
    expect(store.restore('ROOM', 'uA')).toEqual(custom);
    expect(store.restore('ROOM', 'uB')).toBeNull();
    expect(store.restore('ROOM', null)).toBeNull();
    expect(store.restore('OTHER', 'uA')).toBeNull();
  });

  it('expire', () => {
    let now = 1_000_000;
    const store = createSettingsStore({ ttlMs: 24 * HOUR, now: () => now });
    store.save('ROOM', 'uA', custom);
    now += 24 * HOUR;
    expect(store.restore('ROOM', 'uA')).toEqual(custom);
    now += 1;
    expect(store.restore('ROOM', 'uA')).toBeNull();
  });

  it('are copies, so later changes to a Group do not rewrite what was saved', () => {
    const store = createSettingsStore({ ttlMs: HOUR });
    const live = { ...defaultSettings(), mutedPingers: ['uB'] };
    store.save('ROOM', 'uA', live);
    live.mutedPingers.push('uC');
    live.sosEnabled = false;
    const restored = store.restore('ROOM', 'uA');
    expect(restored).toMatchObject({ sosEnabled: true, mutedPingers: ['uB'] });
    restored.mutedPingers.push('uD');
    expect(store.restore('ROOM', 'uA').mutedPingers).toEqual(['uB']);
  });

  it('survive a restart when a file is given: a new store reads what the old one wrote', () => {
    const filePath = tmpFile();
    createSettingsStore({ filePath, ttlMs: HOUR }).save('ROOM', 'uA', custom);
    const afterRestart = createSettingsStore({ filePath, ttlMs: HOUR });
    expect(afterRestart.restore('ROOM', 'uA')).toEqual(custom);
  });

  it('start empty rather than fail when the file is missing or damaged', () => {
    const filePath = tmpFile();
    expect(createSettingsStore({ filePath, ttlMs: HOUR }).restore('ROOM', 'uA')).toBeNull();
    fs.writeFileSync(filePath, '{not json');
    expect(createSettingsStore({ filePath, ttlMs: HOUR }).restore('ROOM', 'uA')).toBeNull();
  });
});

describe('the alert log', () => {
  it('keeps the newest entries', () => {
    const squad = {};
    for (let i = 1; i <= 5; i++) logAlert(squad, { at: i }, 3);
    expect(squad.alertLog.map((e) => e.at)).toEqual([3, 4, 5]);
  });
});

describe('ping history', () => {
  const WINDOW = 10 * 60 * 1000;

  it('remembers who was pinged when, and forgets what is outside the window', () => {
    const squad = {};
    recordPing(squad, 'uA', 'uB', 1000, WINDOW);
    recordPing(squad, 'uA', 'uC', 2000, WINDOW);
    expect(pingHistory(squad, 'uA', 'uB', 3000, WINDOW)).toEqual({ lastToTargetAt: 1000, recentAts: [1000, 2000] });
    expect(pingHistory(squad, 'uA', 'uD', 3000, WINDOW)).toEqual({ lastToTargetAt: null, recentAts: [1000, 2000] });
    expect(pingHistory(squad, 'uA', 'uB', 1000 + WINDOW, WINDOW)).toEqual({ lastToTargetAt: null, recentAts: [2000] });
    expect(pingHistory(squad, 'uZ', 'uB', 3000, WINDOW)).toEqual({ lastToTargetAt: null, recentAts: [] });
  });

  it('is safe for any identity', () => {
    const squad = {};
    recordPing(squad, '__proto__', 'uB', 1000, WINDOW);
    expect({}.length).toBeUndefined();
    expect(pingHistory(squad, '__proto__', 'uB', 2000, WINDOW).recentAts).toEqual([1000]);
  });
});

describe('repeated SOS', () => {
  const WINDOW = 15 * 60 * 1000;
  const note = (squad, now) => noteSosAttempt(squad, 'uB', now, WINDOW, 3);

  it('is flagged once, when it reaches the count, and not again for each press after', () => {
    const squad = {};
    expect(note(squad, 0)).toEqual({ count: 1, flag: false });
    expect(note(squad, 1000)).toEqual({ count: 2, flag: false });
    expect(note(squad, 2000)).toEqual({ count: 3, flag: true });
    expect(note(squad, 3000)).toEqual({ count: 4, flag: false });
  });

  it('counts only those inside the window, and can be flagged again in a later one', () => {
    const squad = {};
    note(squad, 0);
    note(squad, 1000);
    expect(note(squad, WINDOW + 1001).count).toBe(1);
    note(squad, WINDOW + 1002);
    expect(note(squad, WINDOW + 1003)).toEqual({ count: 3, flag: true });
  });

  it('counts each person separately', () => {
    const squad = {};
    noteSosAttempt(squad, 'uB', 0, WINDOW, 3);
    noteSosAttempt(squad, 'uB', 1, WINDOW, 3);
    expect(noteSosAttempt(squad, 'uC', 2, WINDOW, 3)).toEqual({ count: 1, flag: false });
  });
});

describe('coalescing an SOS', () => {
  const WINDOW = 60000;
  const press = (squad, extra = {}, now = 0) =>
    recordSos(squad, { senderKey: 'uB', senderId: 's2', senderName: 'Bravo', lat: 1, lng: 2, timestamp: now, ...extra }, now);

  it('updates a fresh SOS in place: same id, newest place and time, acknowledgements kept', () => {
    const squad = {};
    const first = press(squad);
    first.ackedBy.push('uC');
    const updated = coalesceSos(squad, { senderKey: 'uB', senderId: 's9', lat: 5, lng: 6, timestamp: 4000 }, 4000, WINDOW);
    expect(updated.id).toBe(first.id);
    expect(updated).toMatchObject({ lat: 5, lng: 6, timestamp: 4000, senderId: 's9', createdAt: 0, ackedBy: ['uC'] });
    expect(squad.sos.uB.id).toBe(first.id);
  });

  it('keeps the old place when the new press has none', () => {
    const squad = {};
    press(squad);
    const updated = coalesceSos(squad, { senderKey: 'uB', senderId: 's2', lat: undefined, lng: null }, 1000, WINDOW);
    expect(updated).toMatchObject({ lat: 1, lng: 2 });
  });

  it('does nothing once the window has passed, or for another sender, or with no SOS yet', () => {
    const squad = {};
    press(squad);
    expect(coalesceSos(squad, { senderKey: 'uB' }, WINDOW - 1, WINDOW)).not.toBeNull();
    expect(coalesceSos(squad, { senderKey: 'uB' }, WINDOW, WINDOW)).toBeNull();
    expect(coalesceSos(squad, { senderKey: 'uC' }, 1000, WINDOW)).toBeNull();
    expect(coalesceSos({}, { senderKey: 'uB' }, 1000, WINDOW)).toBeNull();
  });

  it('is off with a window of 0', () => {
    const squad = {};
    press(squad);
    expect(coalesceSos(squad, { senderKey: 'uB' }, 0, 0)).toBeNull();
  });

  it('carries a flag on the wire only when the server set one', () => {
    const squad = {};
    expect(toSosPayload(press(squad), 0)).not.toHaveProperty('flag');
    const flagged = press(squad, { flag: 'QUIET_ZONE' });
    expect(toSosPayload(flagged, 0).flag).toBe('QUIET_ZONE');
    coalesceSos(squad, { senderKey: 'uB', flag: 'LOCATION_UNKNOWN' }, 100, WINDOW);
    expect(squad.sos.uB.flag).toBe('LOCATION_UNKNOWN');
  });
});
