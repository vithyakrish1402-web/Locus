// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { DEVELOPER_STORAGE_KEY, developerStatus } from '../src/utils/developerMode.js';
import { useDeveloperMode } from '../src/hooks/useDeveloperMode.js';

const ADMIN = 'admin@example.com';
const admin = { uid: 'u1', email: ADMIN, emailVerified: false }; // email and password accounts are never verified
const status = (over) => developerStatus({ authLoading: false, user: admin, online: true, adminEmail: ADMIN, ...over });

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe('who may have Developer mode', () => {
  it('only the admin account, once sign-in has loaded, with a connection (an unverified email is fine: the app has no verification step)', () => {
    expect(status({})).toBe('admin');
  });

  it('fails closed while the role is loading or the phone is offline: hidden, not forgotten', () => {
    expect(status({ authLoading: true })).toBe('unknown');
    expect(status({ online: false })).toBe('unknown');
    expect(status({ authLoading: true, user: null })).toBe('unknown');
  });

  it('is denied to anyone else: signed out, or another account', () => {
    expect(status({ user: null })).toBe('denied');
    expect(status({ user: { ...admin, email: 'someone@example.com' } })).toBe('denied');
    expect(status({ user: { ...admin, email: ADMIN.toUpperCase() } })).toBe('denied');
  });
});

describe('the Developer mode switch', () => {
  const hook = (props) => renderHook((p) => useDeveloperMode({ adminEmail: ADMIN, enabled: true, authLoading: false, user: admin, ...p }), { initialProps: props });
  let online = true;
  beforeEach(() => {
    online = true;
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online });
  });

  it('is off by default, even for the admin', () => {
    const { result } = hook({});
    expect(result.current).toMatchObject({ status: 'admin', on: false });
  });

  it('turns on for the admin, and is remembered for that account on this phone', () => {
    const { result, unmount } = hook({});
    act(() => result.current.setOn(true));
    expect(result.current.on).toBe(true);
    expect(window.localStorage.getItem(DEVELOPER_STORAGE_KEY)).toBe('u1');
    unmount();
    expect(hook({}).result.current.on).toBe(true); // reopened: still on, after the admin check
  });

  it('cannot be turned on by anyone else, and stays off in builds without Developer mode', () => {
    const other = hook({ user: { uid: 'u2', email: 'x@example.com', emailVerified: true } });
    act(() => other.result.current.setOn(true));
    expect(other.result.current).toMatchObject({ status: 'denied', on: false });
    expect(window.localStorage.getItem(DEVELOPER_STORAGE_KEY)).toBeNull();
    const normal = hook({ enabled: false });
    act(() => normal.result.current.setOn(true));
    expect(normal.result.current.on).toBe(false);
    expect(window.localStorage.getItem(DEVELOPER_STORAGE_KEY)).toBeNull();
  });

  it('is hidden while the role is loading or the phone is offline, and comes back without being turned on again', () => {
    const { result, rerender } = hook({});
    act(() => result.current.setOn(true));
    rerender({ authLoading: true });
    expect(result.current).toMatchObject({ status: 'unknown', on: false });
    expect(window.localStorage.getItem(DEVELOPER_STORAGE_KEY)).toBe('u1'); // not forgotten
    rerender({ authLoading: false });
    expect(result.current.on).toBe(true);
    online = false;
    act(() => window.dispatchEvent(new Event('offline')));
    expect(result.current).toMatchObject({ status: 'unknown', on: false });
    online = true;
    act(() => window.dispatchEvent(new Event('online')));
    expect(result.current.on).toBe(true);
  });

  it('switches off, and is forgotten, on sign-out', () => {
    const { result, rerender } = hook({});
    act(() => result.current.setOn(true));
    rerender({ user: null });
    expect(result.current).toMatchObject({ status: 'denied', on: false });
    expect(window.localStorage.getItem(DEVELOPER_STORAGE_KEY)).toBeNull();
    rerender({ user: admin }); // signing back in: off again
    expect(result.current.on).toBe(false);
  });

  it('switches off, and is forgotten, when the account stops being admin; another account never inherits it', () => {
    const { result, rerender } = hook({});
    act(() => result.current.setOn(true));
    rerender({ user: { ...admin, email: 'moved@example.com' } });
    expect(result.current.on).toBe(false);
    expect(window.localStorage.getItem(DEVELOPER_STORAGE_KEY)).toBeNull();
    window.localStorage.setItem(DEVELOPER_STORAGE_KEY, 'u1');
    expect(hook({ user: { uid: 'u9', email: ADMIN, emailVerified: true } }).result.current.on).toBe(false);
  });
});
