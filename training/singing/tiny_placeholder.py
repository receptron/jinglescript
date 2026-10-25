"""Tiny placeholder singer (milestone S1): proves score -> ONNX -> WAV works on CPU, no GPU.

Data: NOT a recording of anyone. The "corpus" is generated here by textbook formant synthesis
(vowel formants after Japanese vowel measurements; consonants as shaped noise), so it carries no
third-party rights and is released CC0 by receptron. It sounds robotic on purpose: the point is the
pipeline (corpus -> analysis -> training -> ONNX -> jinglescript), not the voice. Real data (Common
Voice JA, ITA recordings) replaces it in S2+.

Pipeline: synthesize clips -> STFT analysis to per-band log power (the same analysis the runtime
vocoder inverts) -> train a 2-layer MLP (numpy, Adam) from (phoneme, F0, voicing, position) to the
band envelope -> export acoustic.onnx + manifest.json into ~/.cache/jinglescript/singer/<name>/.

    python3 -m venv .venv && .venv/bin/pip install numpy onnx
    .venv/bin/python training/singing/tiny_placeholder.py
"""
import hashlib, json, os, sys
import numpy as np
import onnx
from onnx import helper, numpy_helper, TensorProto

NAME = "tiny-placeholder"
SR, HOP, NFFT, BANDS = 44100, 256, 1024, 32
FMAX = 11025.0
PHONEMES = ["pau", "a", "i", "u", "e", "o", "N", "cl", "k", "g", "s", "z", "t", "d", "n", "h", "b", "p", "m",
            "y", "r", "w", "ky", "gy", "sh", "j", "ch", "ny", "hy", "by", "py", "my", "ry", "ts", "f", "v"]
VOWEL_F = {"a": (800, 1250, 2600), "i": (300, 2300, 3000), "u": (350, 1350, 2400), "e": (500, 1900, 2600),
           "o": (500, 850, 2500), "N": (280, 1100, 2400)}
# Consonant: (noise centre Hz, noise bandwidth Hz, voiced, formants while voiced or None)
CONS = {"k": (2200, 1500, False, None), "g": (2000, 1500, True, (350, 1600, 2500)), "s": (6500, 3000, False, None),
        "z": (6000, 3000, True, (300, 1500, 2500)), "t": (4000, 2500, False, None), "d": (3000, 2000, True, (300, 1700, 2600)),
        "n": (0, 0, True, (280, 1500, 2500)), "h": (1500, 3000, False, None), "b": (800, 800, True, (300, 900, 2300)),
        "p": (1000, 1500, False, None), "m": (0, 0, True, (280, 1000, 2300)), "y": (0, 0, True, (300, 2200, 2900)),
        "r": (0, 0, True, (400, 1400, 2300)), "w": (0, 0, True, (350, 800, 2300)), "sh": (3800, 2000, False, None),
        "j": (3500, 2000, True, (300, 2000, 2700)), "ch": (3800, 2000, False, None), "ts": (5500, 3000, False, None),
        "f": (1800, 3500, False, None), "v": (2500, 3000, True, (300, 1100, 2400)), "cl": (0, 0, False, None),
        "pau": (0, 0, False, None)}
for c in ["ky", "gy", "ny", "hy", "by", "py", "my", "ry"]:
    base = CONS[c[0]]
    CONS[c] = (base[0] + 800 if base[0] else 0, base[1], base[2], (300, 2200, 2900) if base[2] else None)
CONS["hy"] = (3200, 1800, False, None)


def formant_env(freqs, formants):
    env = np.zeros_like(freqs)
    for k, f in enumerate(formants):
        bw = 80 + 0.08 * f
        env += (1.0 / (1 + k)) / (1 + ((freqs - f) / bw) ** 2)
    return env * 1.0 / (1 + freqs / 3000)  # spectral tilt


def synth(ph, f0, n, rng):
    t = np.arange(n) / SR
    out = np.zeros(n)
    voiced = ph in VOWEL_F or CONS.get(ph, (0, 0, False, None))[2]
    formants = VOWEL_F.get(ph) or (CONS[ph][3] if ph in CONS else None)
    if voiced and formants:
        amp_scale = 0.3 if ph not in VOWEL_F else 1.0
        for k in range(1, int(FMAX / f0)):
            a = formant_env(np.array([k * f0]), formants)[0] * amp_scale
            out += a * np.sin(2 * np.pi * k * f0 * t + rng.uniform(0, 2 * np.pi))
    centre, bw = (CONS[ph][0], CONS[ph][1]) if ph in CONS else (0, 0)
    if centre:
        spec = np.fft.rfft(rng.standard_normal(n))
        fr = np.fft.rfftfreq(n, 1 / SR)
        spec *= 0.15 / (1 + ((fr - centre) / bw) ** 2)
        out += np.fft.irfft(spec, n)
    return out.astype(np.float64), bool(voiced)


def analyse(x):
    """Per-frame band log power, the exact inverse of src/singer/vocoder.ts."""
    w = np.hanning(NFFT + 1)[:NFFT]
    frames = []
    edges = np.linspace(0, FMAX, BANDS + 1)
    fr = np.fft.rfftfreq(NFFT, 1 / SR)
    for s in range(0, len(x) - NFFT, HOP):
        p = np.abs(np.fft.rfft(x[s:s + NFFT] * w)) ** 2 / np.sum(w ** 2)
        frames.append([np.log(np.mean(p[(fr >= edges[b]) & (fr < edges[b + 1])]) + 1e-10) for b in range(BANDS)])
    return np.array(frames)


def features(ph, f0, voiced, pos):
    v = np.zeros(len(PHONEMES) + 3, dtype=np.float32)
    v[PHONEMES.index(ph)] = 1
    v[-3] = np.log2(f0 / 440.0) if voiced and f0 > 0 else 0
    v[-2] = 1.0 if voiced else 0.0
    v[-1] = pos
    return v


def main():
    rng = np.random.default_rng(0)
    X, Y = [], []
    for ph in PHONEMES:
        for midi in range(52, 81, 2):
            f0 = 440 * 2 ** ((midi - 69) / 12)
            x, voiced = synth(ph, f0, SR // 4, rng) if ph not in ("pau", "cl") else (np.zeros(SR // 4), False)
            env = analyse(x)
            for i, e in enumerate(env):
                X.append(features(ph, f0, voiced, i / max(1, len(env) - 1)))
                Y.append(e)
    X, Y = np.array(X, np.float32), np.array(Y, np.float32)
    print(f"corpus: {len(PHONEMES)} phonemes, {len(X)} frames")
    H = 96
    W1 = rng.standard_normal((X.shape[1], H)) * 0.3; b1 = np.zeros(H)
    W2 = rng.standard_normal((H, H)) * 0.1; b2 = np.zeros(H)
    W3 = rng.standard_normal((H, BANDS)) * 0.1; b3 = Y.mean(0).astype(np.float64)
    params = [W1, b1, W2, b2, W3, b3]
    m = [np.zeros_like(p) for p in params]; v = [np.zeros_like(p) for p in params]
    lr = 3e-3
    for step in range(1, 4001):
        idx = rng.integers(0, len(X), 512)
        x, y = X[idx], Y[idx]
        h1 = np.tanh(x @ W1 + b1); h2 = np.tanh(h1 @ W2 + b2); out = h2 @ W3 + b3
        g = 2 * (out - y) / len(x)
        gW3 = h2.T @ g; gb3 = g.sum(0)
        g2 = (g @ W3.T) * (1 - h2 ** 2); gW2 = h1.T @ g2; gb2 = g2.sum(0)
        g1 = (g2 @ W2.T) * (1 - h1 ** 2); gW1 = x.T @ g1; gb1 = g1.sum(0)
        for i, gr in enumerate([gW1, gb1, gW2, gb2, gW3, gb3]):
            m[i] = 0.9 * m[i] + 0.1 * gr; v[i] = 0.999 * v[i] + 0.001 * gr ** 2
            params[i] -= lr * (m[i] / (1 - 0.9 ** step)) / (np.sqrt(v[i] / (1 - 0.999 ** step)) + 1e-8)
        if step % 1000 == 0:
            print(f"step {step} mse {np.mean((out - y) ** 2):.3f}")

    inits = [numpy_helper.from_array(p.astype(np.float32), n) for p, n in zip(params, ["W1", "b1", "W2", "b2", "W3", "b3"])]
    nodes = [helper.make_node("MatMul", ["features", "W1"], ["m1"]), helper.make_node("Add", ["m1", "b1"], ["a1"]),
             helper.make_node("Tanh", ["a1"], ["h1"]), helper.make_node("MatMul", ["h1", "W2"], ["m2"]),
             helper.make_node("Add", ["m2", "b2"], ["a2"]), helper.make_node("Tanh", ["a2"], ["h2"]),
             helper.make_node("MatMul", ["h2", "W3"], ["m3"]), helper.make_node("Add", ["m3", "b3"], ["envelope"])]
    graph = helper.make_graph(nodes, "tiny_acoustic",
                              [helper.make_tensor_value_info("features", TensorProto.FLOAT, ["frames", X.shape[1]])],
                              [helper.make_tensor_value_info("envelope", TensorProto.FLOAT, ["frames", BANDS])], inits)
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 13)])
    model.ir_version = 8
    onnx.checker.check_model(model)
    cache = os.environ.get("JINGLESCRIPT_CACHE") or os.path.join(os.environ.get("XDG_CACHE_HOME") or os.path.expanduser("~/.cache"), "jinglescript")
    folder = os.path.join(cache, "singer", NAME)
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, "acoustic.onnx")
    onnx.save(model, path)
    digest = hashlib.sha256(open(path, "rb").read()).hexdigest()
    manifest = {"name": NAME, "version": "0.0.1", "license": "CC0-1.0",
                "credit": "Placeholder: trained only on formant-synthesized clips made by training/singing/tiny_placeholder.py (no recordings).",
                "sampleRate": SR, "hopSize": HOP, "melBins": BANDS, "phonemes": PHONEMES,
                "envelope": {"kind": "band-log-power", "fftSize": NFFT, "maxHz": FMAX},
                "files": {"acoustic": "acoustic.onnx"}, "sha256": {"acoustic.onnx": digest}}
    json.dump(manifest, open(os.path.join(folder, "manifest.json"), "w"), indent=2)
    print("wrote", folder)


if __name__ == "__main__":
    sys.exit(main())
