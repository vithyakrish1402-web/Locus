// @vitest-environment jsdom
//
// "Too dark for labels" in the real ARCompass (redesign AR Scan batch, piece 9), with the
// owner's safeguards: small, infrequent sampling with leeway both ways; no camera frame kept
// or sent anywhere; if sampling fails nothing hides; only the labels hide; and a hand over
// the lens can't leave AR Scan stuck.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';

vi.mock('framer-motion', () => ({
  motion: { div: ({ children, className }) => <div className={className}>{children}</div> },
}));

const { default: ARCompass } = await import('../src/ARCompass.jsx');

const HERE = { lat: 12.8230, lng: 80.0440 };
const TARGET = { name: 'TECH PARK', lat: 12.8257, lng: 80.0440 };

// What the camera sees: a brightness (0-255) for every pixel of the next sample.
let brightness;
let ctx;
let canvasesMade;
let restore = [];
const stub = (obj, key, desc) => {
  const before = Object.getOwnPropertyDescriptor(obj, key);
  Object.defineProperty(obj, key, { configurable: true, ...desc });
  restore.push(() => (before ? Object.defineProperty(obj, key, before) : delete obj[key]));
};

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'],
  });
  brightness = 120;
  canvasesMade = 0;
  ctx = {
    drawImage: vi.fn(),
    getImageData: vi.fn((x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(brightness) })),
  };
  // A playing camera: a stream, and a video with a frame to draw.
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [] })) } });
  stub(HTMLMediaElement.prototype, 'readyState', { get: () => 4 });
  stub(HTMLVideoElement.prototype, 'videoWidth', { get: () => 1280 });
  const realCreate = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag, opts) => {
    const el = realCreate(tag, opts);
    if (String(tag).toLowerCase() === 'canvas') canvasesMade += 1;
    return el;
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL');
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob');
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  restore.reverse().forEach((undo) => undo());
  restore = [];
  delete navigator.mediaDevices;
});

const openAr = async (props = {}) => {
  const onClose = vi.fn();
  const view = render(<ARCompass target={TARGET} liveLocation={HERE} onClose={onClose} {...props} />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /^Start AR Scan$/ })));
  return { ...view, onClose };
};
const seconds = (n) => act(() => vi.advanceTimersByTime(n * 1000));
const labelsHidden = () => screen.getByTestId('ar-labels').className.includes('invisible');

describe('too dark for labels', () => {
  it('a hand over the lens hides the labels after 3 s, and only the labels', async () => {
    await openAr();
    brightness = 4;
    seconds(2);
    expect(labelsHidden()).toBe(false);
    seconds(1);
    expect(labelsHidden()).toBe(true);
    expect(screen.getByTestId('ar-too-dark').textContent).toContain('Too dark for labels');
    // Everything else stays: the arrow, the readout, the controls, the centre mark.
    for (const id of ['ar-arrow-ring', 'ar-readout', 'ar-target-pill', 'ar-centre-mark']) {
      for (let el = screen.getByTestId(id); el; el = el.parentElement) {
        expect(String(el.className)).not.toContain('invisible');
      }
    }
  });

  it('moving the hand away brings them back after 2 s', async () => {
    await openAr();
    brightness = 4;
    seconds(3);
    expect(labelsHidden()).toBe(true);
    brightness = 120;
    seconds(1);
    expect(labelsHidden()).toBe(true);
    seconds(1);
    expect(labelsHidden()).toBe(false);
    expect(screen.queryByTestId('ar-too-dark')).toBeNull();
  });

  it('leeway both ways: dim light between the thresholds changes nothing', async () => {
    await openAr();
    brightness = 32;
    seconds(10);
    expect(labelsHidden()).toBe(false);
    brightness = 4;
    seconds(3);
    brightness = 32;
    seconds(10);
    expect(labelsHidden()).toBe(true);
  });

  it('a covered lens never leaves AR Scan stuck: Close still works', async () => {
    const { onClose } = await openAr();
    brightness = 0;
    seconds(5);
    expect(labelsHidden()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Close AR Scan' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stops sampling when AR Scan closes', async () => {
    const { unmount } = await openAr();
    seconds(2);
    const calls = ctx.drawImage.mock.calls.length;
    unmount();
    seconds(5);
    expect(ctx.drawImage.mock.calls.length).toBe(calls);
  });
});

describe('the safeguards', () => {
  it('samples small and infrequently: one 16 x 12 read a second, on one reused canvas', async () => {
    await openAr();
    seconds(5);
    expect(ctx.getImageData).toHaveBeenCalledTimes(5);
    for (const call of ctx.getImageData.mock.calls) expect(call).toEqual([0, 0, 16, 12]);
    for (const call of ctx.drawImage.mock.calls) expect(call.slice(1)).toEqual([0, 0, 16, 12]);
    expect(canvasesMade).toBe(1);
  });

  it('keeps no frame and sends none: the canvas is never turned into an image or put on the page', async () => {
    globalThis.fetch = vi.fn();
    await openAr();
    brightness = 4;
    seconds(5);
    expect(HTMLCanvasElement.prototype.toDataURL).not.toHaveBeenCalled();
    expect(HTMLCanvasElement.prototype.toBlob).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(document.querySelectorAll('canvas')).toHaveLength(0);
    delete globalThis.fetch;
  });

  it('if sampling fails nothing hides: no canvas context', async () => {
    HTMLCanvasElement.prototype.getContext.mockImplementation(() => null);
    await openAr();
    brightness = 0;
    seconds(10);
    expect(labelsHidden()).toBe(false);
  });

  it('if sampling fails nothing hides: a read refused, even while dark', async () => {
    await openAr();
    brightness = 0;
    seconds(3);
    expect(labelsHidden()).toBe(true);
    ctx.getImageData.mockImplementation(() => { throw new DOMException('tainted', 'SecurityError'); });
    seconds(1);
    expect(labelsHidden()).toBe(false);
  });

  it('if sampling fails nothing hides: the video has no frame yet', async () => {
    stub(HTMLMediaElement.prototype, 'readyState', { get: () => 0 });
    await openAr();
    brightness = 0;
    seconds(10);
    expect(labelsHidden()).toBe(false);
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });

  it('nothing is sampled while the camera is off', async () => {
    navigator.mediaDevices.getUserMedia = vi.fn(async () => { throw new DOMException('denied', 'NotAllowedError'); });
    await openAr();
    seconds(5);
    expect(ctx.drawImage).not.toHaveBeenCalled();
    expect(labelsHidden()).toBe(false);
  });

  it('nothing is sampled while the app is in the background', async () => {
    stub(document, 'hidden', { get: () => true });
    await openAr();
    seconds(5);
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });
});
