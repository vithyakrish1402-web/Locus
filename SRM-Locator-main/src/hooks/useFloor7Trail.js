import { useEffect, useState } from 'react';
import { getTrail, subscribeTrail } from '../utils/floor7Demo.js';

/** The Floor 7 tracker's recent steps (raw, snapped, filtered), live. */
export function useFloor7Trail() {
  const [trail, setTrail] = useState(getTrail);
  useEffect(() => subscribeTrail(() => setTrail(getTrail())), []);
  return trail;
}
