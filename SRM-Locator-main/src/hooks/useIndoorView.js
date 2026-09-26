import { useCallback, useEffect, useState } from 'react';
import { RETURN_CHIP_DELAY_MS } from '../utils/indoorView.js';
import { WIFI_POSITIONING_ENABLED } from '../utils/positionSource.js';

/**
 * The floors the WiFi survey has for `building`, or [] until they are known: loading, never
 * surveyed, or the table can't be read. Only for a building you are in WITHOUT an indoor
 * reading - a reading brings its own floors. Lazy, so the Firestore code stays out of the
 * main chunk; the table is the one wifiFusion already reads, cached once per process.
 */
function useSurveyedFloors(building) {
  const [known, setKnown] = useState(null); // { building, floors }

  useEffect(() => {
    if (!building) return;
    let cancelled = false;
    import('../utils/wifiPositioning.js')
      .then(async ({ loadAccessPoints, surveyedFloors }) => surveyedFloors(await loadAccessPoints(), building))
      .then((floors) => !cancelled && setKnown({ building, floors }))
      .catch((err) => {
        // Offline or signed out: the picker says "no floor data", which is all it has.
        console.warn('[WIFI] Floor list unavailable:', err?.code || err?.message);
      });
    return () => {
      cancelled = true;
    };
  }, [building]);

  return known?.building === building ? known.floors : [];
}

/**
 * WiFi Arc Stage 7: the floor picker's state. Purely local - which floor you are LOOKING
 * at. It never feeds positionFor, so browsing a floor can't change what is broadcast.
 *
 * Two ways to have a picker:
 * - an indoor reading: you're on a known floor (`liveFloor`), the view follows it, and
 *   looking at another floor is "browsing", with a return chip;
 * - no reading, but your GPS fix is inside a building's footprint (`gpsBuilding`): every
 *   building gets a picker, with the surveyed floors as tabs - or none, and the picker says
 *   so. There is no live floor, so no tab is open until you pick one, and until then no
 *   squadmate is dimmed.
 *
 * @param {{building:string, floor:number, floors:number[]}|null} indoor from useWifiFusion
 * @param {string|null} [gpsBuilding] the building your GPS fix is inside, from buildingAt
 * @returns {null | {building:string, floors:number[], liveFloor:number|null,
 *   viewedFloor:number|null, browsing:boolean, showReturnChip:boolean,
 *   selectFloor(floor:number):void, returnToLive():void}} null when you're in no building
 */
function useIndoorViewState(indoor, gpsBuilding = null) {
  // The floor you picked, or null to follow your live floor (or, with none, no floor). An
  // object, so every pick is a new browse session with its own return-chip timer, even
  // back to the same floor.
  const [picked, setPicked] = useState(null);
  const [chipFor, setChipFor] = useState(null);

  const building = indoor?.building ?? gpsBuilding ?? null;
  const liveFloor = indoor ? indoor.floor : null;
  const surveyed = useSurveyedFloors(indoor ? null : building);

  // A pick belongs to one session: a building, with or without a reading. Leaving the
  // building, or a reading arriving or going, forgets it, so a reading always opens on your
  // live floor. Adjusted during render, React's pattern for resetting state on a prop change.
  const session = building && `${building}|${indoor ? 'live' : 'gps'}`;
  const [pickedIn, setPickedIn] = useState(session);
  if (session !== pickedIn) {
    setPickedIn(session);
    setPicked(null);
  }

  // Browsing = looking at a floor that isn't the one you're on. If your live floor
  // catches up with the pick, you are simply back on it. Without a live floor there is
  // nothing to browse away from.
  const browsingPick = indoor && picked && picked.floor !== liveFloor ? picked : null;

  useEffect(() => {
    if (!browsingPick) return;
    const timer = setTimeout(() => setChipFor(browsingPick), RETURN_CHIP_DELAY_MS);
    return () => clearTimeout(timer);
  }, [browsingPick]);

  const selectFloor = useCallback(
    (floor) => {
      if (liveFloor !== null) setPicked(floor === liveFloor ? null : { floor });
      // No live floor: tapping the open tab again closes it, back to nobody dimmed.
      else setPicked((prev) => (prev?.floor === floor ? null : { floor }));
    },
    [liveFloor]
  );
  const returnToLive = useCallback(() => setPicked(null), []);

  if (!building) return null;
  if (!indoor) {
    return {
      building,
      floors: surveyed,
      liveFloor: null,
      viewedFloor: picked ? picked.floor : null,
      browsing: false,
      showReturnChip: false,
      selectFloor,
      returnToLive,
    };
  }
  return {
    building,
    floors: indoor.floors?.length ? indoor.floors : [liveFloor],
    liveFloor,
    viewedFloor: browsingPick ? browsingPick.floor : liveFloor,
    browsing: Boolean(browsingPick),
    showReturnChip: Boolean(browsingPick) && chipFor === browsingPick,
    selectFloor,
    returnToLive,
  };
}

/**
 * With WiFi positioning off there is never a picker, so the hook is a constant null: picked
 * here, at module level, so a flag-off build carries none of the picker's state at all.
 */
export const useIndoorView = WIFI_POSITIONING_ENABLED ? useIndoorViewState : () => null;
