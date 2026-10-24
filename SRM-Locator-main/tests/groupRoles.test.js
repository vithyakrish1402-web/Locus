import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  PERMISSIONS, ROLE_ADMIN, ROLE_MODERATOR, ROLE_MEMBER, OWN_ADMIN_ONLY, can, canActOn, isOwnAdmin, mayDo, refusal, roleOf,
} from '../backend/groupRoles.js';

/**
 * The permissions table (backend/groupRoles.js) and the one way a moderator is made. The
 * server's handlers are covered end to end in groupRoles.e2e.test.js; this pins the table
 * itself, and that nothing in the server writes a moderator except the admin's request.
 */

describe('the permissions table', () => {
  it('gives the main admin everything', () => {
    for (const action of Object.keys(PERMISSIONS)) expect(can(ROLE_ADMIN, action)).toBe(true);
  });

  it('lets a moderator admit one at a time, remove, and read the log, and nothing else', () => {
    const allowed = Object.keys(PERMISSIONS).filter((action) => can(ROLE_MODERATOR, action)).sort();
    expect(allowed).toEqual(['admitOne', 'kick', 'readActivityLog', 'seeJoinQueue']);
    for (const action of ['block', 'unblock', 'admitAll', 'setModerator']) expect(can(ROLE_MODERATOR, action)).toBe(false);
  });

  it('gives a member nothing', () => {
    for (const action of Object.keys(PERMISSIONS)) expect(can(ROLE_MEMBER, action)).toBe(false);
  });

  it('keeps a moderator off the admin, the Commander and other moderators', () => {
    expect(canActOn(ROLE_MODERATOR, { isAdmin: true })).toBe(false);
    expect(canActOn(ROLE_MODERATOR, { isCommander: true })).toBe(false);
    expect(canActOn(ROLE_MODERATOR, { isModerator: true })).toBe(false);
    expect(canActOn(ROLE_MODERATOR, {})).toBe(true);
    expect(canActOn(ROLE_ADMIN, { isModerator: true })).toBe(true);
  });

  it('says why a request was refused, in the shape older apps expect', () => {
    expect(refusal('block')).toEqual({ ok: false, reason: 'not-allowed', message: 'Only the main admin can block people.' });
    expect(refusal('anything-else')).toMatchObject({ ok: false, reason: 'not-allowed' });
    expect(typeof refusal('anything-else').message).toBe('string');
  });
});

describe('the Group\'s own admin', () => {
  it('alone blocks, unblocks, admits all and makes moderators; a stand-in does the rest', () => {
    expect([...OWN_ADMIN_ONLY].sort()).toEqual(['admitAll', 'block', 'setModerator', 'unblock']);
    for (const action of OWN_ADMIN_ONLY) {
      expect(mayDo(ROLE_ADMIN, action, true)).toBe(true);
      expect(mayDo(ROLE_ADMIN, action, false)).toBe(false);
    }
    for (const action of ['admitOne', 'kick', 'readActivityLog', 'seeJoinQueue']) expect(mayDo(ROLE_ADMIN, action, false)).toBe(true);
    // Being the own admin never lends a moderator more.
    expect(mayDo(ROLE_MODERATOR, 'block', true)).toBe(false);
  });

  it('is the Commander holding command; with no uids at all (an old client), whoever holds command', () => {
    const squad = { ownerId: 's2', members: ['s1', 's2'] };
    expect(isOwnAdmin(squad, 's2', 'uStandIn', 'uCommander')).toBe(false);
    expect(isOwnAdmin(squad, 's2', 'uCommander', 'uCommander')).toBe(true);
    expect(isOwnAdmin(squad, 's1', 'uCommander', 'uCommander')).toBe(false);
    expect(isOwnAdmin(squad, 's2', null, null)).toBe(true);
  });
});

describe('roles in a Group from before roles existed', () => {
  it('are the leader as admin and everyone else a member', () => {
    const squad = { ownerId: 's1', members: ['s1', 's2'] }; // no moderatorUids at all
    expect(roleOf(squad, 's1', 'u1')).toBe(ROLE_ADMIN);
    expect(roleOf(squad, 's2', 'u2')).toBe(ROLE_MEMBER);
  });
});

describe('the server', () => {
  const server = readFileSync(new URL('../backend/server.js', import.meta.url), 'utf8');

  it('makes a moderator in one place only: the admin\'s set-moderator request', () => {
    // Every call that can add one (setModerator; dropModerator only ever removes).
    const calls = server.match(/\bsetModerator\s*\(/g) ?? [];
    expect(calls).toHaveLength(1);
    const handler = server.slice(server.indexOf("socket.on('set-moderator'"));
    expect(handler.indexOf('setModerator(')).toBeGreaterThan(-1);
    const check = handler.indexOf("allowed(squad, socket.id, 'setModerator')");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(handler.indexOf('setModerator('));
    // And nothing writes the list directly, or copies it from another Group.
    expect(server).not.toMatch(/moderatorUids\s*(=|\.push|\.splice|\.unshift)/);
    // (Read as `moderatorUids: squad.moderatorUids` for the SOS audience; never set as one.)
    expect(server).not.toMatch(/moderatorUids\s*:(?!\s*squad\.moderatorUids)/);
  });
});
