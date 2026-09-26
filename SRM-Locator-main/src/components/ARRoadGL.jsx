import React, { useEffect, useRef } from 'react';

// AR Scan's 'realistic' road line: a three.js render on a transparent canvas over the
// camera view, in the Stage 3 ribbon's place (under the HUD and the tags). It has a
// canvas and a WebGL context of its own because the arrow's canvas has to sit above the
// HUD, and the road below it. ARCompass mounts it only while there is a road, so the
// context exists only then.
//
// three.js is loaded here with a dynamic import(), the same one-off download the arrow
// uses. Until it has loaded, or if WebGL is unavailable, ARCompass keeps drawing the
// Stage 3 ribbon: `onStatus` reports 'ready' or 'failed', and 'loading' again on unmount.
//
// `strip` is buildRoadStrip's output, rebuilt by ARCompass whenever the position or the
// route changes; `heading` is the same fused heading the tags use, so they turn together.
// A frame is drawn only when one of them or the layout changes, never in a loop.
const ARRoadGL = ({ strip, heading, onStatus }) => {
  const canvasRef = useRef(null);
  const viewRef = useRef(null);
  const latest = useRef({ strip, heading });
  latest.current = { strip, heading };
  const onStatusRef = useRef(onStatus);
  useEffect(() => {
    onStatusRef.current = onStatus;
  }, [onStatus]);

  useEffect(() => {
    let cancelled = false;
    let view = null;
    const cleanups = [];

    import('../utils/arRoadScene.js')
      .then(({ createRoadView }) => {
        if (cancelled) return;
        const canvas = canvasRef.current;
        view = createRoadView(canvas);
        viewRef.current = view;

        const layout = () => {
          const width = canvas.clientWidth || window.innerWidth;
          const height = canvas.clientHeight || window.innerHeight;
          view.setView({ width, height, pixelRatio: window.devicePixelRatio || 1 });
          view.render();
        };
        view.setRoad(latest.current.strip);
        view.setHeading(latest.current.heading);
        layout();
        // The canvas can change size without a window resize (it fills the AR screen, not
        // the window), and a drawing buffer left at the old size is stretched to fit,
        // putting the road off where the tags are. So watch the canvas itself too.
        window.addEventListener('resize', layout);
        cleanups.push(() => window.removeEventListener('resize', layout));
        if (typeof ResizeObserver !== 'undefined') {
          const observer = new ResizeObserver(layout);
          observer.observe(canvas);
          cleanups.push(() => observer.disconnect());
        }
        onStatusRef.current?.('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[SYS_AR] Realistic road line unavailable, keeping the standard one.', err);
        view?.dispose();
        view = null;
        viewRef.current = null;
        onStatusRef.current?.('failed');
      });

    return () => {
      cancelled = true;
      cleanups.forEach((fn) => fn());
      view?.dispose();
      view = null;
      viewRef.current = null;
      onStatusRef.current?.('loading');
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.setRoad(strip);
    view.render();
  }, [strip]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.setHeading(heading);
    view.render();
  }, [heading]);

  return (
    <canvas
      ref={canvasRef}
      data-testid="ar-road-gl"
      className="absolute inset-0 w-full h-full pointer-events-none z-[15]"
      aria-hidden="true"
    />
  );
};

export default ARRoadGL;
