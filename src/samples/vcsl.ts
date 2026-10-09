// Where the sampled grand piano comes from: the Versilian Community Sample Library (VCSL), CC0
// (public domain: no attribution, no restrictions), pinned to one commit. Only the first
// PREFIX_SECONDS of each file are downloaded (an HTTP range request) — a note never rings longer —
// and checked against the SHA-256 recorded in the catalog. Shared by the loader and
// scripts/write-sample-catalog.ts, which writes the catalog.

export const VCSL_REPO = "sgossner/VCSL";
export const VCSL_COMMIT = "c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e";
/** Steinway B, pedal up, close mics: every whole tone from A#0 to G#7, velocity layers 2–4. */
export const PIANO_DIR = "Chordophones/Zithers/Grand Piano, Steinway B/NoSus";
export const PIANO_FILE = /^JHPiano_NoSus_Close_([A-G]#?-?\d)_vl(\d)_rr1\.wav$/;
/** Seconds of each sample that are downloaded and kept. */
export const PREFIX_SECONDS = 4.5;
/** Names the cache folder: a new commit or prefix length is a new folder, never a mix. */
export const PIANO_SET = `vcsl-${VCSL_COMMIT.slice(0, 12)}-steinway-b-${PREFIX_SECONDS}s`;

export function vcslUrl(path: string): string {
  return `https://raw.githubusercontent.com/${VCSL_REPO}/${VCSL_COMMIT}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * One sample: the sampled pitch ("A#0"), the VCSL velocity layer (2 soft to 4 loud), the bytes
 * downloaded (the header and the first PREFIX_SECONDS of audio), their SHA-256 in hex, and how
 * many cents the recording is from equal temperament (a piano's stretch tuning: flat in the bass,
 * sharp at the top), measured by the catalog script so the instrument can play it in tune.
 */
export type CatalogRow = readonly [pitch: string, layer: number, bytes: number, sha256: string, cents: number];

export interface CatalogEntry {
  pitch: string;
  layer: number;
  /** File name within PIANO_DIR. */
  file: string;
  bytes: number;
  sha256: string;
  cents: number;
}

export function pianoFile(pitch: string, layer: number): string {
  return `JHPiano_NoSus_Close_${pitch}_vl${layer}_rr1.wav`;
}
