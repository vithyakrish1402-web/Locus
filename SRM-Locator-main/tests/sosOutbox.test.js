import { describe, it, expect, beforeEach } from 'vitest';
import { createSosOutbox } from '../src/utils/sosOutbox.js';

// The Emergency alert says "sent" only once the server has answered it ('alert-result'), and is
// sent again, as the same alert, until it is answered (utils/sosOutbox.js).

function fakeSocket() {
  const handlers = {};
  return {
    connected: true,
    emitted: [],
    emit(event, payload) { this.emitted.push([event, payload]); },
    on(event, fn) { (handlers[event] ??= new Set()).add(fn); },
    off(event, fn) { handlers[event]?.delete(fn); },
    receive(event, payload) { [...(handlers[event] ?? [])].forEach((fn) => fn(payload)); },
  };
}

// Timers run by hand: `fire()` runs whatever is due.
function fakeTimers() {
  const timers = new Map();
  let seq = 0;
  return {
    setTimer: (fn) => { seq += 1; timers.set(seq, fn); return seq; },
    clearTimer: (id) => timers.delete(id),
    fire: () => { const due = [...timers.values()]; timers.clear(); due.forEach((fn) => fn()); },
    pending: () => timers.size,
  };
}

let socket;
let timers;
let outbox;
let events;
const alerts = () => socket.emitted.filter(([e]) => e === 'sos-broadcast').map(([, p]) => p);

beforeEach(() => {
  socket = fakeSocket();
  timers = fakeTimers();
  outbox = createSosOutbox(socket, { setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  events = [];
  outbox.subscribe((e) => events.push(e.event));
  outbox.markInGroup();
});

describe('an Emergency alert sent while connected', () => {
  it('is not "sent" until the server answers it, and is then', () => {
    outbox.send({ senderName: 'A', lat: 1, lng: 2 });
    expect(alerts()).toHaveLength(1);
    expect(events).toEqual([]);
    expect(outbox.isHolding()).toBe(true);
    socket.receive('alert-result', { type: 'sos', allowed: true, clientId: alerts()[0].clientId });
    expect(events).toEqual(['sent']);
    expect(outbox.isHolding()).toBe(false);
  });

  it('with no answer in time: says it is not delivered, and sends the same alert again', () => {
    outbox.send({ senderName: 'A', lat: 1, lng: 2 });
    timers.fire();
    expect(events).toEqual(['unconfirmed']);
    expect(alerts()).toHaveLength(2);
    expect(alerts()[1].clientId).toBe(alerts()[0].clientId);
    timers.fire();
    expect(events).toEqual(['unconfirmed']); // said once, still trying
    expect(alerts()).toHaveLength(3);
    socket.receive('alert-result', { type: 'sos', allowed: true, clientId: alerts()[0].clientId });
    expect(events).toEqual(['unconfirmed', 'sent']);
    expect(timers.pending()).toBe(0);
  });

  it('ignores an answer about another alert', () => {
    outbox.send({ senderName: 'A' });
    socket.receive('alert-result', { type: 'sos', allowed: true, clientId: 'some-earlier-alert' });
    expect(events).toEqual([]);
    expect(outbox.isHolding()).toBe(true);
  });

  it('a refusal ends it without "sent"', () => {
    outbox.send({ senderName: 'A' });
    socket.receive('alert-result', { type: 'sos', allowed: false, reasonCode: 'COOLDOWN', clientId: alerts()[0].clientId });
    expect(events).toEqual(['refused']);
    expect(outbox.isHolding()).toBe(false);
  });

  it('"not in a group" (a copy that beat the rejoin) is no refusal: sent again once back in', () => {
    outbox.send({ senderName: 'A' });
    socket.receive('alert-result', { type: 'sos', allowed: false, reasonCode: 'NOT_IN_GROUP', clientId: alerts()[0].clientId });
    expect(events).toEqual(['unconfirmed']);
    expect(outbox.isHolding()).toBe(true);
    socket.receive('connect');
    outbox.markInGroup();
    expect(alerts()).toHaveLength(2);
  });

  it('lost with the connection before its answer: kept, and sent again once back in the group', () => {
    outbox.send({ senderName: 'A' });
    socket.connected = false;
    socket.receive('disconnect');
    expect(events).toEqual(['unconfirmed']);
    socket.connected = true;
    socket.receive('connect');
    expect(alerts()).toHaveLength(1);
    outbox.markInGroup();
    expect(alerts()).toHaveLength(2);
    socket.receive('alert-result', { type: 'sos', allowed: true, clientId: alerts()[1].clientId });
    expect(events).toEqual(['unconfirmed', 'sent']);
  });

  it('takes an answer that names no alert (an older server) only while one is awaited', () => {
    outbox.send({ senderName: 'A' });
    socket.receive('alert-result', { type: 'sos', allowed: true });
    expect(events).toEqual(['sent']);
    socket.receive('alert-result', { type: 'sos', allowed: false, reasonCode: 'COOLDOWN' });
    expect(events).toEqual(['sent']);
  });
});

describe('an Emergency alert sent while offline', () => {
  it('is held, then sent and confirmed once back in the group', () => {
    socket.connected = false;
    socket.receive('disconnect');
    outbox.send({ senderName: 'A' });
    expect(events).toEqual(['held']);
    expect(alerts()).toHaveLength(0);
    socket.connected = true;
    socket.receive('connect');
    outbox.markInGroup();
    expect(alerts()).toHaveLength(1);
    socket.receive('alert-result', { type: 'sos', allowed: true, clientId: alerts()[0].clientId });
    expect(events).toEqual(['held', 'sent']);
  });
});
