// @vitest-environment jsdom
//
// AR Scan's floating tags, rendered by the real ARCompass: every squad member and
// building in view gets one, the one destination (arTarget) gets a red one, and nothing
// behind the phone or belonging to this user is tagged.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';

vi.mock('framer-motion', () => ({
  motion: { div: ({ children, className }) => <div className={className}>{children}</div> },
}));

const { default: ARCompass } = await import('../src/ARCompass.jsx');

afterEach(cleanup);

const HERE = { lat: 12.8230, lng: 80.0440 };
const at = (bearing, meters) => {
  const r = (bearing * Math.PI) / 180;
  return {
    lat: HERE.lat + (meters * Math.cos(r)) / 111320,
    lng: HERE.lng + (meters * Math.sin(r)) / (111320 * Math.cos((HERE.lat * Math.PI) / 180)),
  };
};

const faceNorth = () => {
  const event = new Event('deviceorientationabsolute');
  Object.assign(event, { absolute: true, alpha: 0 }); // heading 360 - 0 = north
  window.dispatchEvent(event);
};

const tagsOnScreen = () =>
  screen.queryAllByTestId('ar-tag').map((el) => ({ text: el.textContent, variant: el.dataset.variant, left: parseFloat(el.style.left) }));

const openAr = async (props) => {
  render(<ARCompass liveLocation={HERE} onClose={() => {}} {...props} />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /GRANT_ACCESS/ })));
  act(() => faceNorth());
};

describe('ARCompass floating tags', () => {
  it('tags what is in front, in red for the destination, and nothing behind or of yourself', async () => {
    const ahead = { id: 'a', uid: 'u-a', name: 'ALPHA', hasFix: true, ...at(10, 120) };
    await openAr({
      target: { name: 'SRM_HQ', ...at(-5, 300) },
      selfUid: 'u-me',
      squadMembers: [
        ahead,
        { id: 'b', uid: 'u-b', name: 'BEHIND', hasFix: true, ...at(180, 50) },
        { id: 'c', uid: 'u-c', name: 'NOFIX', hasFix: false, lat: null, lng: null },
        { id: 'me', uid: 'u-me', name: 'ME', hasFix: true, ...at(0, 40) },
      ],
      buildings: [{ id: 1, name: 'TECH PARK', ...at(-20, 200) }, { id: 2, name: 'FAR BLOCK', ...at(0, 900) }],
    });

    const tags = tagsOnScreen();
    expect(tags.map((t) => t.text).sort()).toEqual(['ALPHA120 M', 'SRM_HQ300 M', 'TECH PARK200 M']);
    expect(tags.find((t) => t.text.startsWith('SRM_HQ')).variant).toBe('target');
    expect(tags.find((t) => t.text.startsWith('ALPHA')).variant).toBe('member');
    expect(tags.find((t) => t.text.startsWith('TECH PARK')).variant).toBe('building');
    // Left of centre for a bearing west of north, right of it for east.
    expect(tags.find((t) => t.text.startsWith('TECH PARK')).left).toBeLessThan(50);
    expect(tags.find((t) => t.text.startsWith('ALPHA')).left).toBeGreaterThan(50);
    // Where tags overlap the nearer one wins, so the ambient ones are drawn furthest first.
    expect(tags.filter((t) => t.variant !== 'target').map((t) => t.text)).toEqual(['TECH PARK200 M', 'ALPHA120 M']);
  });

  it('still shows the destination arrow and distance as before', async () => {
    await openAr({ target: { name: 'SRM_HQ', ...at(0, 300) } });
    expect(screen.getByText('TARGET_LOCK')).toBeTruthy();
    expect(screen.getByText('SRM_HQ', { selector: 'h2' })).toBeTruthy();
    expect(screen.getByText('300M')).toBeTruthy();
  });
});
