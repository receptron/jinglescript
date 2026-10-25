#!/usr/bin/env python3
"""Prepare Mozilla Common Voice Japanese (CC0-1.0) for pretraining.

Two routes, both through Mozilla's official distribution:

  1. --archive PATH   a cv-corpus-*-ja.tar.gz you downloaded yourself (accepting Mozilla's terms).
  2. --api            download through the Mozilla Data Collective API with your own key:
                      MDC_API_KEY=... MDC_DATASET_ID=... python fetch_common_voice.py --api
                      (base URL overridable with MDC_API_BASE; check the current API docs first).

Terms that bind us even though the data is CC0: do not re-host or redistribute the raw clips, and
do not attempt to identify speakers. So the output stays under data/ and only derived model weights
are ever published. Nothing is downloaded unless you run it.
"""
from __future__ import annotations

import argparse
import csv
import os
import sys
import tarfile
from pathlib import Path

DATA = Path(__file__).resolve().parent / "data" / "common_voice_ja"


def download_via_api(out: Path) -> Path:
    import requests

    key = os.environ.get("MDC_API_KEY")
    dataset = os.environ.get("MDC_DATASET_ID")
    base = os.environ.get("MDC_API_BASE", "https://datacollective.mozillafoundation.org/api")
    if not key or not dataset:
        sys.exit("Set MDC_API_KEY and MDC_DATASET_ID (your own Mozilla Data Collective account), or use --archive.")
    headers = {"Authorization": f"Bearer {key}"}
    # The endpoint shape is an assumption to verify against Mozilla's current docs before use.
    meta = requests.post(f"{base}/datasets/{dataset}/download", headers=headers, timeout=60)
    meta.raise_for_status()
    url = meta.json().get("downloadUrl")
    if not url:
        sys.exit(f"No downloadUrl in the API response: {meta.text[:200]}")
    target = out / "cv-ja.tar.gz"
    with requests.get(url, stream=True, timeout=60) as r:
        r.raise_for_status()
        with open(target, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
    return target


def extract(archive: Path, out: Path) -> Path:
    with tarfile.open(archive) as tar:
        tar.extractall(out, filter="data")
    found = sorted(out.rglob("validated.tsv"))
    if not found:
        sys.exit("validated.tsv not found in the archive")
    return found[0].parent


def write_manifest(root: Path, out: Path, min_up_votes: int) -> int:
    """Validated clips with no down votes → manifest.tsv (path, sentence). Speaker ids are dropped."""
    rows = 0
    with open(root / "validated.tsv", newline="", encoding="utf-8") as src, open(out / "manifest.tsv", "w", encoding="utf-8") as dst:
        for row in csv.DictReader(src, delimiter="\t", quoting=csv.QUOTE_NONE):
            if int(row.get("up_votes") or 0) < min_up_votes or int(row.get("down_votes") or 0) > 0:
                continue
            dst.write(f"{root / 'clips' / row['path']}\t{row['sentence']}\n")
            rows += 1
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--archive", type=Path)
    source.add_argument("--api", action="store_true")
    parser.add_argument("--out", type=Path, default=DATA)
    parser.add_argument("--min-up-votes", type=int, default=2)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    archive = download_via_api(args.out) if args.api else args.archive
    root = extract(archive, args.out)
    print(f"{write_manifest(root, args.out, args.min_up_votes)} clips → {args.out / 'manifest.tsv'}")


if __name__ == "__main__":
    main()
