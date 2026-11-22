// @vitest-environment jsdom
//
// The sharing control with timed Pause and Hidden (components/group/SharingControl.jsx): the
// duration picker, its limits, and the countdown by the server's clock. And without `timed`, or with
// it inactive, exactly as before.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup, within } from '@testing-library/react';
import SharingControl from '../src/components/group/SharingControl.jsx';
import { clockLabel } from '../src/utils/timedPrivacy.js';

const MIN = 60_000;
const SKEW = MIN; // the server is a minute ahead of the phone

const timedProps = (over = {}) => ({ active: true, hold: null, allowanceLeftMs: 30 * MIN, offset: SKEW, pending: false, onPick: vi.fn(), ...over });
const radio = (name) => screen.getByRole('radio', { name });
const durations = () => within(screen.getByTestId('duration-picker')).queryAllByRole('button').map((b) => b.textContent).filter((t) => t !== 'Cancel');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date(2026, 10, 22, 13, 0, 0));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('without timed holds', () => {
  it.each([null, { active: false }])('picks at once, as in js-1.1.87 (timed: %o)', (timed) => {
    const onChange = vi.fn();
    render(<SharingControl mode="ACTIVE" onChange={onChange} timed={timed} />);
    fireEvent.click(radio('Paused'));
    expect(onChange).toHaveBeenCalledWith('FROZEN');
    expect(screen.queryByTestId('duration-picker')).toBeNull();
    expect(screen.queryByTestId('sharing-allowance')).toBeNull();
  });
});

describe('with timed holds', () => {
  it('asks how long before pausing, and only within the 30-minute limit', () => {
    const onChange = vi.fn();
    const timed = timedProps({ allowanceLeftMs: 45 * MIN });
    render(<SharingControl mode="ACTIVE" onChange={onChange} timed={timed} />);
    fireEvent.click(radio('Paused'));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('Pause for how long?')).toBeTruthy();
    expect(durations()).toEqual(['5 min', '10 min', '15 min', '20 min', '30 min']);
    fireEvent.click(screen.getByRole('button', { name: '10 min' }));
    expect(timed.onPick).toHaveBeenCalledWith('FROZEN', 10);
    expect(screen.queryByTestId('duration-picker')).toBeNull();
  });

  it('never offers more than the server says is left, and says how much that is', () => {
    render(<SharingControl mode="ACTIVE" onChange={vi.fn()} timed={timedProps({ allowanceLeftMs: 12 * MIN + 40_000 })} />);
    expect(screen.getByTestId('sharing-allowance').textContent).toBe('12 min of Pause and Hidden left this hour');
    fireEvent.click(radio('Hidden'));
    expect(screen.getByText('Hide for how long?')).toBeTruthy();
    expect(durations()).toEqual(['5 min', '10 min', '12 min']);
  });

  it('with nothing left, says so in plain words and offers nothing', () => {
    render(<SharingControl mode="ACTIVE" onChange={vi.fn()} timed={timedProps({ allowanceLeftMs: 20_000 })} />);
    fireEvent.click(radio('Hidden'));
    expect(screen.getByTestId('duration-none').textContent).toMatch(/used all 30 minutes/);
    expect(durations()).toEqual([]);
  });

  it('can be cancelled, and Live is always at once', () => {
    const onChange = vi.fn();
    render(<SharingControl mode="FROZEN" onChange={onChange} timed={timedProps()} />);
    fireEvent.click(radio('Hidden'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('duration-picker')).toBeNull();
    fireEvent.click(radio('Live'));
    expect(onChange).toHaveBeenCalledWith('ACTIVE');
  });

  it("counts down by the server's clock, showing the end in the phone's clock", () => {
    const until = Date.now() + SKEW + 5 * MIN; // 5 minutes of the server's time
    render(<SharingControl mode="GHOST" onChange={vi.fn()} timed={timedProps({ hold: { mode: 'GHOST', until } })} />);
    const end = clockLabel(until, SKEW);
    expect(screen.getByTestId('hold-countdown').textContent).toBe(`Hidden for 5:00 more, until ${end}`);
    act(() => { vi.advanceTimersByTime(61_000); });
    expect(screen.getByTestId('hold-countdown').textContent).toBe(`Hidden for 3:59 more, until ${end}`);
  });

  it('while pending, the durations wait', () => {
    render(<SharingControl mode="ACTIVE" onChange={vi.fn()} timed={timedProps({ pending: true })} />);
    fireEvent.click(radio('Paused'));
    expect(screen.getByRole('button', { name: '5 min' }).disabled).toBe(true);
  });
});
