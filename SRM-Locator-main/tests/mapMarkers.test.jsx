// @vitest-environment jsdom
//
// The map's markers (redesign Map batch, piece 5): every status a member can have stays
// distinguishable, names show as sent, and nothing is red.
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import MemberMarker from '../src/components/MemberMarker.jsx';
import GhostMemberMarker from '../src/GhostMemberMarker.jsx';
import BuildingMarker from '../src/components/BuildingMarker.jsx';
import WaypointMarker from '../src/components/WaypointMarker.jsx';
import LiveLocationMarker from '../src/LiveLocationMarker.jsx';
import { MARKERS } from '../src/copy/map.js';

afterEach(cleanup);

const noRed = (el) => expect(el.outerHTML).not.toMatch(/red-|#EF4444|#ef4444|danger|animate-ping/);

describe('a member', () => {
  it('shows their initials and a plate with their name, as sent, and how far', () => {
    render(<MemberMarker name="Meera Iyer" distance="120 m" />);
    const marker = screen.getByTestId('member-marker');
    expect(marker.textContent).toContain('MI');
    expect(screen.getByText('Meera Iyer · 120 m')).toBeTruthy();
    noRed(marker);
  });

  it('live: a solid accent ring', () => {
    render(<MemberMarker name="Meera" />);
    expect(screen.getByTestId('member-marker').innerHTML).toMatch(/border-accent/);
    expect(screen.getByTestId('member-marker').innerHTML).not.toMatch(/border-dashed/);
  });

  it('paused: a dashed grey ring and "paused" on the plate, never the distance', () => {
    render(<MemberMarker name="Rohan" paused distance="520 m" />);
    const marker = screen.getByTestId('member-marker');
    expect(marker.dataset.paused).toBe('true');
    expect(marker.innerHTML).toMatch(/border-dashed/);
    expect(screen.getByText(MARKERS.memberPaused('Rohan'))).toBeTruthy();
  });

  it('moving: an arrow points the way they head', () => {
    const { container } = render(<MemberMarker name="Aarav" isNavigating heading={90} />);
    expect(container.querySelector('[style*="rotate(90deg)"] path')).toBeTruthy();
  });

  it('standing still: no arrow', () => {
    const { container } = render(<MemberMarker name="Aarav" heading={90} />);
    expect(container.querySelector('path')).toBeNull();
  });

  it('with no name, still says who', () => {
    render(<MemberMarker name={null} />);
    expect(screen.getByText(MARKERS.someone)).toBeTruthy();
  });
});

describe('a member whose connection was lost', () => {
  it('says so, with how long, dashed and faded', () => {
    render(<GhostMemberMarker name="Aarav" phase="projecting" elapsedLabel="0:42" />);
    expect(screen.getByText('Aarav · lost connection 0:42 ago')).toBeTruthy();
    expect(screen.getByTestId('ghost-marker').innerHTML).toMatch(/border-dashed/);
    noRed(screen.getByTestId('ghost-marker'));
  });

  it('once the projection has run out, says when they were last seen', () => {
    render(<GhostMemberMarker name="Aarav" phase="expired" elapsedLabel="6:00" />);
    expect(screen.getByText('Aarav · last seen 6:00 ago')).toBeTruthy();
  });

  it('never in the old capitals', () => {
    render(<GhostMemberMarker name="Aarav" />);
    expect(screen.getByTestId('ghost-marker').textContent).not.toMatch(/SIGNAL LOST|LAST KNOWN/);
  });
});

describe('a building', () => {
  it('is a quiet dot, and the chosen one an accent dot, with no pulse', () => {
    render(<><BuildingMarker /><BuildingMarker highlighted /></>);
    const [plain, chosen] = screen.getAllByTestId('building-marker');
    expect(plain.innerHTML).toMatch(/color-map-building/);
    expect(chosen.innerHTML).toMatch(/bg-accent/);
    noRed(plain);
    noRed(chosen);
  });
});

describe('the meeting point', () => {
  it('reads "Meeting point" for one placed on the map (its data name stays RALLY POINT)', () => {
    render(<WaypointMarker name="RALLY POINT" onTrack={() => {}} />);
    expect(screen.getByText('Meeting point')).toBeTruthy();
  });

  it('names the building it is set on', () => {
    render(<WaypointMarker name="TECH PARK" />);
    expect(screen.getByText('Meeting point · TECH PARK')).toBeTruthy();
  });

  it('has Find with AR Scan for everyone, and Remove only for who may remove it', () => {
    const { rerender } = render(<WaypointMarker name="X" onTrack={() => {}} canClear={false} />);
    expect(screen.getByRole('button', { name: MARKERS.findWithAr })).toBeTruthy();
    expect(screen.queryByRole('button', { name: MARKERS.removeMeetingPoint })).toBeNull();
    rerender(<WaypointMarker name="X" onTrack={() => {}} canClear onClear={() => {}} />);
    expect(screen.getByRole('button', { name: MARKERS.removeMeetingPoint })).toBeTruthy();
    noRed(screen.getByTestId('meeting-point-marker'));
  });
});

describe('you', () => {
  it('are the accent, never red or green', () => {
    const { container } = render(<LiveLocationMarker zoom={17} />);
    expect(container.innerHTML).toMatch(/--color-map-self/);
    expect(container.innerHTML).not.toMatch(/#10B981|#EF4444/i);
  });
});
