"""Tiny marimba synth: each note = tuned bar modes (1x, ~3.93x, ~9.2x) with their own decays + a short mallet click,
summed with a little room reverb. Writes demo jingles for ハテナマルモ."""
import numpy as np, sys, wave
SR = 48000
rng = np.random.default_rng(1)
def midi(n): return 440.0 * 2 ** ((n - 69) / 12)
NOTE = {n: i for i, n in enumerate("C C# D D# E F F# G G# A A# B".split())}
def m(name):  # "C5" -> midi
    return 12 * (int(name[-1]) + 1) + NOTE[name[:-1]]
def bar(note, vel=1.0, dur=2.5):
    f = midi(m(note)); t = np.arange(int(SR * dur)) / SR
    low = 1.0 + max(0.0, (60 - m(note)) / 24)            # lower bars ring longer
    s = (1.00 * np.exp(-t / (0.42 * low)) * np.sin(2*np.pi*f*t)
       + 0.35 * np.exp(-t / (0.09 * low)) * np.sin(2*np.pi*f*3.93*t)
       + 0.12 * np.exp(-t / 0.035) * np.sin(2*np.pi*f*9.2*t))
    click = rng.standard_normal(int(SR * 0.006)) * np.hanning(int(SR * 0.006)) * 0.25
    s[:len(click)] += np.convolve(click, np.ones(12) / 12, "same")
    s *= np.minimum(1, t / 0.0015)                       # soft mallet onset
    return vel * s
def render(events, length):
    out = np.zeros((int(SR * length), 2))
    for t0, notes, vel, pan in events:
        for n in notes.split():
            s = bar(n, vel); i = int(t0 * SR); e = min(len(out), i + len(s))
            out[i:e, 0] += s[:e-i] * (1 - pan) ; out[i:e, 1] += s[:e-i] * pan
    ir_t = np.arange(int(SR * 0.9)) / SR                 # small room
    ir = rng.standard_normal(len(ir_t)) * np.exp(-ir_t / 0.18) * 0.012; ir[0] = 1.0
    for ch in range(2): out[:, ch] = np.convolve(out[:, ch], ir)[:len(out)]
    fade = np.ones(len(out)); k = int(SR * 0.4); fade[-k:] = np.linspace(1, 0, k)
    out *= fade[:, None]
    return out / np.max(np.abs(out)) * 0.89
def save(path, x):
    w = wave.open(path, "wb"); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((x * 32767).astype("<i2").tobytes()); w.close()
E = 60 / 130 / 2   # eighth note at 130 BPM ≈ 0.231 s
S = E / 2          # sixteenth
# A: ハ・テ・ナ？(rising, ends open) ・ マ・ル・モ！(resolves, hit at 1.50 s)
A = [(0.00, "G4", .8, .4), (E, "C5", .85, .5), (2*E, "E5 G5", .9, .6),
     (4*E - 0.06, "D5", .8, .5), (4*E + 0.10, "B4", .75, .4), (1.50, "C5 E5 G5 C6", 1.0, .5), (1.50, "C3 G3", .9, .5),
     (1.50 + 2*E, "C6", .35, .7)]
# B: fast run up like a question, then ハ・テ・ナ・マ・ル・モ on the hit
B = [(i * S, n, .7 + .04 * i, .3 + .06 * i) for i, n in enumerate("C5 D5 E5 G5 A5 C6".split())] + \
    [(6*S + .05, "B5", .8, .7), (1.50, "C5 E5 G5 C6", 1.0, .5), (1.50, "C3", .9, .5), (1.50 + E, "G5", .4, .6), (1.50 + 2*E, "C6", .4, .4)]
# C: question-and-answer, 3 + 3 notes on eighths, answer lands on beat with a two-note bounce (ぴょん・ぴょん)
C = [(0.00, "E5", .8, .6), (E, "G5", .85, .6), (2*E, "A5", .9, .7),          # ハ テ ナ？
     (3*E + .05, "G5", .5, .7),
     (0.92, "C5", .8, .4), (0.92 + E, "D5", .8, .4), (1.50, "C5 E5 G5 C6", 1.0, .5), (1.50, "C3 G3", .9, .5)]
for name, ev in [("A", A), ("B", B), ("C", C)]:
    save(f"jingle-{name}.wav", render(ev, 4.6))
print("ok")
