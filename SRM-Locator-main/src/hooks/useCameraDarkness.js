import { useEffect, useState } from 'react';
import { NOT_DARK, SAMPLE_EVERY_MS, SAMPLE_H, SAMPLE_W, meanLuma, nextDarkness } from '../utils/arDarkness';

// Whether AR Scan's camera view is too dark for its labels (utils/arDarkness.js has the
// rule). Once a second, while `active`, it draws the current video frame shrunk into one
// reused 16 x 12 canvas, reads those 192 pixels' brightness, and forgets them: no frame is
// kept, and nothing leaves the phone (the canvas is never turned into an image or a file).
//
// Kept cheap for a mid-range phone: the browser does the shrinking as part of drawing, the
// read-back is 768 bytes, it runs once a second (not per frame), and it pauses while the
// app is in the background or AR Scan's camera is off.
//
// Anything that goes wrong (no canvas, the video not playing yet, a read refused) counts as
// "not dark", so a failure never hides anything. Turning `active` off also resets it, so a
// covered lens can't leave the labels hidden after the camera stops.
export function useCameraDarkness(videoRef, active) {
  const [state, setState] = useState(NOT_DARK);

  useEffect(() => {
    if (!active) return undefined;
    let canvas = null;
    let ctx = null;
    const sample = () => {
      try {
        if (typeof document !== 'undefined' && document.hidden) return null;
        const video = videoRef.current;
        if (!video || video.readyState < 2 || !video.videoWidth) return null;
        if (!canvas) {
          canvas = document.createElement('canvas');
          canvas.width = SAMPLE_W;
          canvas.height = SAMPLE_H;
          ctx = canvas.getContext('2d');
        }
        if (!ctx) return null;
        ctx.drawImage(video, 0, 0, SAMPLE_W, SAMPLE_H);
        return meanLuma(ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data);
      } catch {
        return null;
      }
    };
    const id = setInterval(() => {
      const luma = sample();
      setState((prev) => {
        const next = nextDarkness(prev, luma);
        return next.dark === prev.dark && next.run === prev.run ? prev : next;
      });
    }, SAMPLE_EVERY_MS);
    return () => {
      clearInterval(id);
      canvas = null;
      ctx = null;
      setState(NOT_DARK);
    };
  }, [videoRef, active]);

  return active && state.dark;
}
