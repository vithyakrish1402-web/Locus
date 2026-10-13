import { useEffect, useState } from 'react';
import { recorder } from '../utils/floor7Recorder.js';

/** The walk recorder's live state for a component; ticks every second for the clock and countdown. */
export function useFloor7Recorder(rec = recorder) {
  const [snap, setSnap] = useState(() => rec.snapshot());
  useEffect(() => {
    const update = () => setSnap(rec.snapshot());
    const unsub = rec.subscribe(update);
    const tick = setInterval(update, 1000);
    update();
    return () => { unsub(); clearInterval(tick); };
  }, [rec]);
  return snap;
}
