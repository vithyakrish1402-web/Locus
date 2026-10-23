"""Writes the two native alert sounds (android/app/src/main/res/raw), matching the Web Audio
ones they replace on a phone: the SOS klaxon (hooks/useAlertAudio.js: a sawtooth stepping
between 440 and 880 Hz every 500 ms; one 1 s cycle, looped by the player) and the ping blip
(App.jsx playSonarPing: a sine sweeping 880 -> 440 Hz over 0.1 s, fading out over 0.5 s).
Run from SRM-Locator-main: python scripts/make-alert-sounds.py"""
import math, struct, wave

RATE = 22050
OUT = 'android/app/src/main/res/raw/'

def write(name, samples):
    with wave.open(OUT + name, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
        w.writeframes(b''.join(struct.pack('<h', int(max(-1, min(1, s)) * 32000)) for s in samples))

def klaxon():
    out, phase = [], 0.0
    for i in range(RATE):  # one second: 0.5 s at 440 Hz, 0.5 s at 880 Hz
        f = 440 if i < RATE // 2 else 880
        phase = (phase + f / RATE) % 1.0
        out.append(0.6 * (2 * phase - 1))
    return out

def ping():
    out, phase, n = [], 0.0, int(RATE * 0.5)
    for i in range(n):
        t = i / RATE
        f = 880 * (0.5 ** min(1.0, t / 0.1))  # exponential 880 -> 440 over 0.1 s
        phase += 2 * math.pi * f / RATE
        gain = 0.9 * (0.01 / 0.9) ** (t / 0.5)  # exponential fade, as the Web Audio ramp
        out.append(gain * math.sin(phase))
    return out

write('locus_klaxon.wav', klaxon())
write('locus_ping.wav', ping())
print('wrote', OUT + 'locus_klaxon.wav', OUT + 'locus_ping.wav')
