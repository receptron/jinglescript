"""Same melody (jingle A) on several synthesized instruments. Each instrument = a function note->samples."""
import numpy as np, wave
import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from marimba import SR, midi, m, bar as marimba, E, A, save
rng = np.random.default_rng(2)
def modal(note, vel, modes, dur=2.5, click=0.2):
    f = midi(m(note)); t = np.arange(int(SR * dur)) / SR
    s = sum(a * np.exp(-t / tau) * np.sin(2 * np.pi * f * r * t) for r, a, tau in modes)
    n = int(SR * 0.004); s[:n] += rng.standard_normal(n) * np.hanning(n) * click
    return vel * s * np.minimum(1, t / 0.001)
def xylophone(n, v):  return modal(n, v, [(1, 1, .18), (3.0, .5, .05), (6.1, .2, .02)], click=.35)
def glocken(n, v):    return modal(n, v, [(1, 1, 1.6), (2.76, .35, .4), (5.40, .15, .15), (8.93, .06, .06)], click=.08)
def musicbox(n, v):   return modal(n, v, [(1, 1, .9), (4.9, .25, .12), (12.3, .08, .03)], click=.15)
def vibraphone(n, v):
    s = modal(n, v, [(1, 1, 1.4), (4.0, .25, .25), (10.0, .06, .05)], click=.05)
    t = np.arange(len(s)) / SR; return s * (1 - 0.25 * (1 - np.cos(2 * np.pi * 5.5 * t)) / 2)
def ukulele(n, v, dur=2.2):   # Karplus-Strong plucked string
    f = midi(m(n)); N = int(SR / f); buf = rng.uniform(-1, 1, N); out = np.zeros(int(SR * dur))
    for i in range(len(out)):
        out[i] = buf[i % N]; buf[i % N] = 0.996 * 0.5 * (buf[i % N] + buf[(i + 1) % N])
    return v * out
def clap(v):
    s = np.zeros(int(SR * .25))
    for k, d in enumerate([0, .011, .022, .035]):
        n = int(SR * (.06 if k == 3 else .008)); i = int(SR * d)
        s[i:i+n] += rng.standard_normal(n) * np.exp(-np.arange(n) / (SR * (.02 if k == 3 else .003)))
    return v * np.convolve(s, [1, -0.6], "same") * 0.5
def render(events, inst, length=4.6, claps=()):
    out = np.zeros((int(SR * length), 2))
    def add(s, t0, pan):
        i = int(t0 * SR); e = min(len(out), i + len(s)); out[i:e, 0] += s[:e-i] * (1 - pan); out[i:e, 1] += s[:e-i] * pan
    for t0, notes, vel, pan in events:
        for n in notes.split(): add(inst(n, vel), t0, pan)
    for t0 in claps: add(clap(.6), t0, .5)
    ir_t = np.arange(int(SR * .9)) / SR; ir = rng.standard_normal(len(ir_t)) * np.exp(-ir_t / .2) * .012; ir[0] = 1
    for ch in range(2): out[:, ch] = np.convolve(out[:, ch], ir)[:len(out)]
    k = int(SR * .4); out[-k:] *= np.linspace(1, 0, k)[:, None]
    return out / np.max(np.abs(out)) * .89
both = lambda n, v: marimba(n, v) * .8 + glocken(n if int(n[-1]) >= 5 else n[:-1] + str(int(n[-1]) + 1), v) * .3
for name, inst, cl in [("xylophone", xylophone, ()), ("glockenspiel", glocken, ()), ("musicbox", musicbox, ()),
                       ("vibraphone", vibraphone, ()), ("ukulele", ukulele, ()), ("marimba-glocken-claps", both, (0.0, 2 * E, 1.50))]:
    save(f"A-{name}.wav", render(A, inst, claps=cl))
print("ok")
