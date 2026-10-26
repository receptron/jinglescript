#!/usr/bin/env python3
"""S2 acoustic-model training in PyTorch: cuda > mps > cpu, exported to ONNX for src/singer.

Unlike tiny_placeholder.py's per-frame MLP, this model sees context (dilated 1-D convolutions over
the frame sequence, ~0.4 s receptive field at the default size), which is what lets transitions and
consonant–vowel coarticulation sound less robotic once real recordings are used.

The ONNX contract is unchanged, so the runtime needs no change:
  input  "features" [frames, phonemes+3]   output "envelope" [frames, 32]   (band log power)

    # placeholder corpus (CC0, self-generated), tiny config: proves the path on any machine
    python train_torch.py --data placeholder --tiny
    # real data prepared with to_envelope_dataset.py
    python train_torch.py --data path/to/pairs --name my-voice --license CC0-1.0 --credit "..."
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import time
from pathlib import Path

import numpy as np
import torch
from torch import nn

import tiny_placeholder as tp


def pick_device(requested: str) -> torch.device:
    if requested != "auto":
        return torch.device(requested)
    if torch.cuda.is_available():
        return torch.device("cuda")
    if getattr(torch.backends, "mps", None) is not None and torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


class Acoustic(nn.Module):
    def __init__(self, inputs: int, bands: int, channels: int, layers: int):
        super().__init__()
        self.inp = nn.Conv1d(inputs, channels, 1)
        self.blocks = nn.ModuleList(
            nn.Sequential(nn.Conv1d(channels, channels, 3, padding=2**i, dilation=2**i), nn.GELU(), nn.Conv1d(channels, channels, 1))
            for i in range(layers)
        )
        self.norms = nn.ModuleList(nn.GroupNorm(1, channels) for _ in range(layers))
        self.out = nn.Conv1d(channels, bands, 1)

    def forward(self, features: torch.Tensor) -> torch.Tensor:  # [frames, D] -> [frames, B]
        x = self.inp(features.t().unsqueeze(0))
        for block, norm in zip(self.blocks, self.norms):
            x = x + block(norm(x))
        return self.out(x).squeeze(0).t()


def placeholder_sequences(rng: np.random.Generator, count: int, frames: int):
    """Random phoneme strings rendered by tiny_placeholder's formant synthesizer, as sequences."""
    singable = [p for p in tp.PHONEMES if p not in ("pau", "cl")]
    out = []
    for _ in range(count):
        midi = rng.integers(52, 80)
        f0 = 440 * 2 ** ((midi - 69) / 12)
        feats, envs, audio = [], [], []
        while sum(len(a) for a in audio) < (frames + 4) * tp.HOP + tp.NFFT:
            ph = str(rng.choice(singable))
            n = int(rng.integers(6, 30)) * tp.HOP
            x, voiced = tp.synth(ph, f0, n, rng)
            audio.append(x)
            feats += [(ph, voiced, k / max(1, n // tp.HOP - 1)) for k in range(n // tp.HOP)]
        env = tp.analyse(np.concatenate(audio))[:frames]
        f = np.array([tp.features(ph, f0, v, pos) for ph, v, pos in feats[: len(env)]], np.float32)
        out.append((f, env.astype(np.float32)))
    return out


def folder_sequences(path: Path):
    pairs = []
    for feat in sorted(path.glob("*.features.npy")):
        env = np.load(str(feat).replace(".features.npy", ".envelope.npy"))
        f = np.load(feat)
        n = min(len(f), len(env))
        pairs.append((f[:n].astype(np.float32), env[:n].astype(np.float32)))
    if not pairs:
        raise SystemExit(f"{path}: no <id>.features.npy / <id>.envelope.npy pairs (see to_envelope_dataset.py)")
    return pairs


def export(model: nn.Module, inputs: int, folder: Path, manifest: dict) -> Path:
    model = model.to("cpu").eval()
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / "acoustic.onnx"
    dummy = torch.zeros(50, inputs)
    torch.onnx.export(model, (dummy,), str(path), input_names=["features"], output_names=["envelope"],
                      dynamic_axes={"features": {0: "frames"}, "envelope": {0: "frames"}}, opset_version=17, dynamo=False)
    # Check: ONNX Runtime agrees with PyTorch on a different length.
    import onnxruntime as ort
    probe = torch.randn(123, inputs)
    got = ort.InferenceSession(str(path)).run(["envelope"], {"features": probe.numpy()})[0]
    want = model(probe).detach().numpy()
    assert np.abs(got - want).max() < 1e-3, "ONNX export does not match PyTorch"
    manifest["sha256"] = {"acoustic.onnx": hashlib.sha256(path.read_bytes()).hexdigest()}
    (folder / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False))
    return path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="placeholder", help='"placeholder" or a folder of training pairs')
    ap.add_argument("--name", default="torch-placeholder")
    ap.add_argument("--license", default="CC0-1.0", choices=["MIT", "CC0-1.0", "CC-BY-4.0"])
    ap.add_argument("--credit", default="Placeholder: trained only on formant-synthesized clips (training/singing/tiny_placeholder.py).")
    ap.add_argument("--device", default="auto", help="auto (cuda > mps > cpu), cuda, mps or cpu")
    ap.add_argument("--tiny", action="store_true", help="smallest config, a minute on CPU")
    ap.add_argument("--steps", type=int)
    ap.add_argument("--channels", type=int)
    ap.add_argument("--layers", type=int)
    ap.add_argument("--segment", type=int, default=128, help="frames per training segment")
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--lr", type=float, default=2e-3)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()
    steps = args.steps or (200 if args.tiny else 20000)
    channels = args.channels or (32 if args.tiny else 256)
    layers = args.layers or (3 if args.tiny else 6)

    torch.manual_seed(args.seed)
    rng = np.random.default_rng(args.seed)
    device = pick_device(args.device)
    print(f"device: {device}")
    data = placeholder_sequences(rng, 40 if args.tiny else 400, args.segment) if args.data == "placeholder" else folder_sequences(Path(args.data))
    inputs = data[0][0].shape[1]
    print(f"data: {len(data)} sequences, {sum(len(f) for f, _ in data)} frames, {inputs} inputs")
    model = Acoustic(inputs, tp.BANDS, channels, layers).to(device)
    with torch.no_grad():
        model.out.bias.copy_(torch.tensor(np.concatenate([e for _, e in data]).mean(0)))
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, steps)
    start = time.time()
    for step in range(1, steps + 1):
        loss = torch.zeros((), device=device)
        for _ in range(args.batch):
            f, e = data[int(rng.integers(len(data)))]
            at = int(rng.integers(0, max(1, len(f) - args.segment)))
            x = torch.from_numpy(f[at : at + args.segment]).to(device)
            y = torch.from_numpy(e[at : at + args.segment]).to(device)
            loss = loss + nn.functional.l1_loss(model(x), y) / args.batch
        opt.zero_grad()
        loss.backward()
        opt.step()
        sched.step()
        if step % max(1, steps // 10) == 0:
            print(f"step {step}/{steps} l1 {loss.item():.3f} ({time.time() - start:.0f}s)")

    cache = Path(os.environ.get("JINGLESCRIPT_CACHE") or Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache") / "jinglescript")
    folder = cache / "singer" / args.name
    manifest = {"name": args.name, "version": "0.1.0", "license": args.license, "credit": args.credit,
                "sampleRate": tp.SR, "hopSize": tp.HOP, "melBins": tp.BANDS, "phonemes": tp.PHONEMES,
                "envelope": {"kind": "band-log-power", "fftSize": tp.NFFT, "maxHz": tp.FMAX},
                "files": {"acoustic": "acoustic.onnx"}}
    print("wrote", export(model, inputs, folder, manifest))


if __name__ == "__main__":
    main()
