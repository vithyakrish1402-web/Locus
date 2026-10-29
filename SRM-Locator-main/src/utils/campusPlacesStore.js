// Firestore reads and writes for the places the admin adds in the app (campusPlaces.js has the
// shape and the checks). The one collection is `campus_places`, one document per place, the
// document id being the place's id without its `cp-`.
//
// The admin check in App.jsx only decides who is shown the Add Place button. Who may WRITE is
// decided by the Firestore rules in the Firebase console (this repo has none), so those must say:
//
//   match /campus_places/{id} {
//     allow read: if request.auth != null;
//     allow create, update, delete: if request.auth != null
//       && request.auth.token.email == "vithyakrish1402@gmail.com"
//       && request.auth.token.email_verified == true;
//   }
//
// Without that rule every signed-in user could change the map for everyone.

import { collection, deleteDoc, doc, getDocsFromServer, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase.js';
import { toCampusPlace } from './campusPlaces.js';

const COLLECTION = 'campus_places';
const CACHE_KEY = 'locus.campusPlaces.v1';

/** The last list read, kept on the phone so the places are still there with no signal. */
export function readCachedPlaces() {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.map((p) => toCampusPlace(String(p?.id ?? '').replace(/^cp-/, ''), p)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function writeCachedPlaces(places) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(places));
  } catch { /* private window or full storage: the list just isn't kept */ }
}

/**
 * Every added place, from the server. Waits for the saved sign-in to come back first: the
 * collection is readable only when signed in. FromServer so being offline rejects rather than
 * answering "no places" from an empty cache. A good read replaces the phone's kept copy.
 */
export async function fetchCampusPlaces() {
  await auth.authStateReady();
  if (!auth.currentUser) throw Object.assign(new Error('campus_places can only be read when signed in'), { code: 'unauthenticated' });
  const snapshot = await getDocsFromServer(collection(db, COLLECTION));
  const places = snapshot.docs.map((d) => toCampusPlace(d.id, d.data())).filter(Boolean);
  writeCachedPlaces(places);
  return places;
}

/** A new place's document id, made on the phone (no network), so saving it again is the same place. */
export function newCampusPlaceId() {
  return doc(collection(db, COLLECTION)).id;
}

/**
 * Saves a place that validateNewPlace passed, as document `id` (newCampusPlaceId). Rejects with
 * 'permission-denied' for anyone the rules don't allow. Offline it never settles: Firestore
 * holds the write until it is back online, so the caller stops waiting (App.jsx), and a second
 * try writes the same document rather than a second place.
 */
export async function saveCampusPlace(fields, id) {
  const email = auth.currentUser?.email ?? null;
  await setDoc(doc(db, COLLECTION, id), { ...fields, addedBy: email, addedAt: serverTimestamp() });
  return id;
}

/** Removes an added place by its `cp-` id. */
export async function removeCampusPlace(placeId) {
  await deleteDoc(doc(db, COLLECTION, String(placeId).replace(/^cp-/, '')));
}
