// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fb = vi.hoisted(() => ({
  auth: { authStateReady: () => Promise.resolve(), currentUser: { email: 'owner@example.com' } },
  docs: [],
  addDoc: vi.fn(async () => ({ id: 'new1' })),
  deleteDoc: vi.fn(async () => {}),
  getDocsFromServer: vi.fn(),
}));

vi.mock('../src/firebase.js', () => ({ auth: fb.auth, db: { name: 'db' } }));
vi.mock('firebase/firestore', () => ({
  collection: (_db, name) => ({ collection: name }),
  doc: (_db, name, id) => ({ doc: `${name}/${id}` }),
  addDoc: fb.addDoc,
  deleteDoc: fb.deleteDoc,
  getDocsFromServer: fb.getDocsFromServer,
  serverTimestamp: () => 'SERVER_TIME',
}));

const { fetchCampusPlaces, readCachedPlaces, removeCampusPlace, saveCampusPlace } = await import('../src/utils/campusPlacesStore.js');

const snap = (rows) => ({ docs: rows.map(([id, data]) => ({ id, data: () => data })) });
const GOOD = { name: 'DENTAL GROUND', category: 'GROUNDS', lat: 12.8255, lng: 80.0485, info: '', aliases: ['maidan'] };

beforeEach(() => {
  localStorage.clear();
  fb.auth.currentUser = { email: 'owner@example.com' };
  fb.addDoc.mockClear();
  fb.deleteDoc.mockClear();
  fb.getDocsFromServer.mockReset();
});

describe('fetchCampusPlaces', () => {
  it('reads from the server, skips bad documents, and keeps the good ones on the phone', async () => {
    fb.getDocsFromServer.mockResolvedValue(snap([['a', GOOD], ['b', { ...GOOD, lat: 40 }], ['c', { ...GOOD, name: 'X', category: 'NOPE' }]]));
    const places = await fetchCampusPlaces();
    expect(places.map((p) => p.id)).toEqual(['cp-a']);
    expect(readCachedPlaces()).toEqual(places);
  });

  it('rejects, and leaves the kept copy alone, when signed out or offline', async () => {
    fb.getDocsFromServer.mockResolvedValue(snap([['a', GOOD]]));
    await fetchCampusPlaces();
    fb.auth.currentUser = null;
    await expect(fetchCampusPlaces()).rejects.toMatchObject({ code: 'unauthenticated' });
    fb.auth.currentUser = { email: 'x' };
    fb.getDocsFromServer.mockRejectedValue(Object.assign(new Error('offline'), { code: 'unavailable' }));
    await expect(fetchCampusPlaces()).rejects.toMatchObject({ code: 'unavailable' });
    expect(readCachedPlaces().map((p) => p.id)).toEqual(['cp-a']);
  });
});

describe('readCachedPlaces', () => {
  it('is empty with nothing kept or a damaged copy', () => {
    expect(readCachedPlaces()).toEqual([]);
    localStorage.setItem('locus.campusPlaces.v1', '{not json');
    expect(readCachedPlaces()).toEqual([]);
    localStorage.setItem('locus.campusPlaces.v1', '{"a":1}');
    expect(readCachedPlaces()).toEqual([]);
  });
});

describe('saveCampusPlace and removeCampusPlace', () => {
  it('writes the fields with who added it and when, to campus_places', async () => {
    const id = await saveCampusPlace(GOOD);
    expect(id).toBe('new1');
    expect(fb.addDoc).toHaveBeenCalledWith({ collection: 'campus_places' }, { ...GOOD, addedBy: 'owner@example.com', addedAt: 'SERVER_TIME' });
  });

  it('removes by the place id without its cp- prefix', async () => {
    await removeCampusPlace('cp-abc');
    expect(fb.deleteDoc).toHaveBeenCalledWith({ doc: 'campus_places/abc' });
  });
});
