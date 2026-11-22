import { describe, it, expect } from 'vitest';
import {
  TIMED_PRIVACY_ENABLED, MAX_HOLD_MINUTES, HEADS_UP_BEFORE_MS, durationChoices, clockOffset, serverTime,
  msLeft, headsUpDelayMs, clockLabel, countdownLabel, hideAgainMinutes, wholeMinutes,
} from '../src/utils/timedPrivacy.js';
import { memberStatus } from '../src/utils/memberStatus.js';
import { TIMED_PRIVACY } from '../src/copy/group.js';

const MIN = 60_000;

describe('the switch and the limits', () => {
  it('is on in this release (shown only once the server says so), with 30-minute holds and a 2-minute heads-up', () => {
    expect(TIMED_PRIVACY_ENABLED).toBe(true);
    expect(MAX_HOLD_MINUTES).toBe(30);
    expect(HEADS_UP_BEFORE_MS).toBe(2 * MIN);
  });
});

describe('the duration picker', () => {
  it('offers up to 30 minutes, never more than is left', () => {
    expect(durationChoices(null)).toEqual([5, 10, 15, 20, 30]);
    expect(durationChoices(45 * MIN)).toEqual([5, 10, 15, 20, 30]);
    expect(durationChoices(30 * MIN)).toEqual([5, 10, 15, 20, 30]);
    expect(durationChoices(12 * MIN + 59_000)).toEqual([5, 10, 12]);
    expect(durationChoices(3 * MIN)).toEqual([3]);
    expect(durationChoices(59_000)).toEqual([]);
    expect(durationChoices(0)).toEqual([]);
  });
});

describe('the clock', () => {
  it("counts by the server's clock, not the phone's", () => {
    const offset = clockOffset(1_000_000 + 60_000, 1_000_000); // the server is a minute ahead
    expect(offset).toBe(60_000);
    expect(serverTime(offset, 1_000_000)).toBe(1_060_000);
    const until = 1_060_000 + 5 * MIN; // 5 minutes of server time
    expect(msLeft(until, offset, 1_000_000)).toBe(5 * MIN);
    expect(msLeft(until, offset, 1_000_000 + 6 * MIN)).toBe(0);
  });

  it('times the heads-up 2 minutes before the end, or at once when less is left', () => {
    expect(headsUpDelayMs(10 * MIN, 0, 0)).toBe(8 * MIN);
    expect(headsUpDelayMs(90_000, 0, 0)).toBe(0);
    expect(headsUpDelayMs(10 * MIN, 60_000, 0)).toBe(7 * MIN);
  });

  it("shows a server time in the phone's own clock", () => {
    const at = new Date(2026, 10, 22, 14, 5).getTime();
    expect(clockLabel(at + 60_000, 60_000)).toBe(new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    expect(clockLabel(NaN)).toBe('');
  });

  it('counts down in minutes and seconds', () => {
    expect(countdownLabel(5 * MIN)).toBe('5:00');
    expect(countdownLabel(299_001)).toBe('5:00');
    expect(countdownLabel(61_000)).toBe('1:01');
    expect(countdownLabel(-5)).toBe('0:00');
  });
});

describe('"Hide again"', () => {
  it('asks for what is left plus what the running hold has not used, at most 30', () => {
    expect(hideAgainMinutes(10 * MIN, 2 * MIN)).toBe(12);
    expect(hideAgainMinutes(40 * MIN, 2 * MIN)).toBe(30);
    expect(hideAgainMinutes(30_000, 2 * MIN)).toBe(2);
  });

  it('is not offered when nothing is left', () => {
    expect(hideAgainMinutes(0, 2 * MIN)).toBe(0);
    expect(hideAgainMinutes(null, 2 * MIN)).toBe(0);
  });
});

describe('the words', () => {
  it('say how much is left, plainly', () => {
    expect(wholeMinutes(12 * MIN + 59_000)).toBe(12);
    expect(TIMED_PRIVACY.allowanceLeft(12 * MIN + 59_000)).toBe('12 min of Pause and Hidden left this hour');
    expect(TIMED_PRIVACY.refused(7 * MIN)).toBe('Only 7 min of Pause and Hidden is left this hour. Pick that or less.');
    expect(TIMED_PRIVACY.refused(0)).toBe("You've used all 30 minutes of Pause and Hidden for this hour. More frees up as the hour goes on.");
    expect(TIMED_PRIVACY.ended.expired).toBe("You're visible to your group again.");
    expect(TIMED_PRIVACY.ended.sos).toMatch(/because you sent an SOS/);
  });
});

describe("another member's timed Pause or Hidden", () => {
  const until = new Date(2026, 10, 22, 14, 5).getTime();
  const clock = new Date(until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  it('says until when, in this phone\'s clock, when timed holds are on', () => {
    expect(memberStatus({ hasFix: true, status: 'FROZEN', holdUntil: until }, 0, { timed: true }).text).toBe(`Paused until ${clock}`);
    expect(memberStatus({ hasFix: false, status: 'GHOST', holdUntil: until }, 0, { timed: true }).text).toBe(`Hidden until ${clock}`);
  });

  it('is as before with timed holds off, or with no end time', () => {
    expect(memberStatus({ hasFix: true, status: 'FROZEN', holdUntil: until }, 0, { timed: false }).text).toBe('Paused');
    expect(memberStatus({ hasFix: false, status: 'GHOST', holdUntil: until }, 0, { timed: false }).text).toBe('Waiting for location');
    expect(memberStatus({ hasFix: true, status: 'FROZEN' }, 0, { timed: true }).text).toBe('Paused');
  });
});
