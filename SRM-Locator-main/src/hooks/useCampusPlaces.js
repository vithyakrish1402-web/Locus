import { useCallback, useEffect, useMemo, useState } from 'react';
import { SRM_MASTER_DATABASE } from '../srmDatabase';
import { mergeCampusPlaces, validateNewPlace } from '../utils/campusPlaces';
import { fetchCampusPlaces, readCachedPlaces, removeCampusPlace, saveCampusPlace } from '../utils/campusPlacesStore';

/**
 * The map's places: the built-in database plus the ones the admin has added in the app.
 * Read once when someone is signed in (and again after an add or remove), starting from the copy
 * kept on the phone so a launch with no signal still shows them. A failed read changes nothing:
 * the built-in places are always there.
 *
 * @param {object|null} user the signed-in Firebase user, or null
 * @returns {{ places: object[], added: object[], add: (fields: object) => Promise<{ok:boolean, reason?:string}>,
 *   remove: (id: string) => Promise<void> }}
 */
export function useCampusPlaces(user) {
  const [added, setAdded] = useState(readCachedPlaces);
  const signedIn = Boolean(user);

  const refresh = useCallback(async () => {
    try {
      setAdded(await fetchCampusPlaces());
    } catch { /* offline, or the rules refused: keep what is shown */ }
  }, []);

  useEffect(() => {
    if (!signedIn) return undefined;
    let live = true;
    fetchCampusPlaces().then((list) => { if (live) setAdded(list); }).catch(() => { /* keep what is shown */ });
    return () => { live = false; };
  }, [signedIn]);

  const places = useMemo(() => mergeCampusPlaces(SRM_MASTER_DATABASE, added), [added]);

  // `id`: the document id the form keeps for its place (newCampusPlaceId), so a second try
  // after a timeout saves the same place.
  const add = useCallback(async (input, id) => {
    const checked = validateNewPlace(input, places);
    if (!checked.ok) return checked;
    await saveCampusPlace(checked.fields, id);
    await refresh();
    return { ok: true };
  }, [places, refresh]);

  const remove = useCallback(async (id) => {
    await removeCampusPlace(id);
    await refresh();
  }, [refresh]);

  return { places, added, add, remove };
}
