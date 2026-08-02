import { useRef, useCallback, useEffect } from 'react';

// Two-tone alternating klaxon, ~420ms per full cycle (two ~210ms tones). One
// persistent sawtooth oscillator with its frequency stepped on an interval,
// rather than starting/stopping a fresh oscillator every tone — that clicks/pops
// audibly on every transition; a single continuously-running oscillator with
// discrete frequency steps doesn't.
const TONE_LOW_HZ = 440;
const TONE_HIGH_HZ = 880;
const TONE_INTERVAL_MS = 210; // half of the ~420ms full cycle

export function useAlertAudio() {
  const ctxRef = useRef(null);
  const oscRef = useRef(null);
  const gainRef = useRef(null);
  const intervalRef = useRef(null);

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (oscRef.current) {
      try { oscRef.current.stop(); } catch { /* already stopped */ }
      oscRef.current.disconnect();
      oscRef.current = null;
    }
    if (gainRef.current) {
      gainRef.current.disconnect();
      gainRef.current = null;
    }
    if (ctxRef.current) {
      ctxRef.current.close().catch(() => {});
      ctxRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    if (ctxRef.current) return; // already running
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(TONE_LOW_HZ, ctx.currentTime);
    gain.gain.setValueAtTime(0.15, ctx.currentTime); // klaxon runs continuously; kept quiet so it isn't jarring

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();

    ctxRef.current = ctx;
    oscRef.current = osc;
    gainRef.current = gain;

    let high = false;
    intervalRef.current = setInterval(() => {
      high = !high;
      osc.frequency.setValueAtTime(high ? TONE_HIGH_HZ : TONE_LOW_HZ, ctx.currentTime);
    }, TONE_INTERVAL_MS);
  }, []);

  // Belt-and-suspenders: stop the klaxon if the component unmounts without an
  // explicit stop() call (e.g. incomingSos cleared by something other than the
  // Acknowledge button in a future change).
  useEffect(() => stop, [stop]);

  return { start, stop };
}
