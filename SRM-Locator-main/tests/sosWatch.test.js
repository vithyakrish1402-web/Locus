import { describe, it, expect, vi, afterEach } from 'vitest';
import { createSosWatch } from '../backend/sosWatch.js';
import { recordSos, coalesceSos, pendingSosSince, toBackgroundSosPayload, toSosPayload, ackSos } from '../backend/sosRelay.js';

afterEach(() => vi.useRealTimers());

describe('the SOS bell (sosWatch)', () => {
  it('wakes everyone waiting on that Group, and only that Group', async () => {
    const watch = createSosWatch();
    const a1 = watch.wait('ALPHA', 5000);
    const a2 = watch.wait('ALPHA', 5000);
    const b = watch.wait('BRAVO', 5000);
    watch.notify('ALPHA');
    expect(await a1.done).toBe('woken');
    expect(await a2.done).toBe('woken');
    expect(watch.count()).toBe(1);
    b.cancel();
  });

  it('gives up at its timeout, and holds nothing afterwards', async () => {
    vi.useFakeTimers();
    const watch = createSosWatch();
    const waiting = watch.wait('ALPHA', 1000);
    await vi.advanceTimersByTimeAsync(999);
    expect(watch.count()).toBe(1);
    await vi.advanceTimersByTimeAsync(2);
    expect(await waiting.done).toBe('timeout');
    expect(watch.count()).toBe(0);
  });

  it('stops waiting at once when the caller goes away, and a later ring does nothing', async () => {
    const watch = createSosWatch();
    const waiting = watch.wait('ALPHA', 60000);
    waiting.cancel();
    expect(await waiting.done).toBe('cancelled');
    expect(watch.count()).toBe(0);
    expect(() => watch.notify('ALPHA')).not.toThrow();
  });

  it('a ring with nobody waiting is nothing', () => {
    expect(() => createSosWatch().notify('NOBODY')).not.toThrow();
  });
});

describe('the rev an SOS carries for a closed-app listener', () => {
  const fire = (squad, over = {}, now = 1000) =>
    recordSos(squad, { senderKey: 'uA', senderId: 's1', senderName: 'Alpha', lat: 1, lng: 2, timestamp: now, ...over }, now);

  it('goes up with every new SOS and every update, per Group', () => {
    const squad = {};
    const other = {};
    const first = fire(squad, { senderKey: 'uA' });
    const second = fire(squad, { senderKey: 'uB' });
    expect([first.rev, second.rev]).toEqual([1, 2]);
    coalesceSos(squad, { senderKey: 'uA', senderId: 's1', lat: 3, lng: 4 }, 1500, 60000);
    expect(first.rev).toBe(3);
    expect(fire(other).rev).toBe(1); // another Group counts for itself
  });

  it('is left off the socket payload, which stays what it was', () => {
    const sos = fire({});
    expect(toSosPayload(sos, 1000)).not.toHaveProperty('rev');
    expect(toSosPayload(sos, 1000)).not.toHaveProperty('senderUid');
    expect(toBackgroundSosPayload(sos, 1000)).toMatchObject({ rev: 1, senderUid: 'uA', senderName: 'Alpha', id: sos.id });
  });

  it('offers only what is newer than the cursor, not the person\'s own, not what they acknowledged, not what expired', () => {
    const squad = {};
    const a = fire(squad, { senderKey: 'uA' });
    const b = fire(squad, { senderKey: 'uB' });
    expect(pendingSosSince(squad, 'uC', 0, 1000).map((s) => s.id)).toEqual([a.id, b.id]);
    expect(pendingSosSince(squad, 'uC', 1, 1000).map((s) => s.id)).toEqual([b.id]);
    expect(pendingSosSince(squad, 'uC', 2, 1000)).toEqual([]);
    expect(pendingSosSince(squad, 'uA', 0, 1000).map((s) => s.id)).toEqual([b.id]); // not their own
    ackSos(squad, b.id, 'uA');
    expect(pendingSosSince(squad, 'uA', 0, 1000)).toEqual([]);
    expect(pendingSosSince(squad, 'uC', 0, 1000 + 31 * 60 * 1000)).toEqual([]); // expired
  });
});
