import { describe, it, expect } from 'vitest';
import { toTelemetryRecord } from '../backend/telemetry.js';

// One member's location cache entry, as the heartbeat and GPS reports write it.
const HEARTBEAT = { latitude: 12.9, longitude: 80.1, timestamp: '2026-09-22T10:00:00.000Z', batteryLevel: '41%' };
const GPS = { lat: 12.8235, lng: 80.0446, speed: 3, heading: 90, battery: 90, lastSeen: Date.parse('2026-09-22T10:00:05.000Z') };

describe("a member's telemetry record", () => {
  it('is nothing for a member with no entry', () => {
    expect(toTelemetryRecord(undefined)).toBeNull();
    expect(toTelemetryRecord(null)).toBeNull();
  });

  it('is the heartbeat, as the matrix has always read it', () => {
    expect(toTelemetryRecord(HEARTBEAT)).toEqual(HEARTBEAT);
  });

  it('is built from a GPS report when there has been no heartbeat yet', () => {
    expect(toTelemetryRecord(GPS)).toEqual({
      latitude: 12.8235,
      longitude: 80.0446,
      timestamp: '2026-09-22T10:00:05.000Z',
      batteryLevel: '90%',
    });
  });

  it('prefers the heartbeat when there are both', () => {
    expect(toTelemetryRecord({ ...GPS, ...HEARTBEAT })).toEqual(HEARTBEAT);
  });

  it('falls back field by field where the heartbeat left a gap', () => {
    const { batteryLevel: _b, timestamp: _t, ...coordsOnly } = HEARTBEAT;
    expect(toTelemetryRecord({ ...GPS, ...coordsOnly })).toEqual({
      latitude: 12.9, longitude: 80.1, timestamp: '2026-09-22T10:00:05.000Z', batteryLevel: '90%',
    });
    expect(toTelemetryRecord({ ...GPS, battery: 0 }).batteryLevel).toBe('0%');
  });

  it('uses the GPS position when the heartbeat\'s is not a number', () => {
    expect(toTelemetryRecord({ ...GPS, latitude: undefined, longitude: 80.1 })).toMatchObject({ latitude: 12.8235, longitude: 80.0446 });
  });

  it('is nothing when no position is a finite number, rather than something toFixed() throws on', () => {
    expect(toTelemetryRecord({ lat: 'north', lng: {}, battery: 50 })).toBeNull();
    expect(toTelemetryRecord({ latitude: NaN, longitude: 80, lat: Infinity, lng: 1 })).toBeNull();
    expect(toTelemetryRecord({ battery: 50, lastSeen: 1 })).toBeNull();
  });

  it("never sends the heartbeat's 'Unknown' placeholder over a real battery reading", () => {
    // safety-ping stores batteryLevel 'Unknown' when a phone sends none.
    expect(toTelemetryRecord({ ...GPS, ...HEARTBEAT, batteryLevel: 'Unknown' }).batteryLevel).toBe('90%');
    const { battery: _battery, ...gpsWithoutBattery } = GPS;
    expect(toTelemetryRecord({ ...gpsWithoutBattery, ...HEARTBEAT, batteryLevel: 'Unknown' }).batteryLevel).toBeNull();
  });

  it('leaves out what it has no value for', () => {
    expect(toTelemetryRecord({ lat: 1, lng: 2 })).toEqual({ latitude: 1, longitude: 2, timestamp: null, batteryLevel: null });
  });
});
