import { describe, it, expect } from 'vitest';
import { queueBackgroundPing, pendingBackgroundPings, PING_TTL_MS } from '../backend/pingRelay';

describe('background ping inbox', () => {
  it('only returns the recipient’s unseen, unexpired pings', () => {
    const squad = {};
    const first = queueBackgroundPing(squad, 'alice', 'Bob', 1000);
    queueBackgroundPing(squad, 'charlie', 'Bob', 1001);
    expect(pendingBackgroundPings(squad, 'alice', 0, 1002)).toEqual([{ rev: first.rev, senderName: 'Bob' }]);
    expect(pendingBackgroundPings(squad, 'alice', first.rev, 1002)).toEqual([]);
    expect(pendingBackgroundPings(squad, 'alice', 0, 1000 + PING_TTL_MS)).toEqual([]);
    expect(pendingBackgroundPings(squad, 'alice', -1, 1002)).toEqual([]);
  });
  it('does not queue an unidentified recipient and bounds memory', () => {
    const squad = {};
    expect(queueBackgroundPing(squad, null, 'Bob')).toBeNull();
    for (let n=0;n<300;n++) queueBackgroundPing(squad, 'alice', 'Bob', 1000+n);
    expect(squad.backgroundPings).toHaveLength(200);
  });
});
