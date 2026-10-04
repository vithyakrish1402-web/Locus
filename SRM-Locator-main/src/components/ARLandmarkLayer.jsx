import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import ARTag from './ARTag';
import { LandmarkAnchorEngine } from '../utils/landmarkAnchorEngine';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const nextFrame = (fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(fn, 16));
const cancelFrame = (id) => (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(id) : clearTimeout(id));
// The pending wake-up: an animation frame or a timer, cancelled by its own kind.
const cancelWake = (wake) => {
  if (wake?.frame !== undefined) cancelFrame(wake.frame);
  if (wake?.timer !== undefined) clearTimeout(wake.timer);
};

// AR Scan's tags: a pure renderer of the Landmark Anchor Engine. It hands the engine its
// inputs, runs a frame whenever they change, and keeps running frames only while a tag is
// still gliding or a focus change is due, so a phone held still draws nothing. Each frame
// re-renders this layer alone, never the rest of AR Scan.
//
// `landmarks` and `position` go to setLandmarks/setPosition; `view` is frame()'s input
// ({ q, hFovDeg, width, height, targetId }). `frameRef.current` always holds the latest
// frame, for ALIGN and the debug overlay.
const ARLandmarkLayer = ({ landmarks, position, view, frameRef }) => {
  const engineRef = useRef(null);
  engineRef.current ??= new LandmarkAnchorEngine();
  const viewRef = useRef(view);
  const [frame, setFrame] = useState(null);
  const loopRef = useRef(null);

  const runFrame = () => {
    loopRef.current = null;
    const result = engineRef.current.frame({ ...viewRef.current, nowMs: now() });
    if (frameRef) frameRef.current = result;
    setFrame(result);
    if (!result.settled) loopRef.current = { frame: nextFrame(runFrame) };
    else if (result.pendingMs !== null) loopRef.current = { timer: setTimeout(runFrame, result.pendingMs + 1) };
  };

  // Synchronously on each change, so a new tag is in place before the screen paints.
  useLayoutEffect(() => {
    engineRef.current.setLandmarks(landmarks);
  }, [landmarks]);
  useLayoutEffect(() => {
    engineRef.current.setPosition(position);
  }, [position]);
  useLayoutEffect(() => {
    viewRef.current = view;
    cancelWake(loopRef.current);
    runFrame();
    // runFrame reads everything through refs; re-running on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, landmarks, position]);
  useEffect(() => () => cancelWake(loopRef.current), []);

  if (!frame || !(view.width > 0) || !(view.height > 0)) return null;
  return frame.tags.map((t) => (
    <ARTag
      key={t.id}
      name={t.labelName}
      distanceText={t.distanceText}
      x={(t.screenX / view.width) * 100}
      y={(t.screenY / view.height) * 100}
      variant={t.kind}
      edge={t.offscreenSide}
      focused={t.focused}
      occluded={t.occluded}
      opacity={t.opacity}
      scale={t.scale}
      tickPx={t.tickPx}
    />
  ));
};

export default ARLandmarkLayer;
