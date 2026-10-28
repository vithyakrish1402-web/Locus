import { describe, it, expect } from 'vitest';
import { trimQueue, manageSendQueue, QUEUE_MAX_ITEMS, QUEUE_MAX_AGE_MS, RECONNECT_BATCH_SIZE } from '../src/utils/sendQueue.js';

// What a phone saves up to send while offline (utils/sendQueue.js): capped, aged out, never an
// SOS, and sent back in batches.

const packet = (event, queuedAt) => ({ data: [event, {}], queuedAt });

describe('trimQueue', () => {
  it('drops what has waited too long, but never anything about an SOS', () => {
    const now = 1_000_000;
    const old = now - QUEUE_MAX_AGE_MS - 1;
    const kept = trimQueue([packet('ping-user', old), packet('sos-broadcast', old), packet('ping-user', now)], now);
    expect(kept.map((p) => p.data[0])).toEqual(['sos-broadcast', 'ping-user']);
  });

  it('keeps at most QUEUE_MAX_ITEMS, dropping the oldest first, but never an SOS', () => {
    const now = 1000;
    const queue = [packet('sos-broadcast', now), ...Array.from({ length: QUEUE_MAX_ITEMS + 5 }, (_, i) => packet(`e${i}`, now))];
    const kept = trimQueue(queue, now);
    expect(kept).toHaveLength(QUEUE_MAX_ITEMS);
    expect(kept[0].data[0]).toBe('sos-broadcast');
    expect(kept[1].data[0]).toBe('e6'); // e0..e5 (the oldest six) went
  });
});

describe('manageSendQueue', () => {
  function rig() {
    const handlers = {};
    const ioHandlers = {};
    const timers = [];
    const socket = {
      connected: false,
      sendBuffer: [],
      sent: [],
      packet(p) { this.sent.push(p.data[0]); },
      on: (e, fn) => { handlers[e] = fn; },
      off: () => {},
      io: { on: (e, fn) => { ioHandlers[e] = fn; }, off: () => {} },
    };
    manageSendQueue(socket, {
      now: () => 0,
      setTimer: (fn) => { timers.push(fn); return timers.length; },
      clearTimer: () => {},
      setTick: () => 0,
      clearTick: () => {},
    });
    const runTimer = () => timers.shift()?.();
    return { socket, open: () => ioHandlers.open(), connect: () => { socket.connected = true; handlers.connect(); }, runTimer };
  }

  it('takes the saved-up packets in hand at reconnect and sends them in batches', () => {
    const { socket, open, connect, runTimer } = rig();
    socket.sendBuffer = Array.from({ length: RECONNECT_BATCH_SIZE * 2 + 3 }, (_, i) => ({ data: [`e${i}`] }));
    open();
    expect(socket.sendBuffer).toEqual([]); // socket.io won't flush them all at once
    connect();
    expect(socket.sent).toEqual([]); // the rejoin goes first
    runTimer();
    expect(socket.sent).toHaveLength(RECONNECT_BATCH_SIZE);
    runTimer();
    expect(socket.sent).toHaveLength(RECONNECT_BATCH_SIZE * 2);
    runTimer();
    expect(socket.sent).toHaveLength(RECONNECT_BATCH_SIZE * 2 + 3);
    expect(socket.sent[0]).toBe('e0');
  });
});
