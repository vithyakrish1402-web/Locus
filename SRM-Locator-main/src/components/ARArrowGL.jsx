import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSpring } from 'framer-motion';
import ARArrow3D from './ARArrow3D';

// AR Scan's 'realistic' arrow: a three.js render on a transparent canvas laid over the
// whole camera view, drawn where the ring (`ringRef`) is.
//
// three.js is loaded here, with a dynamic import(), and nowhere else, so it is only ever
// fetched once 'realistic' is chosen. Until it has loaded, or if WebGL is unavailable,
// ARCompass keeps showing the CSS arrow: `onStatus` reports 'ready' or 'failed'.
//
// `rotation` is AR Scan's wraparound-safe angle, eased by the same spring as the CSS
// arrow (`spring`), so both point and move alike. A frame is drawn only when the eased
// angle or the layout changes, never in a constant loop. Unmounting (AR Scan closing, or
// the mode changing) disposes the scene and releases the WebGL context.
const ARArrowGL = ({ rotation, spring, ringRef, onStatus }) => {
  const canvasRef = useRef(null);
  const eased = useSpring(rotation, { stiffness: spring.stiffness, damping: spring.damping });
  const onStatusRef = useRef(onStatus);
  useEffect(() => {
    onStatusRef.current = onStatus;
  }, [onStatus]);

  useEffect(() => {
    eased.set(rotation);
  }, [eased, rotation]);

  useEffect(() => {
    let cancelled = false;
    let view = null;
    const cleanups = [];

    import('../utils/arArrowScene.js')
      .then(({ createArrowView }) => {
        if (cancelled) return;
        const canvas = canvasRef.current;
        view = createArrowView(canvas);

        const layout = () => {
          const ring = ringRef.current;
          const width = canvas.clientWidth || window.innerWidth;
          const height = canvas.clientHeight || window.innerHeight;
          const box = ring ? ring.getBoundingClientRect() : null;
          const origin = canvas.getBoundingClientRect();
          const cx = box ? box.left + box.width / 2 - origin.left : width / 2;
          const cy = box ? box.top + box.height / 2 - origin.top : height / 2;
          view.setView({ width, height, cx, cy, pixelRatio: window.devicePixelRatio || 1 });
          view.render();
        };
        view.setRotation(eased.get());
        layout();

        cleanups.push(eased.on('change', (deg) => {
          view.setRotation(deg);
          view.render();
        }));
        window.addEventListener('resize', layout);
        cleanups.push(() => window.removeEventListener('resize', layout));
        if (typeof ResizeObserver !== 'undefined' && ringRef.current) {
          const observer = new ResizeObserver(layout);
          observer.observe(ringRef.current);
          cleanups.push(() => observer.disconnect());
        }
        onStatusRef.current?.('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[SYS_AR] Realistic arrow unavailable, keeping the standard one.', err);
        view?.dispose();
        view = null;
        onStatusRef.current?.('failed');
      });

    return () => {
      cancelled = true;
      cleanups.forEach((fn) => fn());
      view?.dispose();
      view = null;
    };
  }, [eased, ringRef]);

  return (
    <canvas
      ref={canvasRef}
      data-testid="ar-arrow-gl"
      className="absolute inset-0 w-full h-full pointer-events-none z-[22]"
      aria-hidden="true"
    />
  );
};

export default ARArrowGL;

// What sits in the ring in 'realistic' mode: the CSS arrow until the three.js one is
// drawing (and for good, if WebGL is unavailable), plus the three.js canvas, placed into
// the AR screen's root (`overlayEl`) so it covers the camera view. It can't sit in the
// ring itself: the ring's backdrop blur makes it the box that even a fixed child is
// placed in. Its state starts over each time 'realistic' is chosen, since changing mode
// unmounts it.
export function RealisticArrow({ rotation, spring, ringRef, overlayEl }) {
  const [status, setStatus] = useState('loading');
  return (
    <>
      {status !== 'ready' && <ARArrow3D rotation={rotation} transition={spring} />}
      {overlayEl && status !== 'failed' &&
        createPortal(<ARArrowGL rotation={rotation} spring={spring} ringRef={ringRef} onStatus={setStatus} />, overlayEl)}
    </>
  );
}
