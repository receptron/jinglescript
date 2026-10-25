# つくよみちゃんコーパス (Tsukuyomi-chan corpus) — manual fetch

1. Read the terms at https://tyc.rei-yumesaki.net/material/corpus/ and agree to them yourself.
2. Download the corpus archive from that page and unpack it to `training/singing/data/tsukuyomi/`.
3. Run `python preprocess.py --input data/tsukuyomi --out data/features/tsukuyomi --speaker pretrain`.

Policy (agreed for jinglescript): this corpus is used **only in pretraining**, mixed with
Common Voice, under the terms' case ① (no restriction when the resulting model does not speak in
Tsukuyomi-chan's voice). Therefore:

- never fine-tune the released voice on it, and never ship a speaker embedding for it;
- the released model must be fine-tuned on our own consented recordings, and checked by listening
  (by the user) that it does not sound like her;
- record which corpus version was used in the model card. Re-verify the terms before each release.

No file from the corpus is ever committed.
