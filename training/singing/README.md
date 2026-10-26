# training/singing — data preparation for the singing voice

Python scripts that prepare training data for the singer instrument (see
`docs/singing-voice-plan.md`). **No audio is ever committed**: everything is written under
`data/` (git-ignored). Python ≥ 3.10; `pip install -r requirements.txt`.

| Step | Script | Notes |
| --- | --- | --- |
| 1 | `fetch_common_voice.py` | Mozilla Common Voice ja (CC0). Uses a dataset archive you downloaded yourself, or the official Mozilla Data Collective SDK (`datacollective`) with **your own** key (`MDC_API_KEY`); see the Japanese section below. Never re-host the audio; never try to identify speakers. |
| 2 | `fetch_tsukuyomi.md` | Manual download (terms require agreeing on the site). Pretraining only — the released model must not be able to speak in her voice. |
| 3 | `ita_recording_list.py` + `consent_template.md` | Own recordings of the ITA corpus script (public domain), with written consent for AI training and redistribution. |
| 4 | `preprocess.py` | Resample to 44.1 kHz mono, loudness-normalize, mel extraction (VocaTab-compatible: 128 bins, hop 256, n_fft 2048), alignment hook. |

Models trained from these must be released under MIT, CC0-1.0 or CC-BY-4.0 only
(`SINGER_MODEL_LICENSES` in `src/singer/model.ts`).

## S2: PyTorch で音響モデルを学習する（Mac / DGX Spark）

`train_torch.py` は特徴量 → 帯域エンベロープの音響モデルを学習し、既存ランタイムがそのまま読める ONNX（入力 `features`、出力 `envelope`）とマニフェスト（sha256 付き）を `~/.cache/jinglescript/singer/<name>/` に書き出します。デバイスは自動選択（cuda > mps > cpu）、`--device` で上書きできます。重みや音声はコミットしないでください。

### MacBook Pro（Apple Silicon, MPS）— 普段はこちら

```sh
python3 -m venv ~/.venvs/singer && source ~/.venvs/singer/bin/activate
pip install -r training/singing/requirements-train.txt   # PyPI の torch は MPS 対応
python training/singing/train_torch.py --data placeholder --tiny   # 動作確認（数秒〜十数秒）
PYTORCH_ENABLE_MPS_FALLBACK=1 python training/singing/train_torch.py --data <データ> --name my-singer
```

MPS 未対応の演算が出た場合は `PYTORCH_ENABLE_MPS_FALLBACK=1` で CPU にフォールバックします。

### NVIDIA DGX Spark（CUDA, aarch64）— 重い学習用

NGC の PyTorch コンテナ（`nvcr.io/nvidia/pytorch`）を使うのが確実です。venv の場合は CUDA 版 wheel を入れてから requirements を入れます：

```sh
pip install torch --index-url https://download.pytorch.org/whl/cu128
pip install -r training/singing/requirements-train.txt
python training/singing/train_torch.py --data <データ> --name my-singer --device cuda --batch 64
```

学習後、`~/.cache/jinglescript/singer/my-singer/` フォルダごと描画するマシンの同じ場所へコピーします（例：`rsync -a spark:~/.cache/jinglescript/singer/my-singer ~/.cache/jinglescript/singer/`）。

### データの用意

録音（wav）・音素ラベル（.lab）・F0（.f0.npy）を特徴量／エンベロープのペアに変換します：

```sh
python training/singing/to_envelope_dataset.py <入力フォルダ> <出力フォルダ>
python training/singing/train_torch.py --data <出力フォルダ>
```

使えるのは商用利用可能なライセンスのデータのみです（JSUT・JVS・きりたん等は不可）。

### 描画とポスト処理

```sh
node scripts/sing-demo.ts out.wav my-singer --post
```

`--post`（API では `post: true`）で §5 のボーカルチェーン（`src/singer/post.ts`）を通します。

## Common Voice の取得（Mozilla Data Collective の API キー）

1. https://mozilladatacollective.com でアカウントを作成する。
2. https://mozilladatacollective.com/profile/credentials で API キーを発行する。
3. キーを環境変数か `.env` に置く：`MDC_API_KEY=...`（`.env` はコミットしない）。
4. Web 上で Common Voice 日本語データセットのページを開き、**利用規約に同意する**（同意しないと API は 403 を返す）。
5. 同じページの「Connect API」からデータセットの ID かスラッグをコピーする。
6. 実行：

```sh
pip install -r training/singing/requirements-train.txt   # datacollective SDK を含む
python training/singing/fetch_common_voice.py --dataset <ID またはスラッグ>
```

スクリプトはまずデータセットのライセンスを確認し、CC0 以外なら中止します。SDK の内部では `POST https://mozilladatacollective.com/api/datasets/{id}/download`（`Authorization: Bearer <キー>`）が署名付き URL を返し、そこからダウンロードします。**ダウンロードは 1 日 30 回まで**です。CC0 でも生の音声を再配布（リホスト）せず、話者の特定も試みないこと。出力は `data/` 以下にとどめ、公開するのは学習済みの重みだけです。テストはモックで行います：`python training/singing/test_fetch_common_voice.py`
