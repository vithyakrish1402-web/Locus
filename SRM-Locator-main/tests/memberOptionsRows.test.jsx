// @vitest-environment jsdom
//
// The member options sheet (components/group/MemberOptions.jsx): every action row has a title
// and a line under it, so the rows are the same height (the friend and moderator rows used to
// have no second line and sat shorter than the rest).
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MotionGlobalConfig } from 'framer-motion';
import MemberOptions from '../src/components/group/MemberOptions.jsx';

MotionGlobalConfig.skipAnimations = true;
afterEach(cleanup);

const me = { lat: 12.8249, lng: 80.0452 };
const bravo = { id: 'b', uid: 'u-b', name: 'Bravo Rao', hasFix: true, status: 'ACTIVE', lat: 12.8272, lng: 80.0474, battery: 77, speed: 0, lastSeen: Date.now() };

const open = (friendStatus, moderatorIs) => render(
  <MemberOptions
    member={bravo} me={me} heading={0} headingLive={false} isLead
    onClose={vi.fn()} onNavigate={vi.fn()} onPing={vi.fn()} onShowOnMap={vi.fn()} onArScan={vi.fn()}
    onRemove={vi.fn()} onRemoveAndBlock={vi.fn()}
    moderator={{ is: moderatorIs, onChange: vi.fn() }}
    friend={{ status: friendStatus, onAdd: vi.fn(), onAccept: vi.fn(), onRemove: vi.fn() }}
  />,
);

// The action rows: the buttons inside the list, not Cancel.
const rows = () => [...screen.getByTestId('member-options').querySelectorAll('.divide-y > button')];

describe.each([
  ['none', false], ['sent', false], ['asked', true], ['friends', true],
])('with friend status %s', (friendStatus, moderatorIs) => {
  it('every action row has a title and a line under it', () => {
    open(friendStatus, moderatorIs);
    const found = rows();
    expect(found.length).toBeGreaterThanOrEqual(8);
    for (const row of found) {
      const lines = row.querySelectorAll('span.block');
      expect(lines, row.textContent).toHaveLength(2);
      expect(lines[1].textContent.trim().length, row.textContent).toBeGreaterThan(0);
    }
  });
});

it('the pending request row says what it is waiting for', () => {
  open('sent', false);
  expect(screen.getByText('Waiting for them to accept')).toBeTruthy();
});
