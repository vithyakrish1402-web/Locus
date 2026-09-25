import { useCallback, useEffect, useState } from 'react';
import { RETURN_CHIP_DELAY_MS } from '../utils/indoorView.js';
import { WIFI_POSITIONING_ENABLED } from '../utils/positionSource.js';

/**
 * WiFi Arc Stage 7: the floor picker's state. Purely local - which floor you are LOOKING
 * at. It never feeds positionFor, so browsing a floor can't change what is broadcast.
 *
 * @param {{building:string, floor:number, floors:number[]}|null} indoor from useWifiFusion
 * @returns {null | {building:string, floors:number[], liveFloor:number, viewedFloor:number,
 *   browsing:boolean, showReturnChip:boolean, selectFloor(floor:number):void,
 *   returnToLive():void}} null whenever there is no indoor reading (no picker at all)
 */
function useIndoorViewState(indoor) {
  // The floor you picked, or null to follow your live floor. An object, so every pick is a
  // new browse session with its own return-chip timer, even back to the same floor.
  const [picked, setPicked] = useState(null);
  const [chipFor, setChipFor] = useState(null);

  const building = indoor?.building ?? null;
  const liveFloor = indoor?.floor ?? null;

  // A pick belongs to one indoor session: leaving the building (or losing the reading)
  // forgets it, so coming back starts on your live floor. Adjusted during render, React's
  // pattern for resetting state on a prop change.
  const [pickedIn, setPickedIn] = useState(building);
  if (building !== pickedIn) {
    setPickedIn(building);
    setPicked(null);
  }

  // Browsing = looking at a floor that isn't the one you're on. If your live floor
  // catches up with the pick, you are simply back on it.
  const browsingPick = indoor && picked && picked.floor !== liveFloor ? picked : null;

  useEffect(() => {
    if (!browsingPick) return;
    const timer = setTimeout(() => setChipFor(browsingPick), RETURN_CHIP_DELAY_MS);
    return () => clearTimeout(timer);
  }, [browsingPick]);

  const selectFloor = useCallback(
    (floor) => setPicked(floor === liveFloor ? null : { floor }),
    [liveFloor]
  );
  const returnToLive = useCallback(() => setPicked(null), []);

  if (!indoor) return null;
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
 * With WiFi positioning off there is never a reading, so the hook is a constant null: picked
 * here, at module level, so a flag-off build carries none of the picker's state at all.
 */
export const useIndoorView = WIFI_POSITIONING_ENABLED ? useIndoorViewState : () => null;
