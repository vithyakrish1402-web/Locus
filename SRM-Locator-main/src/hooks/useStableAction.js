import { useCallback, useLayoutEffect, useRef } from 'react';

// Memoized children keep their handlers across compass and telemetry renders,
// while actions always use the latest committed location and navigation state.
export function useStableAction(action) {
  const latest = useRef(action);
  useLayoutEffect(() => { latest.current = action; });
  return useCallback((...args) => latest.current(...args), []);
}
