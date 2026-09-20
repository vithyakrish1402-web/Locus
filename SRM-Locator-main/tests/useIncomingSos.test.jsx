// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIncomingSos } from '../src/hooks/useIncomingSos.js';

// Just enough of a socket: on/off/emit, plus a way to push events in as the server would.
const makeSocket = () => {
  const handlers = {};
  return {
    handlers,
    on: vi.fn((event, fn) => { (handlers[event] ||= new Set()).add(fn); }),
    off: vi.fn((event, fn) => {
      if (fn) handlers[event]?.delete(fn);
      else delete handlers[event];
    }),
    emit: vi.fn(),
    receive(event, payload) {
      handlers[event]?.forEach((fn) => fn(payload));
    },
  };
};

const sos = (over = {}) => ({
  id: 'sos-1',
  senderId: 'sock-b',
  senderName: 'Bravo',
  lat: 12.8,
  lng: 80.0,
  timestamp: 1,
  ageMs: 0,
  ...over,
});

const setup = () => {
  const socket = makeSocket();
  const hook = renderHook(() => useIncomingSos(socket));
  const receive = (payload) => act(() => socket.receive('sos-received', payload));
  return { socket, receive, ...hook };
};

describe('useIncomingSos queue', () => {
  it('starts empty', () => {
    const { result } = setup();
    expect(result.current.current).toBeNull();
    expect(result.current.pendingCount).toBe(0);
  });

  it('surfaces an incoming SOS as the current one', () => {
    const { result, receive } = setup();
    receive(sos());
    expect(result.current.current).toMatchObject({ id: 'sos-1', senderName: 'Bravo', lat: 12.8 });
    expect(result.current.pendingCount).toBe(0);
  });

  it('holds a live beacon and its later replay only once (same id)', () => {
    const { result, receive } = setup();
    receive(sos());
    receive(sos({ ageMs: 60000 })); // the replay of the same beacon
    expect(result.current.pendingCount).toBe(0);
    expect(result.current.current.ageMs).toBe(0); // the first copy wins; nothing was replaced
  });

  it('queues different senders in arrival order rather than replacing the first', () => {
    const { result, receive } = setup();
    receive(sos({ id: 'a', senderId: 'sock-b', senderName: 'Bravo' }));
    receive(sos({ id: 'b', senderId: 'sock-c', senderName: 'Charlie' }));
    receive(sos({ id: 'c', senderId: 'sock-d', senderName: 'Delta' }));
    expect(result.current.current.senderName).toBe('Bravo');
    expect(result.current.pendingCount).toBe(2);
  });

  it('lets the same sender supersede their own earlier, unacknowledged beacon in place', () => {
    const { result, receive } = setup();
    receive(sos({ id: 'a', senderId: 'sock-b', senderName: 'Bravo', lat: 1 }));
    receive(sos({ id: 'b', senderId: 'sock-c', senderName: 'Charlie' }));
    receive(sos({ id: 'a2', senderId: 'sock-b', senderName: 'Bravo', lat: 2 })); // Bravo holds again

    expect(result.current.current).toMatchObject({ id: 'a2', lat: 2 }); // still first in line, updated
    expect(result.current.pendingCount).toBe(1); // Charlie still queued, no duplicate Bravo
  });

  it('tolerates an older server that sends no id, and still dedupes', () => {
    const { result, receive } = setup();
    const legacy = { senderId: 'sock-b', senderName: 'Bravo', lat: 1, lng: 2, timestamp: 99 };
    receive(legacy);
    receive(legacy);
    expect(result.current.current.id).toBe('sock-b:99');
    expect(result.current.pendingCount).toBe(0);
  });
});

describe('useIncomingSos acknowledge', () => {
  it('tells the server which beacon, then clears it', () => {
    const { result, receive, socket } = setup();
    receive(sos());
    act(() => result.current.acknowledge());

    expect(socket.emit).toHaveBeenCalledWith('sos-ack', { id: 'sos-1' });
    expect(result.current.current).toBeNull();
  });

  it('works through the queue one beacon at a time, acknowledging each by its own id', () => {
    const { result, receive, socket } = setup();
    receive(sos({ id: 'a', senderId: 'sock-b', senderName: 'Bravo' }));
    receive(sos({ id: 'b', senderId: 'sock-c', senderName: 'Charlie' }));

    act(() => result.current.acknowledge());
    expect(result.current.current.senderName).toBe('Charlie');
    expect(result.current.pendingCount).toBe(0);

    act(() => result.current.acknowledge());
    expect(result.current.current).toBeNull();
    expect(socket.emit.mock.calls).toEqual([
      ['sos-ack', { id: 'a' }],
      ['sos-ack', { id: 'b' }],
    ]);
  });

  it('does nothing when there is nothing to acknowledge', () => {
    const { result, socket } = setup();
    act(() => result.current.acknowledge());
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('re-raises a beacon whose replay was already in flight when it was acknowledged', () => {
    const { result, receive } = setup();
    receive(sos());
    act(() => result.current.acknowledge());
    // The server won't replay it after the ack, but a copy already on the wire when the
    // member tapped ACKNOWLEDGE lands afterwards. Showing it once more is the safe
    // failure — better a repeat than a distress beacon silently lost.
    receive(sos());
    expect(result.current.current?.id).toBe('sos-1');
  });
});

describe('useIncomingSos sync', () => {
  it('asks the server to replay what this member has not acknowledged', () => {
    const { result, socket } = setup();
    act(() => result.current.requestSync());
    expect(socket.emit).toHaveBeenCalledWith('sos-sync');
  });

  it('gives a stable requestSync, safe to use in effects with dependency lists', () => {
    const { result, rerender } = setup();
    const before = result.current.requestSync;
    rerender();
    expect(result.current.requestSync).toBe(before);
  });
});

describe('useIncomingSos listener hygiene', () => {
  it('removes only its own handler, leaving other listeners on the event intact', () => {
    const { socket, unmount } = setup();
    const other = vi.fn();
    socket.on('sos-received', other);

    unmount();
    expect(socket.handlers['sos-received'].size).toBe(1);
    expect(socket.handlers['sos-received'].has(other)).toBe(true);
  });

  it('registers exactly one listener, however often it re-renders', () => {
    const { socket, rerender } = setup();
    rerender();
    rerender();
    expect(socket.handlers['sos-received'].size).toBe(1);
  });
});
