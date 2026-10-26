#!/usr/bin/env python3
"""Resample, loudness-normalize and extract mel features for the singer's training data.

Features match the runtime (src/singer, VocaTab-compatible): 44.1 kHz mono, n_fft 2048, hop 256,
128 mel bins, fmin 40, fmax 16000, log-mel; F0 by pYIN on the same hop.

Phoneme alignment is a hook: --align selects a backend that writes data/.../<id>.lab
(start end phoneme, seconds). Only "none" is built in; plug in a forced aligner (e.g. Montreal
Forced Aligner with a Japanese dictionary, or a model trained in this project) via ALIGNERS.
"""
from __future__ import annotations

import argparse
from pathlib import Path
from typing import Callable

import numpy as np

SR = 44100
N_FFT = 2048
HOP = 256
MELS = 128
FMIN, FMAX = 40.0, 16000.0
TARGET_LUFS = -23.0


def load(path: Path) -> np.ndarray:
    import librosa

    audio, _ = librosa.load(path, sr=SR, mono=True)
    return audio


def normalize(audio: np.ndarray) -> np.ndarray:
    import pyloudnorm

    meter = pyloudnorm.Meter(SR)
    loudness = meter.integrated_loudness(audio)
    if not np.isfinite(loudness):
        return audio
    out = pyloudnorm.normalize.loudness(audio, loudness, TARGET_LUFS)
    peak = float(np.max(np.abs(out))) or 1.0
    return out / max(1.0, peak / 0.99)


def features(audio: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    import librosa

    mel = librosa.feature.melspectrogram(y=audio, sr=SR, n_fft=N_FFT, hop_length=HOP, n_mels=MELS, fmin=FMIN, fmax=FMAX)
    log_mel = np.log(np.clip(mel, 1e-5, None)).T.astype(np.float32)  # frames × mels
    f0, voiced, _ = librosa.pyin(audio, fmin=60, fmax=1100, sr=SR, frame_length=N_FFT, hop_length=HOP)
    f0 = np.where(voiced, f0, 0.0).astype(np.float32)[: len(log_mel)]
    return log_mel, f0


def align_none(_audio_path: Path, _text: str, _out: Path) -> None:
    return None


ALIGNERS: dict[str, Callable[[Path, str, Path], None]] = {"none": align_none}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--manifest", type=Path, help="TSV of audio path<TAB>text (e.g. from fetch_common_voice.py)")
    parser.add_argument("--input", type=Path, help="or a folder of audio files (text from same-named .txt)")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--speaker", default="pretrain", help="speaker label; pretraining corpora share one label")
    parser.add_argument("--align", choices=sorted(ALIGNERS), default="none")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    if args.manifest:
        items = [tuple(line.rstrip("\n").split("\t", 1)) for line in args.manifest.read_text(encoding="utf-8").splitlines() if line]
    elif args.input:
        items = [(str(p), p.with_suffix(".txt").read_text(encoding="utf-8").strip() if p.with_suffix(".txt").exists() else "")
                 for p in sorted(args.input.rglob("*")) if p.suffix.lower() in {".wav", ".mp3", ".flac"}]
    else:
        parser.error("--manifest or --input is required")
    if args.limit:
        items = items[: args.limit]

    import soundfile

    args.out.mkdir(parents=True, exist_ok=True)
    with open(args.out / "index.tsv", "w", encoding="utf-8") as index:
        for i, (path, text) in enumerate(items):
            audio = normalize(load(Path(path)))
            mel, f0 = features(audio)
            ident = f"{args.speaker}_{i:06d}"
            soundfile.write(args.out / f"{ident}.wav", audio, SR)
            np.save(args.out / f"{ident}.mel.npy", mel)
            np.save(args.out / f"{ident}.f0.npy", f0)
            ALIGNERS[args.align](args.out / f"{ident}.wav", text, args.out / f"{ident}.lab")
            index.write(f"{ident}\t{args.speaker}\t{text}\n")
    print(f"{len(items)} items → {args.out}")


if __name__ == "__main__":
    main()
