import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { notify, post, dismiss, subscribe, DURATIONS, MAX_VISIBLE, __resetNotifications } from '../src/utils/notify.js';

let seen;
let unsubscribe;
const vibrate = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  globalThis.navigator ??= {};
  Object.defineProperty(globalThis.navigator, 'vibrate', { configurable: true, value: vibrate });
  vibrate.mockClear();
  __resetNotifications();
  unsubscribe = subscribe((items) => { seen = items; });
});

afterEach(() => {
  unsubscribe();
  __resetNotifications();
  vi.useRealTimers();
});

describe('the comms feed store', () => {
  it('posts a notice and tells subscribers', () => {
    notify.info('Link established');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ severity: 'info', message: 'Link established' });
  });

  it("lifts the app's [TAG] prefix into the title", () => {
    notify.error('[SYS_ERROR] ID AND KEY ARE REQUIRED FOR LINK.');
    expect(seen[0]).toMatchObject({ title: 'SYS_ERROR', message: 'ID AND KEY ARE REQUIRED FOR LINK.' });
  });

  it('keeps an explicit title, and the message whole', () => {
    notify.warning('[NOT A TAG] text', { title: 'MINE' });
    expect(seen[0]).toMatchObject({ title: 'MINE', message: '[NOT A TAG] text' });
  });

  it('dismisses itself after its severity\'s time, errors lasting longest', () => {
    expect(DURATIONS.error).toBeGreaterThan(DURATIONS.info);
    notify.success('done');
    vi.advanceTimersByTime(DURATIONS.success - 1);
    expect(seen).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(seen).toHaveLength(0);
  });

  it('can stay until dismissed, and be dismissed by id', () => {
    const id = notify.error('sticky', { duration: 0 });
    vi.advanceTimersByTime(60_000);
    expect(seen).toHaveLength(1);
    dismiss(id);
    expect(seen).toHaveLength(0);
  });

  it('refreshes a repeated notice instead of stacking copies', () => {
    const first = notify.error('same thing');
    vi.advanceTimersByTime(DURATIONS.error - 100);
    const again = notify.error('same thing');
    expect(again).toBe(first);
    expect(seen).toHaveLength(1);
    vi.advanceTimersByTime(DURATIONS.error - 100); // the timer restarted
    expect(seen).toHaveLength(1);
    vi.advanceTimersByTime(200);
    expect(seen).toHaveLength(0);
  });

  it('shows at most a few at once, dropping the oldest', () => {
    for (let i = 0; i < MAX_VISIBLE + 3; i++) notify.info(`notice ${i}`);
    expect(seen).toHaveLength(MAX_VISIBLE);
    expect(seen[0].message).toBe(`notice 3`);
    expect(seen.at(-1).message).toBe(`notice ${MAX_VISIBLE + 2}`);
  });

  // Owner, 2026-10-07: a safety notice (an Emergency alert that couldn't reach the group) is
  // never pushed out by ordinary notices; the oldest ordinary one goes instead.
  it('never pushes out a safety notice: the oldest ordinary one goes instead', () => {
    notify.warning('group gone', { duration: 0, safety: true });
    for (let i = 0; i < MAX_VISIBLE + 3; i++) notify.info(`notice ${i}`);
    expect(seen).toHaveLength(MAX_VISIBLE);
    expect(seen[0].message).toBe('group gone');
    expect(seen.slice(1).map((n) => n.message)).toEqual(['notice 4', 'notice 5', 'notice 6']);
  });

  it('with only safety notices left, holds more than the limit rather than drop one', () => {
    for (let i = 0; i < MAX_VISIBLE + 1; i++) notify.warning(`safety ${i}`, { duration: 0, safety: true });
    expect(seen).toHaveLength(MAX_VISIBLE + 1);
    notify.info('ordinary');
    expect(seen.map((n) => n.message)).not.toContain('ordinary');
    expect(seen.filter((n) => n.safety)).toHaveLength(MAX_VISIBLE + 1);
  });

  it('ignores empty messages and unknown severities fall back to info', () => {
    expect(notify.error('   ')).toBeNull();
    expect(notify.error('[SYS_ERROR]')).toBeNull(); // a tag and nothing to say
    post('shouting', 'hello');
    expect(seen).toHaveLength(1);
    expect(seen[0].severity).toBe('info');
  });

  it('gives each severity its own haptic', () => {
    notify.info('a');
    notify.success('b');
    notify.error('c');
    expect(vibrate.mock.calls.map(([p]) => p)).toEqual([8, [10, 40, 16], [6, 30, 10]]);
  });

  it('can post without a buzz, for the notices that replaced the silent banners', () => {
    notify.info('a', { haptic: false });
    notify.warning('b', { haptic: false });
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('keeps a second line (body) and a ping kind', () => {
    notify.warning('Showing where they were last.', { title: 'Aarav lost connection', body: 'extra', kind: 'ping' });
    expect(seen[0]).toMatchObject({ title: 'Aarav lost connection', message: 'Showing where they were last.', body: 'extra', kind: 'ping' });
  });
});
