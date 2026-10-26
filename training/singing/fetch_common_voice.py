#!/usr/bin/env python3
"""Prepare Mozilla Common Voice Japanese (CC0-1.0) for pretraining.

Two routes, both through Mozilla's official distribution:

  1. --archive PATH      a cv-corpus-*-ja.tar.gz you downloaded yourself (accepting Mozilla's terms).
  2. --dataset ID|SLUG   download with the official Mozilla Data Collective SDK (`pip install datacollective`).
                         Needs your own key in MDC_API_KEY (environment or .env) and the dataset terms
                         accepted on the web first, otherwise the API answers 403. 30 downloads per day.

The dataset's license is checked before downloading: only CC0 is accepted.

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


def is_cc0(details: object) -> bool:
    """True when the dataset details name CC0 (licenseAbbreviation or license)."""
    get = details.get if isinstance(details, dict) else lambda k: getattr(details, k, None)
    text = " ".join(str(get(k) or "") for k in ("licenseAbbreviation", "license")).upper().replace("-", "")
    return "CC0" in text


def download_via_sdk(dataset: str, out: Path) -> Path:
    """Check the license, then download the archive with the official SDK. Returns the archive path."""
    try:
        from datacollective import download_dataset, get_dataset_details
    except ImportError:
        sys.exit("pip install datacollective (see requirements-train.txt)")
    if not os.environ.get("MDC_API_KEY") and not Path(".env").exists():
        sys.exit("Set MDC_API_KEY (environment or .env). Create one at https://mozilladatacollective.com/profile/credentials")
    details = get_dataset_details(dataset)
    if not is_cc0(details):
        lic = getattr(details, "licenseAbbreviation", None) or getattr(details, "license", None)
        sys.exit(f"Refusing {dataset}: license is {lic!r}, only CC0 is allowed.")
    return Path(download_dataset(dataset, download_directory=str(out)))


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
    source.add_argument("--dataset", help="MDC dataset ID or slug (from Connect API on the dataset page)")
    parser.add_argument("--out", type=Path, default=DATA)
    parser.add_argument("--min-up-votes", type=int, default=2)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    archive = download_via_sdk(args.dataset, args.out) if args.dataset else args.archive
    root = extract(archive, args.out)
    print(f"{write_manifest(root, args.out, args.min_up_votes)} clips → {args.out / 'manifest.tsv'}")


if __name__ == "__main__":
    main()
