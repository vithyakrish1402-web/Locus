import { describe, it, expect } from 'vitest';
import { mapEngineStatus, MAP_STATUS_LABEL, MAP_STATUS_REASON_TEXT } from '../src/utils/mapEngineStatus.js';

describe('mapEngineStatus', () => {
  it('is Google, reason ok, while nothing has failed', () => {
    expect(mapEngineStatus(null)).toEqual({ engine: 'google', reason: 'ok' });
  });

  it.each(['no-key', 'timeout', 'key-rejected'])('is the backup, with its reason, for %s', (reason) => {
    expect(mapEngineStatus(reason)).toEqual({ engine: 'backup', reason });
    expect(MAP_STATUS_REASON_TEXT[reason]).toBeTruthy();
  });

  it('words the status the way the owner asked', () => {
    expect(MAP_STATUS_LABEL).toEqual({ google: 'Map: Google', backup: 'Map: Backup (OpenStreetMap)' });
    expect(MAP_STATUS_REASON_TEXT).toEqual({
      'no-key': 'No Google Maps key in this build',
      timeout: 'Google map could not load (slow or no connection)',
      'key-rejected': 'Google rejected the map key',
    });
  });
});
