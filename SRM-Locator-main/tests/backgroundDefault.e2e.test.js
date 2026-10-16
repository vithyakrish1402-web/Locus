import { describe, it, expect } from 'vitest';
import { e2eServer } from './helpers/e2eServer.js';

/**
 * A server started with no background-sharing settings at all (how it is today): the endpoints
 * are shut, the startup line says so, and the Group works as it always did.
 */

const { connect, createSquad, newRoom, serverOutput } = e2eServer();

describe('background sharing at its default (off)', () => {
  it('says so at startup', () => {
    const line = serverOutput().split('\n').find((l) => l.startsWith('[BACKGROUND]'));
    expect(line).toBe('[BACKGROUND] Background sharing is OFF: LOCUS_BACKGROUND_SHARING_ENABLED is not "true". The endpoints answer 503.');
  });

  it('answers 503 on every endpoint, to anyone', async () => {
    const socket = await connect();
    const base = `${socket.io.uri}/api/background`;
    for (const [method, path] of [['POST', '/token'], ['POST', '/location'], ['DELETE', '/session']]) {
      const res = await fetch(base + path, { method, headers: { authorization: 'Bearer anything', 'content-type': 'application/json' }, body: method === 'DELETE' ? undefined : '{}' });
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: 'disabled' });
    }
  });

  it('still answers the status route: not available', async () => {
    const socket = await connect();
    const res = await fetch(`${socket.io.uri}/api/background/status`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ available: false });
  });

  it('leaves the Group alone', async () => {
    const socket = await connect();
    await createSquad(socket, newRoom(), 'uA');
    expect(socket.connected).toBe(true);
  });
});
