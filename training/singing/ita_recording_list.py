#!/usr/bin/env python3
"""Writes the recording list for our own voice from the ITA corpus script (public domain).

The script text comes from https://github.com/mmorise/ita-corpus (emotion + recitation sets).
Only the text is used; the official character recordings of ITA (e.g. ずんだもん) are NOT used —
most are non-commercial. Output: data/ita/recording_list.tsv with id, text, and a blank `take`
column for the session sheet.
"""
from __future__ import annotations

import argparse
import urllib.request
from pathlib import Path

BASE = "https://raw.githubusercontent.com/mmorise/ita-corpus/main/"
FILES = ["emotion_transcript_utf8.txt", "recitation_transcript_utf8.txt"]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=Path(__file__).resolve().parent / "data" / "ita")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    lines = []
    for name in FILES:
        with urllib.request.urlopen(BASE + name, timeout=30) as r:  # small text files
            for raw in r.read().decode("utf-8").splitlines():
                ident, _, rest = raw.partition(":")
                text = rest.split(",")[0]
                if ident and text:
                    lines.append(f"{ident}\t{text}\t\n")
    (args.out / "recording_list.tsv").write_text("id\ttext\ttake\n" + "".join(lines), encoding="utf-8")
    print(f"{len(lines)} sentences → {args.out / 'recording_list.tsv'}")


if __name__ == "__main__":
    main()
