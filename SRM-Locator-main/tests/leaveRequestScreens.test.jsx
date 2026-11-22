// @vitest-environment jsdom
//
// The request-to-leave screens (Stage 5): the member's waiting card, the Leave button and sheet,
// and the Group Lead's list inside the join requests sheet, with the Lead tools tile counting both.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'framer-motion';
import { LeaveRequestWaiting, LeaveRequestList } from '../src/components/group/LeaveRequestStatus.jsx';
import { LeaveGroupButton, LeaveGroupConfirm } from '../src/components/group/LeaveGroup.jsx';
import JoinRequests from '../src/components/group/JoinRequests.jsx';
import LeadTools from '../src/components/group/LeadTools.jsx';
import { LEAVE_REQUEST, LEAVE_REQUESTS } from '../src/copy/group.js';
import { clockLabel } from '../src/utils/timedPrivacy.js';

MotionGlobalConfig.skipAnimations = true;

const MIN = 60_000;
const SKEW = MIN; // the server is a minute ahead of the phone

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date(2026, 10, 22, 13, 0, 0));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the member's waiting card", () => {
  it("counts down to automatic approval by the server's clock, in the phone's own time of day", () => {
    const deadline = Date.now() + SKEW + 12 * MIN;
    render(<LeaveRequestWaiting deadline={deadline} offset={SKEW} onCancel={vi.fn()} />);
    expect(screen.getByText(LEAVE_REQUEST.waitingTitle)).toBeTruthy();
    expect(screen.getByTestId('leave-request-countdown').textContent).toBe(LEAVE_REQUEST.waitingBody('12:00', clockLabel(deadline, SKEW)));
    act(() => { vi.advanceTimersByTime(61_000); });
    expect(screen.getByTestId('leave-request-countdown').textContent).toBe(LEAVE_REQUEST.waitingBody('10:59', clockLabel(deadline, SKEW)));
  });

  it('can be cancelled', () => {
    const onCancel = vi.fn();
    render(<LeaveRequestWaiting deadline={Date.now() + MIN} offset={0} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: LEAVE_REQUEST.cancel }));
    expect(onCancel).toHaveBeenCalled();
  });
});

describe('the Leave button and sheet', () => {
  it('say "Request to leave" only where the Group needs it', () => {
    const { rerender } = render(<LeaveGroupButton onClick={vi.fn()} />);
    expect(screen.getByTestId('leave-group').textContent).toBe('Leave group');
    rerender(<LeaveGroupButton onClick={vi.fn()} request />);
    expect(screen.getByTestId('leave-group').textContent).toBe(LEAVE_REQUEST.button);
  });

  it('the sheet explains a request before sending one', () => {
    const onLeave = vi.fn();
    render(<LeaveGroupConfirm open code="NB1" isLead={false} alone={false} onLeave={onLeave} onCancel={vi.fn()} request />);
    expect(screen.getByText(LEAVE_REQUEST.confirmBody)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: LEAVE_REQUEST.confirm }));
    expect(onLeave).toHaveBeenCalled();
  });
});

describe("the Group Lead's list", () => {
  const request = (uid, extra = {}) => ({ uid, name: uid, requestedAt: 0, deadline: Date.now() + SKEW + 14 * MIN, fromModerator: false, fromCommander: false, ...extra });

  it('shows each with the time left, and Approve and Reject', () => {
    const onAnswer = vi.fn();
    const ann = request('Ann');
    render(<LeaveRequestList requests={[ann]} offset={SKEW} onAnswer={onAnswer} />);
    expect(screen.getByTestId('leave-request-left').textContent).toBe(LEAVE_REQUESTS.autoIn('14:00', clockLabel(ann.deadline, SKEW)));
    fireEvent.click(screen.getByRole('button', { name: LEAVE_REQUESTS.approveFor('Ann') }));
    expect(onAnswer).toHaveBeenCalledWith(ann, true);
    fireEvent.click(screen.getByRole('button', { name: LEAVE_REQUESTS.rejectFor('Ann') }));
    expect(onAnswer).toHaveBeenCalledWith(ann, false);
  });

  it("the Commander's own request has no Reject, and says why", () => {
    render(<LeaveRequestList requests={[request('Cmdr', { fromCommander: true })]} offset={0} onAnswer={vi.fn()} />);
    expect(screen.queryByRole('button', { name: LEAVE_REQUESTS.rejectFor('Cmdr') })).toBeNull();
    expect(screen.getByRole('button', { name: LEAVE_REQUESTS.approveFor('Cmdr') })).toBeTruthy();
    expect(screen.getByTestId('leave-rule-commander').textContent).toBe(LEAVE_REQUESTS.commanderRule);
  });

  it("a moderator's request says only the Group Lead can answer it", () => {
    render(<LeaveRequestList requests={[request('Mod', { fromModerator: true })]} offset={0} onAnswer={vi.fn()} />);
    expect(screen.getByTestId('leave-rule-moderator').textContent).toBe(LEAVE_REQUESTS.moderatorRule);
    expect(screen.getByRole('button', { name: LEAVE_REQUESTS.rejectFor('Mod') })).toBeTruthy();
  });

  it('rides in the join requests sheet, first, and the sheet says Requests', () => {
    render(<JoinRequests open onClose={vi.fn()} requests={[{ targetId: 's1', name: 'Joiner' }]} code="NB1" onAnswer={vi.fn()} leave={{ requests: [request('Ann')], offset: 0, onAnswer: vi.fn() }} />);
    const sheet = screen.getByTestId('join-requests');
    expect(within(sheet).getByText(LEAVE_REQUESTS.leaveSection)).toBeTruthy();
    expect(within(sheet).getByText(LEAVE_REQUESTS.joinSection)).toBeTruthy();
    expect(screen.getAllByText(LEAVE_REQUESTS.tile).length).toBeGreaterThan(0);
    expect(within(sheet).getAllByTestId('join-request')).toHaveLength(1);
  });

  it('without requests to leave, the sheet is as before', () => {
    render(<JoinRequests open onClose={vi.fn()} requests={[]} code="NB1" onAnswer={vi.fn()} />);
    expect(screen.queryByTestId('leave-requests')).toBeNull();
    expect(screen.getAllByText('Join requests').length).toBeGreaterThan(0);
  });

  it('the Lead tools tile counts both, and says Requests when someone is asking to leave', () => {
    const props = { requests: 1, onRequests: vi.fn(), refresh: { status: 'idle', message: null }, onRefresh: vi.fn(), choosing: false, onMeetingPoint: vi.fn(), hasMeetingPoint: false, onRemoveMeetingPoint: vi.fn() };
    const { rerender } = render(<LeadTools {...props} />);
    expect(screen.getByText('Join requests')).toBeTruthy();
    rerender(<LeadTools {...props} leaveRequests={2} />);
    expect(screen.getByText(LEAVE_REQUESTS.tile)).toBeTruthy();
    expect(screen.getByLabelText('3 waiting')).toBeTruthy();
  });
});
