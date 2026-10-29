// @vitest-environment jsdom
//
// Phase 5, the small fixes: admin Remove asks first and acts once, Back with a confirmation open
// closes only the confirmation, the meeting point is sent once however fast the taps, the SOS
// icon is never red on red, and a WiFi scan that never answers no longer stops scanning.
import React, { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'framer-motion';
import AdminTools from '../src/components/admin/AdminTools.jsx';
import MemberOptions from '../src/components/group/MemberOptions.jsx';
import MeetingPointConfirm from '../src/components/MeetingPointConfirm.jsx';
import SosTrigger from '../src/components/SosTrigger.jsx';
import { pushBackHandler, runBackHandler } from '../src/utils/backHandlers.js';
import { REMOVE_PLACE } from '../src/copy/addPlace.js';
import { REMOVE_MEMBER, MEMBER_OPTIONS } from '../src/copy/group.js';
import { startWifiFusion, WIFI_SCAN_STUCK_MS } from '../src/utils/wifiFusion.js';

MotionGlobalConfig.skipAnimations = true;
afterEach(() => { cleanup(); vi.useRealTimers(); });

/** App's own Back ladder, underneath everything a component pushes. */
const appLadder = () => {
  const ladder = vi.fn(() => true);
  const remove = pushBackHandler(ladder);
  return { ladder, remove };
};

describe('17 + 15. admin Remove', () => {
  const PLACE = { id: 'cp-1', name: 'DENTAL GROUND' };
  const tools = (props) => render(
    <AdminTools open email="a@b" name="A" recording={false} points={0} onRecord={vi.fn()} onPublish={vi.fn()} onAbort={vi.fn()}
      onClose={vi.fn()} added={[PLACE]} {...props} />,
  );

  it('asks first, and a fast second tap on Remove removes once', () => {
    const onRemovePlace = vi.fn();
    tools({ onRemovePlace });
    fireEvent.click(screen.getByRole('button', { name: 'Remove DENTAL GROUND' }));
    expect(onRemovePlace).not.toHaveBeenCalled();
    const confirm = screen.getByTestId('remove-place-confirm');
    expect(confirm.textContent).toContain(REMOVE_PLACE.title('DENTAL GROUND'));
    const yes = screen.getByRole('button', { name: REMOVE_PLACE.confirm });
    fireEvent.click(yes);
    fireEvent.click(yes);
    expect(onRemovePlace).toHaveBeenCalledTimes(1);
    expect(onRemovePlace).toHaveBeenCalledWith(PLACE);
  });

  it('Cancel removes nothing', () => {
    const onRemovePlace = vi.fn();
    tools({ onRemovePlace });
    fireEvent.click(screen.getByRole('button', { name: 'Remove DENTAL GROUND' }));
    fireEvent.click(screen.getByRole('button', { name: REMOVE_PLACE.cancel }));
    expect(screen.queryByTestId('remove-place-confirm')).toBeNull();
    expect(onRemovePlace).not.toHaveBeenCalled();
  });

  it('while one removal is out, every Remove waits', () => {
    tools({ removingId: 'cp-1' });
    const button = screen.getByRole('button', { name: 'Remove DENTAL GROUND' });
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe(REMOVE_PLACE.removing);
  });

  it('Back closes the confirmation, and only it', () => {
    const { ladder, remove } = appLadder();
    const onClose = vi.fn();
    tools({ onClose });
    fireEvent.click(screen.getByRole('button', { name: 'Remove DENTAL GROUND' }));
    act(() => { runBackHandler(); });
    expect(screen.queryByTestId('remove-place-confirm')).toBeNull();
    expect(screen.getByTestId('admin-tools')).toBeTruthy();
    expect(ladder).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    // With nothing left open in it, Back is App's again.
    act(() => { runBackHandler(); });
    expect(ladder).toHaveBeenCalledTimes(1);
    remove();
  });
});

describe('15. Back with "Remove …?" open in a member\'s options', () => {
  it('closes the question, and only it', async () => {
    const { ladder, remove } = appLadder();
    const bravo = { id: 'b', uid: 'u-b', name: 'Bravo Rao', hasFix: true, status: 'ACTIVE', lat: 12.8272, lng: 80.0474 };
    const onRemove = vi.fn();
    // As in App: picking Remove closes the options sheet (member -> null).
    function Host() {
      const [member, setMember] = useState(bravo);
      return <MemberOptions member={member} me={null} heading={0} headingLive={false} isLead onClose={() => setMember(null)}
        onPing={vi.fn()} onShowOnMap={vi.fn()} onArScan={vi.fn()} onRemove={onRemove} />;
    }
    render(<Host />);
    fireEvent.click(screen.getByText(MEMBER_OPTIONS.remove));
    expect(screen.getByTestId('remove-confirm')).toBeTruthy();
    act(() => { runBackHandler(); });
    // The sheet slides away before it unmounts.
    await waitFor(() => expect(screen.queryByTestId('remove-confirm')).toBeNull());
    expect(ladder).not.toHaveBeenCalled();
    expect(onRemove).not.toHaveBeenCalled();
    remove();
  });

  it('the question still removes on its button', () => {
    const bravo = { id: 'b', uid: 'u-b', name: 'Bravo Rao', hasFix: true, status: 'ACTIVE', lat: 12.8272, lng: 80.0474 };
    const onRemove = vi.fn();
    function Host() {
      const [member, setMember] = useState(bravo);
      return <MemberOptions member={member} me={null} heading={0} headingLive={false} isLead onClose={() => setMember(null)}
        onPing={vi.fn()} onShowOnMap={vi.fn()} onArScan={vi.fn()} onRemove={onRemove} />;
    }
    render(<Host />);
    fireEvent.click(screen.getByText(MEMBER_OPTIONS.remove));
    fireEvent.click(screen.getByRole('button', { name: REMOVE_MEMBER.confirm }));
    expect(onRemove).toHaveBeenCalledWith('b');
  });
});

describe('17. the meeting point', () => {
  it('a fast second tap on Confirm sends it once; the next question can be answered', () => {
    const onConfirm = vi.fn();
    const { rerender } = render(<MeetingPointConfirm place={{ name: 'Java Green' }} onConfirm={onConfirm} onCancel={vi.fn()} />);
    const confirm = screen.getAllByRole('button').find((b) => /meeting point|confirm|set/i.test(b.textContent));
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    rerender(<MeetingPointConfirm place={null} onConfirm={onConfirm} onCancel={vi.fn()} />);
    rerender(<MeetingPointConfirm place={{ name: 'Tech Park' }} onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.click(screen.getAllByRole('button').find((b) => /meeting point|confirm|set/i.test(b.textContent)));
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });
});

describe('18. the SOS warning icon', () => {
  it('takes the button colour, so it shows on the red of a hold', () => {
    vi.useFakeTimers();
    render(<SosTrigger socket={{ emit: vi.fn() }} getLocation={() => ({ lat: 12.82, lng: 80.04 })} roomCode="K7M2QX" senderName="Meera" />);
    const button = screen.getByRole('button');
    fireEvent.pointerDown(button, { button: 0 });
    act(() => { vi.advanceTimersByTime(300); });
    expect(button.className).toMatch(/bg-danger text-white/);
    expect(screen.getByTestId('sos-icon').getAttribute('class')).not.toMatch(/text-danger/);
    fireEvent.pointerUp(button);
  });
});

describe('19. a WiFi scan that never answers', () => {
  it(`is given up after ${WIFI_SCAN_STUCK_MS / 1000} s, and the next cycle scans again`, async () => {
    vi.useFakeTimers();
    const scan = vi.fn(() => new Promise(() => {}));
    const outcomes = [];
    const fusion = startWifiFusion({ scan, isAvailable: () => true, intervalMs: 1e9, onCycle: (o) => outcomes.push(o) });
    const first = fusion.runCycle();
    await vi.advanceTimersByTimeAsync(WIFI_SCAN_STUCK_MS);
    await first;
    expect(outcomes.at(-1)).toBe('scan-error');
    expect(fusion.lastCycle()).toMatchObject({ outcome: 'scan-error', error: 'TIMEOUT' });
    fusion.runCycle();
    expect(scan.mock.calls.length).toBeGreaterThanOrEqual(2);
    fusion.stop();
  });
});
