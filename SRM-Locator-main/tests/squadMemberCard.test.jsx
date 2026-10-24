// @vitest-environment jsdom
//
// One member in the group panel (redesign Group panel batch, piece 3): where they are from
// here, in words, and their status; their actions are in their options sheet.
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import SquadMemberCard from '../src/components/SquadMemberCard.jsx';
import { memberStatus } from '../src/utils/memberStatus.js';

const me = { lat: 12.8249, lng: 80.0452 };
// ~350 m north-east of `me` (bearing ~43°).
const bravo = { id: 'b', name: 'Bravo Rao', hasFix: true, status: 'ACTIVE', lat: 12.8272, lng: 80.0474, battery: 77, speed: 3, lastSeen: Date.now() };

const renderRow = (props = {}) => {
  const onOptions = vi.fn();
  render(<SquadMemberCard member={bravo} me={me} heading={0} headingLive={false} onOptions={onOptions} {...props} />);
  return onOptions;
};

afterEach(cleanup);

describe('where a member is', () => {
  it('says how far, in plain words', () => {
    renderRow();
    expect(screen.getByTestId('member-where').textContent).toMatch(/^350 m/);
  });

  it('gives a compass direction when the phone has no compass reading (north-up)', () => {
    renderRow({ headingLive: false });
    expect(screen.getByText('to the north-east')).toBeTruthy();
  });

  it("says it like a clock face once the compass works, never in capitals", () => {
    const { unmount } = render(<SquadMemberCard member={bravo} me={me} heading={43} headingLive onOptions={vi.fn()} />);
    expect(screen.getByText('straight ahead')).toBeTruthy(); // facing them
    unmount();
    render(<SquadMemberCard member={bravo} me={me} heading={313} headingLive onOptions={vi.fn()} />);
    expect(screen.getByText('3 o’clock')).toBeTruthy(); // facing NW: they're to the right
    expect(screen.getByTestId('member-row').textContent).not.toMatch(/O'CLOCK|BEARING|AHEAD/);
  });

  it('says "With you" inside GPS accuracy, with no arrow pointing nowhere', () => {
    renderRow({ member: { ...bravo, lat: me.lat + 0.00005, lng: me.lng } }); // ~5 m
    expect(screen.getByTestId('member-where').textContent).toBe('With you');
  });
});

describe('their status', () => {
  const now = Date.now();
  it.each([
    ['heard from just now', { lastSeen: now - 3000 }, 'Live now', 'live'],
    ['paused', { status: 'FROZEN' }, 'Paused', 'paused'],
    ['quiet for 3 minutes', { lastSeen: now - 3 * 60000 }, 'Last update 3 min ago', 'stale'],
    ['quiet for 8 minutes (amber, never red)', { lastSeen: now - 8 * 60000 }, 'Last update 8 min ago', 'stale'],
    ['with no fix yet', { hasFix: false, lat: null, lng: null }, 'Waiting for location', 'none'],
  ])('%s', (_label, extra, text, dot) => {
    expect(memberStatus({ ...bravo, ...extra }, now)).toEqual({ text, dot });
  });

  it('with no fix: says so, and shows no distance or arrow to aim at nowhere', () => {
    renderRow({ member: { ...bravo, hasFix: false, lat: null, lng: null } });
    expect(screen.getByTestId('member-status').textContent).toBe('Waiting for location');
    expect(screen.queryByTestId('member-where')).toBeNull();
  });
});

describe('actions', () => {
  it('one ⋮ button opens their options; no buttons on the row itself', () => {
    const onOptions = renderRow();
    const row = screen.getByTestId('member-row');
    const buttons = row.querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Options for Bravo Rao' }));
    expect(onOptions).toHaveBeenCalledWith(bravo);
  });

  it('never red, never the old tactical words', () => {
    renderRow();
    const row = screen.getByTestId('member-row');
    expect(row.outerHTML).not.toMatch(/red-|danger|font-dot/);
    expect(row.textContent).not.toMatch(/PING|TRACK|AWAITING|KM\/H|LIVE/);
  });
});

describe('low battery', () => {
  it.each([
    [19, true],
    [24, true],
    [25, false],
    [80, false],
    [0, false], // no reading
    [undefined, false],
  ])('%s%% → a warning: %s', (battery, warned) => {
    renderRow({ member: { ...bravo, battery } });
    const icon = screen.queryByTestId('member-low-battery');
    expect(Boolean(icon)).toBe(warned);
    if (warned) {
      expect(icon.getAttribute('aria-label')).toBe(`Low battery, ${battery}%`);
      expect(icon.getAttribute('class')).toMatch(/text-warning/);
      expect(icon.getAttribute('class')).not.toMatch(/red|danger/);
    }
  });
});

describe('the role and Trusted friend tags', () => {
  it('sit together in one row above the name, the same size, each on one line', () => {
    renderRow({ member: { ...bravo, role: 'moderator' }, isFriend: true });
    const role = screen.getByTestId('member-role');
    const friend = screen.getByTestId('member-friend');
    expect(role.parentElement).toBe(friend.parentElement);
    expect(role.parentElement.className).toMatch(/\bflex\b.*\bflex-wrap\b.*\bgap-1\b/);
    // The tags come before the name, never inside it.
    expect(role.parentElement.nextElementSibling.tagName).toBe('H4');
    const size = (el) => el.className.match(/text-\[\d+px\]|leading-\d|px-\d|py-[\d.]+|rounded-full|whitespace-nowrap/g).join(' ');
    expect(size(friend)).toBe(size(role));
    expect(friend.className).toMatch(/whitespace-nowrap/);
  });

  it('use the theme\'s soft success colours for Trusted friend', () => {
    renderRow({ isFriend: true });
    expect(screen.getByTestId('member-friend').className).toMatch(/\bbg-success-soft\b.*\btext-success\b/);
  });

  it('leave no empty row for a plain member', () => {
    renderRow();
    expect(screen.queryByTestId('member-role')).toBeNull();
    expect(screen.queryByTestId('member-friend')).toBeNull();
    expect(screen.getByRole('heading', { name: /Bravo Rao/ }).previousElementSibling).toBeNull();
  });
});
