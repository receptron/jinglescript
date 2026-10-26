#!/usr/bin/env python3
"""Turn aligned recordings into the training pairs train_torch.py reads.

Input folder (from preprocess.py + an aligner): <id>.wav (44.1 kHz mono), <id>.lab ("start end
phoneme" in seconds) and <id>.f0.npy (Hz per 256-sample hop, 0 = unvoiced).
Output: <id>.features.npy (frames × (phonemes+3)) and <id>.envelope.npy (frames × 32), using the
same analysis and features as tiny_placeholder.py, so the runtime vocoder can invert them.
"""
import argparse
from pathlib import Path

import numpy as np
import soundfile as sf

from tiny_placeholder import HOP, PHONEMES, SR, analyse, features


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("src", type=Path)
    ap.add_argument("out", type=Path)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    for wav in sorted(args.src.glob("*.wav")):
        ident = wav.stem
        audio, sr = sf.read(wav, dtype="float64")
        if sr != SR or audio.ndim != 1:
            raise SystemExit(f"{wav}: need {SR} Hz mono (run preprocess.py first)")
        env = analyse(audio)
        f0 = np.load(args.src / f"{ident}.f0.npy")
        spans = [line.split() for line in (args.src / f"{ident}.lab").read_text().splitlines() if line.strip()]
        rows = []
        for i in range(len(env)):
            t = i * HOP / SR
            span = next((s for s in spans if float(s[0]) <= t < float(s[1])), None)
            ph = span[2] if span and span[2] in PHONEMES else "pau"
            pos = 0.0 if span is None else (t - float(span[0])) / max(1e-6, float(span[1]) - float(span[0]))
            hz = float(f0[i]) if i < len(f0) else 0.0
            rows.append(features(ph, hz, hz > 0, pos))
        np.save(args.out / f"{ident}.features.npy", np.array(rows, np.float32))
        np.save(args.out / f"{ident}.envelope.npy", env.astype(np.float32))
        print(ident, len(env), "frames")


if __name__ == "__main__":
    main()
