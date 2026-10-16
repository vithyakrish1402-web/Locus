// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { REMEMBERED_GROUP_KEY, rememberGroup, rememberedGroup, forgetGroup } from '../src/utils/rememberedGroup.js';

beforeEach(() => localStorage.removeItem(REMEMBERED_GROUP_KEY));

describe('the remembered Group', () => {
  it('gives back the code and role to the same person', () => {
    rememberGroup({ code: 'abc123', role: 'OWNER', uid: 'u1' });
    expect(rememberedGroup('u1')).toEqual({ code: 'ABC123', role: 'OWNER' });
  });

  it('is nobody else\'s', () => {
    rememberGroup({ code: 'ABC123', role: 'MEMBER', uid: 'u1' });
    expect(rememberedGroup('u2')).toBeNull();
    expect(rememberedGroup(null)).toBeNull();
  });

  it('keeps nothing without a code or a person', () => {
    rememberGroup({ code: '', role: 'OWNER', uid: 'u1' });
    rememberGroup({ code: 'ABC123', role: 'OWNER', uid: '' });
    rememberGroup({ code: 'AB C1', role: 'OWNER', uid: 'u1' });
    expect(localStorage.getItem(REMEMBERED_GROUP_KEY)).toBeNull();
  });

  it('takes an unknown role as a member, never as the Group Lead', () => {
    rememberGroup({ code: 'ABC123', role: 'ADMIN', uid: 'u1' });
    expect(rememberedGroup('u1').role).toBe('MEMBER');
    localStorage.setItem(REMEMBERED_GROUP_KEY, JSON.stringify({ code: 'ABC123', role: 'BOSS', uid: 'u1' }));
    expect(rememberedGroup('u1').role).toBe('MEMBER');
  });

  it('ignores anything unreadable', () => {
    localStorage.setItem(REMEMBERED_GROUP_KEY, '{not json');
    expect(rememberedGroup('u1')).toBeNull();
    localStorage.setItem(REMEMBERED_GROUP_KEY, JSON.stringify({ code: '<script>', role: 'OWNER', uid: 'u1' }));
    expect(rememberedGroup('u1')).toBeNull();
  });

  it('is gone once forgotten', () => {
    rememberGroup({ code: 'ABC123', role: 'OWNER', uid: 'u1' });
    forgetGroup();
    expect(rememberedGroup('u1')).toBeNull();
  });
});
