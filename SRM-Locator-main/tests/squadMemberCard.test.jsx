// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import SquadMemberCard from '../src/components/SquadMemberCard.jsx';

const me = { lat: 12.8249, lng: 80.0452 };
// ~350 m north-east of `me` (bearing ~43°).
const bravo = { id: 'b', name: 'Bravo', role: 'Campus Node', hasFix: true, lat: 12.8272, lng: 80.0474, battery: 77, speed: 3, lastSeen: Date.now() };

const renderCard = (props = {}) => {
  const handlers = { onPing: vi.fn(), onBlock: vi.fn(), onAR: vi.fn(), onTrack: vi.fn() };
  render(<SquadMemberCard member={bravo} me={me} heading={0} headingLive={false} isOwner={false} {...handlers} {...props} />);
  return handlers;
};

afterEach(cleanup);

describe('where a squadmate is', () => {
  it('shows the distance at a glance', () => {
    renderCard();
    expect(screen.getByText('350')).toBeTruthy();
    expect(screen.getByText('M')).toBeTruthy();
  });

  it('gives a compass point when the phone has no compass reading (north-up)', () => {
    renderCard({ headingLive: false });
    expect(screen.getByText('BEARING NE')).toBeTruthy();
  });

  it('says it like a clock face once the compass works', () => {
    const { unmount } = render(<SquadMemberCard member={bravo} me={me} heading={43} headingLive isOwner={false} onPing={vi.fn()} onBlock={vi.fn()} onAR={vi.fn()} onTrack={vi.fn()} />);
    expect(screen.getByText('AHEAD')).toBeTruthy(); // facing them
    unmount();
    render(<SquadMemberCard member={bravo} me={me} heading={313} headingLive isOwner={false} onPing={vi.fn()} onBlock={vi.fn()} onAR={vi.fn()} onTrack={vi.fn()} />);
    expect(screen.getByText("3 O'CLOCK")).toBeTruthy(); // facing NW: they're to the right
  });

  it('says WITH YOU inside GPS accuracy instead of a meaningless direction', () => {
    renderCard({ member: { ...bravo, lat: me.lat + 0.00005, lng: me.lng } }); // ~5 m
    expect(screen.getByText('WITH YOU')).toBeTruthy();
    expect(screen.getByText('<15')).toBeTruthy();
  });

  it('marks a member heard from just now as LIVE', () => {
    renderCard();
    expect(screen.getByText(/LIVE/)).toBeTruthy();
  });
});

describe('a member with no fix', () => {
  it('says so, and offers nothing that would aim at nowhere', () => {
    renderCard({ member: { ...bravo, hasFix: false, lat: null, lng: null, lastSeen: null } });
    expect(screen.getByText('AWAITING_GPS_FIX')).toBeTruthy();
    expect(screen.getByText(/NO SIGNAL YET/)).toBeTruthy();
    expect(screen.queryByText('TRACK_TARGET')).toBeNull();
    expect(screen.queryByTitle('AR Tracking')).toBeNull();
    expect(screen.getByRole('button', { name: 'PING' })).toBeTruthy();
  });
});

describe('actions', () => {
  it('offers PING once, and wires every action to its member', () => {
    const h = renderCard({ isOwner: true });
    expect(screen.getAllByRole('button', { name: 'PING' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'PING' }));
    fireEvent.click(screen.getByTitle('AR Tracking'));
    fireEvent.click(screen.getByRole('button', { name: 'TRACK_TARGET' }));
    fireEvent.click(screen.getByTitle('Instant Ban'));
    expect(h.onPing).toHaveBeenCalledWith('b');
    expect(h.onAR).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }));
    expect(h.onTrack).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }));
    expect(h.onBlock).toHaveBeenCalledWith('b');
  });

  it('shows the ban control to the Commander only', () => {
    renderCard({ isOwner: false });
    expect(screen.queryByTitle('Instant Ban')).toBeNull();
  });
});
