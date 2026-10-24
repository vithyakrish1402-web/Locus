// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readTopCoverPx, AR_TAG_TOP_SAFE_MARGIN_PX, AR_TAG_GAP_BELOW_STATUS_BAR_PX } from '../src/utils/topInset.js';

afterEach(() => vi.restoreAllMocks());

// jsdom resolves no CSS variables: stand in for the browser by answering the probe's height.
const statusBarIs = (px) => vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
  return { height: this.style.cssText.includes('--top-cover-height') ? px : 0, width: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON() {} };
});

describe('the status bar strip', () => {
  it('is 0 when there is no status bar (a browser, a test)', () => {
    expect(readTopCoverPx()).toBe(0);
    expect(AR_TAG_TOP_SAFE_MARGIN_PX()).toBe(AR_TAG_GAP_BELOW_STATUS_BAR_PX);
  });

  it('is read at the moment of asking, and leaves nothing behind in the page', () => {
    statusBarIs(30);
    expect(readTopCoverPx()).toBe(30);
    expect(document.body.children.length).toBe(0);
    statusBarIs(24); // rotated: a different inset
    expect(readTopCoverPx()).toBe(24);
  });

  it('AR_TAG_TOP_SAFE_MARGIN_PX is the status bar plus an 8 px gap', () => {
    expect(AR_TAG_GAP_BELOW_STATUS_BAR_PX).toBe(8);
    statusBarIs(30);
    expect(AR_TAG_TOP_SAFE_MARGIN_PX()).toBe(38);
  });
});
