"""Melody A on piano, organ, music box (improved), piccolo, trumpet. Sustained instruments get note lengths
(until the next onset, final chord held 1.6 s)."""
import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from marimba import SR, midi, m, E, A, save
rng = np.random.default_rng(3)
T = lambda d: np.arange(int(SR * d)) / SR
def env_adsr(n, a, d, s, r, hold):
    t = np.arange(n) / SR; e = np.where(t < a, t / a, np.where(t < a + d, 1 - (1 - s) * (t - a) / d, s))
    rel = t > hold; e[rel] *= np.exp(-(t[rel] - hold) / r); return e
def piano(note, v, hold):
    f = midi(m(note)); t = T(3.0); B = 0.0004; s = np.zeros_like(t)
    for k in range(1, 12):
        fk = k * f * np.sqrt(1 + B * k * k)
        if fk > SR / 2.2: break
        amp = (1 / k) ** 1.1 * (1.2 if k == 2 else 1)
        for det in (-0.6, 0.0, 0.7):   # three strings, slight beating
            s += amp / 3 * (0.7 * np.exp(-t / (0.35 / k ** 0.5)) + 0.3 * np.exp(-t / (2.5 / k ** 0.4))) * np.sin(2*np.pi*(fk + det)*t)
    n = int(SR * .005); s[:n] += rng.standard_normal(n) * np.hanning(n) * .3
    return v * s * np.minimum(1, t / .002)
def organ(note, v, hold):
    f = midi(m(note)); t = T(hold + .5)
    bars = [(0.5, .5), (1, 1), (2, .7), (3, .45), (4, .35), (6, .15)]   # drawbars 16' 8' 4' 2⅔' 2' 1⅓'
    s = sum(a * np.sin(2*np.pi*f*r*t) for r, a in bars if f * r < SR / 2.2)
    s *= 1 + 0.08 * np.sin(2*np.pi*6.2*t)                                 # rotary-ish wobble
    n = int(SR * .003); s[:n] += rng.standard_normal(n) * .4             # key click
    return v * .45 * s * env_adsr(len(t), .008, .05, .9, .06, hold)
def musicbox(note, v, hold):
    f = midi(m(note)) * 2; t = T(2.5)                                      # an octave up, tiny comb tines
    s = (np.exp(-t/1.1)*np.sin(2*np.pi*f*t) + .3*np.exp(-t/.15)*np.sin(2*np.pi*f*5.4*t) + .08*np.exp(-t/.04)*np.sin(2*np.pi*f*13.1*t))
    n = int(SR * .0025); s[:n] += rng.standard_normal(n) * .5               # pin pluck tick
    return v * s * np.minimum(1, t / .0008)
def piccolo(note, v, hold):
    f = midi(m(note)) * 2; t = T(hold + .3)
    vib = 1 + 0.006 * np.sin(2*np.pi*5.5*t) * np.clip((t - .12) / .2, 0, 1)
    ph = 2*np.pi*np.cumsum(f * vib) / SR
    s = np.sin(ph) + .18*np.sin(2*ph) + .05*np.sin(3*ph)
    breath = np.convolve(rng.standard_normal(len(t)), np.ones(6)/6, "same") * .06
    return v * .7 * (s + breath) * env_adsr(len(t), .035, .05, .85, .06, hold)
def trumpet(note, v, hold):
    f = midi(m(note)); t = T(hold + .3)
    scoop = 1 - 0.03 * np.exp(-t / .03)                                     # lip scoop into pitch
    vib = 1 + 0.004 * np.sin(2*np.pi*5.2*t) * np.clip((t - .15) / .2, 0, 1)
    ph = 2*np.pi*np.cumsum(f * scoop * vib) / SR
    e = env_adsr(len(t), .025, .08, .8, .07, hold)
    bright = 0.35 + 0.65 * e                                                # brighter when louder
    s = sum((bright ** (k - 1)) / k ** 0.7 * np.sin(k * ph) for k in range(1, 14) if f * k < SR / 2.2)
    return v * .35 * s * e
def holds(events):
    starts = sorted({t for t, *_ in events}); out = {}
    for i, t0 in enumerate(starts): out[t0] = (starts[i+1] - t0) * .92 if i + 1 < len(starts) else 1.6
    return out
def render(events, inst, length=4.6, octave_down_for=None):
    H = holds(events); out = np.zeros((int(SR * length), 2))
    for t0, notes, vel, pan in events:
        for n in notes.split():
            s = inst(n, vel, H[t0]); i = int(t0 * SR); e = min(len(out), i + len(s))
            out[i:e, 0] += s[:e-i] * (1 - pan); out[i:e, 1] += s[:e-i] * pan
    ir_t = np.arange(int(SR * 1.0)) / SR; ir = rng.standard_normal(len(ir_t)) * np.exp(-ir_t / .25) * .014; ir[0] = 1
    for ch in range(2): out[:, ch] = np.convolve(out[:, ch], ir)[:len(out)]
    k = int(SR * .4); out[-k:] *= np.linspace(1, 0, k)[:, None]
    return out / np.max(np.abs(out)) * .89
# piccolo / trumpet: melody line only (drop the low bass notes of the final chord, keep top voices)
lead = [(t, " ".join(n for n in ns.split() if int(n[-1]) >= 4), v, p) for t, ns, v, p in A]
lead = [e for e in lead if e[1]]
for name, inst, ev in [("piano", piano, A), ("organ", organ, A), ("musicbox2", musicbox, A),
                       ("piccolo", piccolo, lead), ("trumpet", trumpet, lead)]:
    save(f"A-{name}.wav", render(ev, inst)); print(name)
