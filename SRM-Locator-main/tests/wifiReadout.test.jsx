// @vitest-environment jsdom
//
// The owner's WiFi field-test readout: every outcome of a scan cycle, in words.
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import WifiReadout from '../src/components/WifiReadout.jsx';

afterEach(cleanup);

const text = () => screen.getByTestId('wifi-readout').textContent;
const estimate = (confidence, extra = {}) => ({
  outcome: 'estimate', at: Date.now(), apsInScan: 9, threshold: 0.6, usedWifi: confidence >= 0.6,
  estimate: { building: 'TECH PARK', floor: 2, confidence, matchedApCount: 4, totalApsSeen: 11, ...extra },
});

describe('WifiReadout', () => {
  it('says scanning is paused outside a squad', () => {
    render(<WifiReadout lastCycle={null} active={false} />);
    expect(text()).toMatch(/JOIN A SQUAD TO SCAN/);
  });

  it('shows a trusted estimate as used', () => {
    render(<WifiReadout lastCycle={estimate(0.72)} active />);
    expect(text()).toMatch(/9 APS THIS SCAN/);
    expect(text()).toMatch(/4 OF 11/);
    expect(text()).toMatch(/TECH PARK F2/);
    expect(text()).toMatch(/0\.72 >= 0\.60/);
    expect(text()).toMatch(/USINGWIFI/);
  });

  it('shows a weak estimate with its numbers, and that GPS is used', () => {
    render(<WifiReadout lastCycle={estimate(0.45)} active />);
    expect(text()).toMatch(/0\.45 < 0\.60/);
    expect(text()).toMatch(/USINGGPS/);
  });

  it('shows floor 0 as G, and no vote when nothing matched', () => {
    const { unmount } = render(<WifiReadout lastCycle={estimate(0.8, { floor: 0 })} active />);
    expect(text()).toMatch(/TECH PARK G/);
    unmount();
    render(<WifiReadout lastCycle={estimate(0, { matchedApCount: 0, building: null, floor: null })} active />);
    expect(text()).toMatch(/0 OF 11/);
    expect(text()).not.toMatch(/VOTE/);
  });

  it('puts failures in words, with the error code', () => {
    render(<WifiReadout lastCycle={{ outcome: 'scan-error', error: 'LOCATION_OFF', at: Date.now(), usedWifi: false, threshold: 0.6 }} active />);
    expect(text()).toMatch(/SCAN FAILED: LOCATION_OFF/);
    expect(text()).toMatch(/USINGGPS/);
  });

  it('says so when the app has no scanner', () => {
    render(<WifiReadout lastCycle={{ outcome: 'unavailable', at: Date.now(), usedWifi: false, threshold: 0.6 }} active />);
    expect(text()).toMatch(/SCANNER UNAVAILABLE/);
  });
});
