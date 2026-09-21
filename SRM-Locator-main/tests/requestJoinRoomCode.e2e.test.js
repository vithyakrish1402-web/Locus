import { describe, it, expect } from 'vitest';
import { e2eServer, sleep, settle } from './helpers/e2eServer.js';

/**
 * End-to-end: 'request-join' only accepts a real room code.
 *
 * The room code is used as an object key, so anything that isn't a non-empty string
 * got coerced into one: a join with no code at all created (and made its sender the
 * Commander of) a squad literally called "undefined", and 123 or {} landed in "123"
 * and "[object Object]". Whoever later typed that code for real found someone already
 * in charge of it and sat in the waiting room behind a squad nobody meant to create.
 */

const { connect, requestJoin } = e2eServer();

// Everything the server says back to a join request.
const joinReplies = (socket) => {
  const replies = [];
  for (const event of ['access-granted', 'access-pending', 'access-denied']) {
    socket.on(event, (payload) => replies.push({ event, payload }));
  }
  return replies;
};

const BAD_CODES = [
  { label: 'no room code', payload: {}, lands: 'undefined' },
  { label: 'a null room code', payload: { roomCode: null }, lands: 'null' },
  { label: 'an empty room code', payload: { roomCode: '' }, lands: '' },
  { label: 'a numeric room code', payload: { roomCode: 123 }, lands: '123' },
  { label: 'an object room code', payload: { roomCode: {} }, lands: '[object Object]' },
];

describe("'request-join' with an invalid room code", () => {
  for (const { label, payload, lands } of BAD_CODES) {
    it(`is refused for ${label}`, async () => {
      const sender = await connect();
      const replies = joinReplies(sender);

      sender.emit('request-join', { ...payload, user: { uid: 'uBad', name: 'Bad' } });

      await settle(sender);
      await sleep(100);
      expect(replies).toEqual([]);

      // Nothing was created under the code it would have been coerced to.
      if (lands) {
        const later = await connect();
        expect(await requestJoin(later, lands, 'uLater')).toMatchObject({ outcome: 'granted', role: 'OWNER' });
      }
    });
  }

  it('still lets a real room code through', async () => {
    const sender = await connect();
    expect(await requestJoin(sender, 'ALPHA7', 'uA')).toMatchObject({ outcome: 'granted', role: 'OWNER' });
  });
});
