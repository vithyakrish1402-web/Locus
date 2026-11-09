import { describe, it, expect } from 'vitest';
import {
  cleanName, cleanPhoto, cleanRoute, cleanZone, cleanGeofenceAlert, ALLOWED_PHOTO_HOSTS, MAX_ROUTE_POINTS,
} from '../backend/sanitize.js';
import { clientAddressOf, clientAddressConfig } from '../backend/clientAddress.js';
import { createIdTokenVerifier, verifiedNameOf, NEUTRAL_NAME } from '../backend/identity.js';

describe('a display name', () => {
  it('is cut to length and loses control, zero-width and direction-override characters', () => {
    expect(cleanName('  Asha  ')).toBe('Asha');
    expect(cleanName('x'.repeat(100))).toBe('x'.repeat(40));
    expect(cleanName('A' + String.fromCharCode(0) + 'sha' + String.fromCharCode(0x202e))).toBe('Asha');
    expect(cleanName(String.fromCharCode(0x200b).repeat(2))).toBeNull();
    expect(cleanName(42)).toBeNull();
    expect(cleanName('   ')).toBeNull();
  });
});

describe('a photo link', () => {
  const dicebear = 'https://api.dicebear.com/7.x/bottts/svg?seed=Krish&backgroundColor=000000';

  it('passes from the hosts the app uses', () => {
    expect(cleanPhoto(dicebear)).toBe(dicebear);
    expect(cleanPhoto('https://lh3.googleusercontent.com/a/abc=s96-c')).toBe('https://lh3.googleusercontent.com/a/abc=s96-c');
    for (const host of ALLOWED_PHOTO_HOSTS) expect(cleanPhoto(`https://${host}/x.png`)).toBe(`https://${host}/x.png`);
  });

  it('is dropped from any other host, including look-alikes and user-info tricks', () => {
    for (const url of [
      'https://api.dicebear.com.evil.com/x',
      'https://evil.com/api.dicebear.com/x',
      'https://evil.com/?u=https://api.dicebear.com/x',
      'https://api.dicebear.com@evil.com/x',
      'https://api.dicebear.com:pw@evil.com/x',
      'https://evil.com#@api.dicebear.com/x',
      'https://evil.com\\@api.dicebear.com/x',
      'https://xapi.dicebear.com/x',
      'https://api.dicebear.com./x',
      'https://lh3.googleusercontent.com.evil.com/x',
      'https://googleusercontent.com/x',
      'https://tracker.example/pixel.gif',
    ]) {
      expect(cleanPhoto(url), url).toBeNull();
    }
  });

  it('must be https, with no user name, password or port, and not enormous', () => {
    expect(cleanPhoto('http://api.dicebear.com/x')).toBeNull();
    expect(cleanPhoto('javascript:alert(1)')).toBeNull();
    expect(cleanPhoto('data:image/png;base64,AAAA')).toBeNull();
    expect(cleanPhoto('https://user@api.dicebear.com/x')).toBeNull();
    expect(cleanPhoto('https://api.dicebear.com:8443/x')).toBeNull();
    expect(cleanPhoto(`https://api.dicebear.com/${'a'.repeat(3000)}`)).toBeNull();
    expect(cleanPhoto('not a url')).toBeNull();
    expect(cleanPhoto(null)).toBeNull();
    expect(cleanPhoto({ href: dicebear })).toBeNull();
  });

  it('matches the host exactly, case aside', () => {
    expect(cleanPhoto('https://API.DiceBear.com/x')).toBe('https://api.dicebear.com/x');
  });
});

const point = (lat, lng) => ({ lat, lng });

describe('a custom route', () => {
  const route = { roomCode: 'R', key: 'Tech Park_Java Green', data: { distance: 'CUSTOM', eta: 'TACTICAL', path: [point(12.8, 80.0), point(12.9, 80.1)] } };

  it('keeps only key, distance, eta and the points', () => {
    const junk = { ...route, evil: 'x'.repeat(5000), data: { ...route.data, extra: { deep: [1] }, path: [{ ...point(12.8, 80.0), alt: 5 }, point(12.9, 80.1)] } };
    expect(cleanRoute(junk)).toEqual({ key: route.key, data: { distance: 'CUSTOM', eta: 'TACTICAL', path: route.data.path } });
  });

  it('is refused when it is no route', () => {
    expect(cleanRoute(null)).toBeNull();
    expect(cleanRoute({ ...route, key: '' })).toBeNull();
    expect(cleanRoute({ ...route, data: null })).toBeNull();
    expect(cleanRoute({ ...route, data: { path: [point(12.8, 80.0)] } })).toBeNull(); // one point is no route
    expect(cleanRoute({ ...route, data: { path: [point(12.8, 80.0), point(91, 80)] } })).toBeNull();
    expect(cleanRoute({ ...route, data: { path: [point(12.8, 80.0), point('12', 80)] } })).toBeNull();
    const tooMany = Array.from({ length: MAX_ROUTE_POINTS + 1 }, (_, i) => point(12 + i / 1e5, 80));
    expect(cleanRoute({ ...route, data: { path: tooMany } })).toBeNull();
    expect(cleanRoute({ ...route, data: { path: tooMany.slice(0, MAX_ROUTE_POINTS) } })).not.toBeNull();
  });
});

describe('a zone', () => {
  it('keeps only the known fields', () => {
    expect(cleanZone({ id: 7, name: 'Gate', radius: 50, lat: 12.8, lng: 80, huge: 'x'.repeat(9000) })).toEqual({ id: '7', name: 'Gate', radius: 50, lat: 12.8, lng: 80 });
  });
  it('is refused with a bad position, radius or corner', () => {
    expect(cleanZone({ name: 'a', lat: 200, lng: 0 })).toBeNull();
    expect(cleanZone({ name: 'a', radius: -1 })).toBeNull();
    expect(cleanZone({ name: 'a', points: [{ lat: 1, lng: 'x' }] })).toBeNull();
    expect(cleanZone({ junk: 1 })).toBeNull();
    expect(cleanZone('zone')).toBeNull();
  });
});

describe('a geofence alert', () => {
  it('shows the server\'s name for the sender and drops everything else', () => {
    const alert = cleanGeofenceAlert({ type: 'enter', zoneName: 'Library', userName: 'Dean', blob: 'x'.repeat(9000), lat: 12.8, lng: 80 }, 'Asha');
    expect(alert).toEqual({ type: 'ENTER', zoneName: 'Library', userName: 'Asha', lat: 12.8, lng: 80 });
  });
  it('is refused without a type and zone name, or with an impossible position', () => {
    expect(cleanGeofenceAlert({ zoneName: 'x' }, 'A')).toBeNull();
    expect(cleanGeofenceAlert({ type: 'ENTER' }, 'A')).toBeNull();
    expect(cleanGeofenceAlert({ type: 'ENTER', zoneName: 'x', lat: 999, lng: 0 }, 'A')).toBeNull();
  });
});

describe('the name a sign-in token vouches for', () => {
  it('is its display name, else the start of its email, else a neutral one', () => {
    expect(verifiedNameOf({ name: ' Asha K ', email: 'ak@srmist.edu.in' })).toBe('Asha K');
    expect(verifiedNameOf({ email: 'ak1234@srmist.edu.in' })).toBe('ak1234');
    expect(verifiedNameOf({ name: '  ', email: '@srmist.edu.in' })).toBe(NEUTRAL_NAME);
    expect(verifiedNameOf({})).toBe(NEUTRAL_NAME);
    expect(verifiedNameOf(null)).toBe(NEUTRAL_NAME);
    expect(verifiedNameOf({ name: 42, email: 7 })).toBe(NEUTRAL_NAME);
  });

  it('comes back from the verifier next to the uid', async () => {
    const TOKEN = 'aaa.bbb.ccc';
    const verifier = createIdTokenVerifier({ env: {}, log: { error() {} }, loadAuth: async () => ({ verifyIdToken: async () => ({ uid: 'u1', name: 'Asha', email: 'x@y.z' }) }) });
    expect(await verifier.verifyIdToken(TOKEN)).toEqual({ ok: true, uid: 'u1', name: 'Asha' });
  });
});

describe('which address a connection comes from', () => {
  const handshake = (xff, address = '10.0.0.9', extra = {}) => ({ address, headers: { ...(xff ? { 'x-forwarded-for': xff } : {}), ...extra } });

  it('is the one the single trusted proxy added: the last entry, not the first (which the caller can type)', () => {
    expect(clientAddressOf(handshake('1.1.1.1, 203.0.113.5'), { hops: 1 })).toBe('203.0.113.5');
    expect(clientAddressOf(handshake('203.0.113.5'), { hops: 1 })).toBe('203.0.113.5');
  });
  it('counts back from the right for more proxies', () => {
    expect(clientAddressOf(handshake('9.9.9.9, 203.0.113.5, 172.16.0.1'), { hops: 2 })).toBe('203.0.113.5');
  });
  it('is the connection\'s own address with no proxy, or without a header', () => {
    expect(clientAddressOf(handshake('1.1.1.1'), { hops: 0 })).toBe('10.0.0.9');
    expect(clientAddressOf(handshake(null), { hops: 1 })).toBe('10.0.0.9');
  });
  it('prefers a named header the front proxy overwrites, when it is there', () => {
    expect(clientAddressOf(handshake('1.1.1.1', '10.0.0.9', { 'true-client-ip': '198.51.100.7' }), { hops: 1, header: 'True-Client-IP' })).toBe('198.51.100.7');
    expect(clientAddressOf(handshake('1.1.1.1'), { hops: 1, header: 'true-client-ip' })).toBe('1.1.1.1');
  });
  it('is configured from the environment', () => {
    expect(clientAddressConfig({})).toEqual({ hops: 1, header: '' });
    expect(clientAddressConfig({ LOCUS_TRUST_PROXY_HOPS: '0', LOCUS_CLIENT_IP_HEADER: ' true-client-ip ' })).toEqual({ hops: 0, header: 'true-client-ip' });
    expect(clientAddressConfig({ LOCUS_TRUST_PROXY_HOPS: 'abc' })).toEqual({ hops: 0, header: '' });
  });
});
