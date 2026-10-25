# training/singing — data preparation for the singing voice

Python scripts that prepare training data for the singer instrument (see
`docs/singing-voice-plan.md`). **No audio is ever committed**: everything is written under
`data/` (git-ignored). Python ≥ 3.10; `pip install -r requirements.txt`.

| Step | Script | Notes |
| --- | --- | --- |
| 1 | `fetch_common_voice.py` | Mozilla Common Voice ja (CC0). Uses a dataset archive you downloaded yourself, or the Mozilla Data Collective API with **your own** key (`MDC_API_KEY`). Never re-host the audio; never try to identify speakers. |
| 2 | `fetch_tsukuyomi.md` | Manual download (terms require agreeing on the site). Pretraining only — the released model must not be able to speak in her voice. |
| 3 | `ita_recording_list.py` + `consent_template.md` | Own recordings of the ITA corpus script (public domain), with written consent for AI training and redistribution. |
| 4 | `preprocess.py` | Resample to 44.1 kHz mono, loudness-normalize, mel extraction (VocaTab-compatible: 128 bins, hop 256, n_fft 2048), alignment hook. |

Models trained from these must be released under MIT, CC0-1.0 or CC-BY-4.0 only
(`SINGER_MODEL_LICENSES` in `src/singer/model.ts`).
