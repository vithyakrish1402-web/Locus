import { useRef, useCallback, useEffect } from 'react';
import { hasNativeAlertSound, playAlertSound, stopAlertSound } from '../utils/alertSound';

// Two-tone alternating klaxon, ~1s per full cycle (two 500ms tones). One
// persistent sawtooth oscillator with its frequency stepped on an interval,
// rather than starting/stopping a fresh oscillator every tone — that clicks/pops
// audibly on every transition; a single continuously-running oscillator with
// discrete frequency steps doesn't.
const TONE_LOW_HZ = 440;
const TONE_HIGH_HZ = 880;
const TONE_INTERVAL_MS = 500; // half of the ~1s full cycle

// On a phone the same klaxon plays natively instead (utils/alertSound.js): on the alarm stream,
// at full alarm volume, so a low media volume or silent mode cannot quieten an SOS. The Web Audio
// klaxon below is what plays everywhere else, and on a phone whose app cannot play it natively.

export function useAlertAudio() {
  const ctxRef = useRef(null);
  const oscRef = useRef(null);
  const gainRef = useRef(null);
  const intervalRef = useRef(null);
  const nativeRef = useRef(false); // the native klaxon was asked for and not stopped since

  const stop = useCallback(() => {
    if (nativeRef.current) {
      nativeRef.current = false;
      stopAlertSound();
    }
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

  const startWeb = useCallback(() => {
    if (ctxRef.current) return; // already running
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    const ctx = new AudioContext();
    // This is started by an incoming socket event, not a tap, so browser autoplay
    // policy can bring the context up 'suspended' — and a suspended context is
    // silent. Nudge it awake; if the policy still refuses, the rejection is
    // swallowed (nothing else we can do without a gesture).
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
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

  const start = useCallback(() => {
    if (ctxRef.current || nativeRef.current) return; // already running
    if (!hasNativeAlertSound()) {
      startWeb();
      return;
    }
    nativeRef.current = true;
    // The native klaxon could not play (no sound file, no audio focus): the Web Audio one does.
    playAlertSound('sos').then((playing) => {
      if (!playing && nativeRef.current) {
        nativeRef.current = false;
        startWeb();
      }
    });
  }, [startWeb]);

  // Belt-and-suspenders: stop the klaxon if the component unmounts without an
  // explicit stop() call (e.g. incomingSos cleared by something other than the
  // Acknowledge button in a future change).
  useEffect(() => stop, [stop]);

  return { start, stop };
}
