// The grand piano's samples by key, from the catalog: what each loader needs to fetch and check one.
import { PIANO_CATALOG } from "./piano-catalog.ts";
import { sampleKey } from "./source.ts";
import { PIANO_DIR, PIANO_SET, pianoFile, type CatalogEntry } from "./vcsl.ts";

export interface PianoSample extends CatalogEntry {
  key: string;
  /** Path within the VCSL repository. */
  vcslPath: string;
}

export const PIANO_SAMPLES: ReadonlyMap<string, PianoSample> = new Map(
  PIANO_CATALOG.map(([pitch, layer, bytes, sha256, cents]): [string, PianoSample] => {
    const file = pianoFile(pitch, layer);
    const key = sampleKey(PIANO_SET, file);
    return [key, { pitch, layer, file, bytes, sha256, cents, key, vcslPath: `${PIANO_DIR}/${file}` }];
  }),
);
