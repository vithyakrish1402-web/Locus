// @vitest-environment jsdom
//
// Nearby Join's screens (components/nearby/Nearby.jsx): the lobby opt-in and its indicator, the
// presser's list, and an invite, whose Accept cannot be hit by accident.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'framer-motion';
import { DiscoverableIndicator, DiscoverableToggle, InvitePrompt, NearbySheet } from '../src/components/nearby/Nearby.jsx';
import { NEARBY } from '../src/copy/group.js';
import { INVITE_ACCEPT_ARM_MS } from '../src/utils/nearby.js';

MotionGlobalConfig.skipAnimations = true;

const MIN = 60_000;
const SKEW = MIN; // the server is a minute ahead of the phone

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date(2026, 10, 23, 10, 0, 0));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the lobby opt-in', () => {
  it('says what it does and why it asks for location', () => {
    const onChange = vi.fn();
    render(<DiscoverableToggle on={false} onChange={onChange} />);
    expect(screen.getByText(NEARBY.toggle)).toBeTruthy();
    expect(screen.getByText(NEARBY.toggleHelp)).toBeTruthy();
    expect(screen.getByText(NEARBY.permissionHelp)).toBeTruthy();
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('the indicator says so, with a one-tap off', () => {
    const onOff = vi.fn();
    render(<DiscoverableIndicator onOff={onOff} />);
    expect(screen.getByRole('status').textContent).toContain(NEARBY.visible);
    fireEvent.click(screen.getByRole('button', { name: NEARBY.turnOff }));
    expect(onOff).toHaveBeenCalled();
  });
});

describe('an invite', () => {
  const invite = (over = {}) => ({ inviteId: 'i1', fromName: 'Asha', expiresAt: Date.now() + SKEW + 2 * MIN, offset: SKEW, shownAt: Date.now(), ...over });

  it("says who and how long it stays open, by the server's clock", () => {
    render(<InvitePrompt invite={invite()} onRespond={vi.fn()} />);
    expect(screen.getByText(NEARBY.inviteTitle('Asha'))).toBeTruthy();
    expect(screen.getByTestId('nearby-invite-left').textContent).toBe(NEARBY.inviteExpiresIn('2:00'));
    act(() => { vi.advanceTimersByTime(61_000); });
    expect(screen.getByTestId('nearby-invite-left').textContent).toBe(NEARBY.inviteExpiresIn('0:59'));
  });

  it('cannot be accepted by accident: focus is not on Join group, and it does nothing at first', () => {
    const onRespond = vi.fn();
    render(<InvitePrompt invite={invite()} onRespond={onRespond} />);
    const accept = screen.getByRole('button', { name: NEARBY.accept });
    expect(document.activeElement).not.toBe(accept);
    fireEvent.click(accept);
    expect(onRespond).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(INVITE_ACCEPT_ARM_MS); });
    fireEvent.click(screen.getByRole('button', { name: NEARBY.accept }));
    expect(onRespond).toHaveBeenCalledWith(true);
  });

  it('Not now declines at once', () => {
    const onRespond = vi.fn();
    render(<InvitePrompt invite={invite()} onRespond={onRespond} />);
    fireEvent.click(screen.getByRole('button', { name: NEARBY.decline }));
    expect(onRespond).toHaveBeenCalledWith(false);
  });

  it('with no invite, nothing shows', () => {
    render(<InvitePrompt invite={null} onRespond={vi.fn()} />);
    expect(screen.queryByTestId('nearby-invite')).toBeNull();
  });
});

describe("the presser's list", () => {
  const props = (over = {}) => ({ open: true, onClose: vi.fn(), state: 'done', rows: [], onScan: vi.fn(), onToggle: vi.fn(), onInvite: vi.fn(), onInviteAll: vi.fn(), ...over });
  const row = (id, name, extra = {}) => ({ id, name, selected: false, status: 'idle', ...extra });

  it('shows names only, each selectable, and says each person still has to accept', () => {
    const p = props({ rows: [row('s1', 'Bo'), row('s2', 'Cy', { selected: true })] });
    render(<NearbySheet {...p} />);
    expect(screen.getByTestId('nearby-each-accepts').textContent).toBe(NEARBY.eachAccepts);
    const list = screen.getByTestId('nearby-list');
    expect(list.textContent).not.toMatch(/\d+\s?m\b|lat|lng|12\.8/);
    fireEvent.click(within(list).getByRole('checkbox', { name: NEARBY.select('Bo') }));
    expect(p.onToggle).toHaveBeenCalledWith('s1');
    fireEvent.click(screen.getByRole('button', { name: NEARBY.inviteSelected(1) }));
    expect(p.onInvite).toHaveBeenCalledWith(['s2']);
    fireEvent.click(screen.getByRole('button', { name: NEARBY.addAll(2) }));
    expect(p.onInviteAll).toHaveBeenCalled();
  });

  it('shows what each invite came to', () => {
    render(<NearbySheet {...props({ rows: [row('s1', 'Bo', { status: 'joined' }), row('s2', 'Cy', { status: 'declined' }), row('s3', 'Di', { status: 'expired' })] })} />);
    expect(screen.getAllByTestId('nearby-row-status').map((n) => n.textContent)).toEqual(['Joined', 'Declined', 'Invite expired']);
    expect(screen.queryByRole('button', { name: /Add all/ })).toBeNull();
  });

  it.each([
    ['rough', NEARBY.tooRough],
    ['limited', NEARBY.tooMany],
    ['unreachable', NEARBY.unreachable],
  ])('%s: says so in plain words', (state, words) => {
    render(<NearbySheet {...props({ state })} />);
    expect(screen.getByTestId('nearby-state').textContent).toContain(words);
  });

  it('empty: says so calmly, and offers to scan again', () => {
    const p = props();
    render(<NearbySheet {...p} />);
    expect(screen.getByTestId('nearby-empty').textContent).toContain(NEARBY.empty);
    fireEvent.click(screen.getByRole('button', { name: NEARBY.scanAgain }));
    expect(p.onScan).toHaveBeenCalled();
  });
});
