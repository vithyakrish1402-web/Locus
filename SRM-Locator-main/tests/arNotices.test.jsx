// @vitest-environment jsdom
//
// AR Scan's notices (redesign AR Scan batch, piece 9): calibration and camera off, on plates
// under the top controls, in amber and plain words. Camera off gives the steps to allow it in
// words (a link straight to the phone's settings is on the Later list).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent, within } from '@testing-library/react';

vi.mock('framer-motion', () => ({
  motion: { div: ({ children, className }) => <div className={className}>{children}</div> },
}));

const { default: ARCompass } = await import('../src/ARCompass.jsx');
const { notify } = await import('../src/utils/notify.js');

const HERE = { lat: 12.8230, lng: 80.0440 };
const TARGET = { name: 'TECH PARK', lat: 12.8257, lng: 80.0440 };

afterEach(() => {
  cleanup();
  delete navigator.mediaDevices;
});

const withCamera = (getUserMedia) => {
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
};
const openAr = async () => {
  render(<ARCompass target={TARGET} liveLocation={HERE} onClose={() => {}} />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /^Start AR Scan$/ })));
};

describe('the calibration notice', () => {
  it('keeps its space while hidden, so nothing jumps when it shows', async () => {
    withCamera(vi.fn(async () => ({ getTracks: () => [] })));
    await openAr();
    const notice = screen.getByTestId('ar-calibration-banner');
    expect(notice.dataset.visible).toBe('false');
    expect(notice.className).toContain('opacity-0');
    expect(notice.textContent).toContain('Move your phone in a figure 8');
  });

  it('is amber on a plate, never red', async () => {
    withCamera(vi.fn(async () => ({ getTracks: () => [] })));
    await openAr();
    const notice = screen.getByTestId('ar-calibration-banner');
    expect(notice.className).toContain('ar-plate');
    expect(notice.querySelector('svg').getAttribute('class')).toContain('text-warning');
    expect(notice.outerHTML).not.toMatch(/red-|yellow-|font-dot|CALIBRATE/);
  });
});

describe('compass refused', () => {
  it('AR Scan stays on its start screen, and the notice says how to go on (in amber)', async () => {
    const warning = vi.spyOn(notify, 'warning').mockImplementation(() => {});
    DeviceOrientationEvent.requestPermission = async () => 'denied';
    try {
      await openAr();
      expect(screen.getByTestId('ar-start')).toBeTruthy();
      expect(screen.queryByTestId('ar-ui')).toBeNull();
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('tap Start AR Scan again'));
      expect(warning.mock.calls[0][0]).not.toMatch(/arrow can.t turn/);
    } finally {
      delete DeviceOrientationEvent.requestPermission;
      warning.mockRestore();
    }
  });
});

describe('camera off', () => {
  it('no notice while the camera works', async () => {
    withCamera(vi.fn(async () => ({ getTracks: () => [] })));
    await openAr();
    expect(screen.queryByTestId('ar-camera-off')).toBeNull();
  });

  it('refused: says so, gives the steps in words, and AR Scan carries on', async () => {
    withCamera(vi.fn(async () => { throw new DOMException('denied', 'NotAllowedError'); }));
    await openAr();
    const notice = screen.getByTestId('ar-camera-off');
    expect(within(notice).getByText('Camera is off')).toBeTruthy();
    const steps = within(notice).getAllByRole('listitem').map((li) => li.textContent);
    expect(steps).toEqual([
      'Open your phone’s Settings.',
      'Tap Apps, then LOCUS, then Permissions.',
      'Tap Camera and choose Allow.',
      'Close AR Scan and open it again.',
    ]);
    // Words only: no link, nothing to tap.
    expect(notice.querySelector('a, button')).toBeNull();
    expect(notice.querySelector('svg').getAttribute('class')).toContain('text-warning');
    expect(notice.outerHTML).not.toMatch(/red-|IFR|OPTICS/i);
    // The arrow, readout and controls carry on.
    expect(screen.getByTestId('ar-arrow-ring')).toBeTruthy();
    expect(screen.getByTestId('ar-readout-distance')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close AR Scan' })).toBeTruthy();
  });

  it('no camera at all (no mediaDevices): the same notice', async () => {
    await openAr();
    expect(screen.getByTestId('ar-camera-off')).toBeTruthy();
  });

  it('the old tactical backdrop is gone', async () => {
    await openAr();
    expect(screen.getByTestId('ar-scan').outerHTML).not.toMatch(/linear-gradient|border-white\/5|border-white\/10/);
  });
});
