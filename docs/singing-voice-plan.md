# 歌声楽器（singer）計画

jinglescript に日本語の歌声楽器を追加するための設計と計画。**コードは MIT、重みは MIT / CC0 /
CC-BY、生成した歌声は誰でも自由に使える**ことを条件とする。このPRは下準備（計画・データ準備・
TypeScript の土台）で、まだ歌わない。

> PLAN.md の方針「No samples, no API, no model」とは異なる追加になる。singer は**オプション楽器**
> とし、既定のレンダリング・依存関係・決定性の保証には一切影響させない。採用するかはユーザー判断（Open question）。

## 1. アーキテクチャ

wavtechyukky/vocatab（コード MIT）の構成に倣う。

```
score の音符 + 歌詞（1音符1モーラ）
  └─ src/singer/kana.ts      かな → 音素
  └─ src/singer/frames.ts    フレーム列（音素区間・ベースラインF0、規則ベース）
  └─ PitchModel   (任意)     PrettyPitch 相当：F0・タイミングの補正
  └─ AcousticModel           LeapSinger 相当：音素+F0 → メル（128bin, hop 256, 44.1kHz）
  └─ Vocoder                 NHVSing 相当：メル+F0 → PCM
  └─ 既存のエフェクト・ミックスへ
```

- 推論は ONNX。Node では `onnxruntime-node` を **optionalな依存**として動的 import（未導入なら
  `SingerRuntimeMissingError` で導入方法を案内）。ブラウザ版は後で `onnxruntime-web`。
- vocatab の `ui/src/engine-web/*.ts` を移植する場合は MIT 表記（著作権者名とライセンス文）を
  ファイル先頭と THIRD_PARTY に残す。`growl()`（hifisampler 由来、Apache-2.0）は移植しない。
- **vocatab の voicebank / vocoder の重みは使わない・同梱しない・ダウンロードもしない**（非商用・再配布禁止）。

## 2. データとライセンス

| データ | ライセンス / 規約 | 用途 | 注意 |
| --- | --- | --- | --- |
| Mozilla Common Voice 日本語 | CC0-1.0（＋利用条件） | 事前学習 | 生音声の再配布禁止・話者特定の試み禁止。スクリプトで各自ダウンロード、リポジトリに入れない |
| つくよみちゃんコーパス | 独自規約（①の場合「制限なし」） | 事前学習のみ | 公開モデルが彼女の声で話せないこと。話者埋め込みを配布しない。リリース前に規約再確認 |
| ITAコーパス台本 | パブリックドメイン | 自前収録の台本 | 公式キャラクター収録（ずんだもん等）は使わない |
| 自前収録（読み上げ・任意で歌） | 同意書で AI学習・再配布を許諾 | 最終の声 | `training/singing/consent_template.md` |
| PJS（歌声） | CC BY-SA 4.0 | 使うなら別モデル | 重みが CC BY-SA になるため既定では使わない |

使わないもの：Suno、NEUTRINO、Synthesizer V、ACE Studio、クラウドTTSの出力（いずれも学習禁止）、
JSUT / JVS（非商用）、VocaTab の歌声モデル、Style-Bert-VITS2 の事前学習モデル（AGPL）。

公開する重みのライセンスは `SINGER_MODEL_LICENSES`（MIT / CC0-1.0 / CC-BY-4.0）に限り、
manifest の検証で強制する。

## 3. 学習手順

1. `training/singing/fetch_common_voice.py`：公式配布物（自分で取得したアーカイブ、または各自の
   Mozilla Data Collective API キー）から validated クリップの manifest を作る。
2. つくよみちゃんコーパスを手動取得（`fetch_tsukuyomi.md`）。
3. `preprocess.py`：44.1kHz モノラル化、-23 LUFS 正規化、ログメル・F0 抽出、音素アライメント（フック）。
4. 事前学習：話し声（Common Voice + つくよみ）で音響モデルとボコーダー。話者は区別しない。
5. 自前収録（ITA 読み上げ＋少量の歌）で微調整。歌声データがあれば歌らしさが大きく上がる。
6. ONNX へ書き出し、`manifest.json`（ライセンス、クレジット、sha256、音素表）を作る。
7. 公開（例：Hugging Face または receptron のリポジトリ）。モデルカードにデータ出典と同意の有無を記載。
8. **聴感確認はユーザー**（CLAUDE.md）。測定値（NaN/Inf、ピーク、ラウドネス、DC、クリック）だけを報告する。

## 4. ランタイム統合

- モデルは `~/.cache/jinglescript/singer/<name>/`（`$JINGLESCRIPT_CACHE` 等、grandpiano と同じ規則）。
  初回利用時にダウンロードし sha256 を検証（未実装、`src/samples/fetch-sample.ts` を再利用予定）。
- モデルがなければ `SingerModelMissingError`（置き場所と対処を LLM が読める文で返す）。
- **決定性**：かな→音素、フレーム配置、ベースライン F0 は決定的（`src/dsp/math.ts` 経由）。
  ONNX 推論の浮動小数点結果は CPU・スレッド数・ORT のバージョンで変わりうるため、singer を含む
  スコアは「ビット一致」の保証対象外とし、ゴールデンテストは singer 抜きで行う。
  単一スレッド・固定 ORT バージョンで同一マシン上の再現性のみ保証する方針。ドキュメントと
  `jinglescript instruments` の出力にも明記する。
- **スコア**：既存の `lyric`（音符ごとの歌詞、`_` で伸ばし）をそのまま使い、楽器 `"singer"` の
  トラックでは各音符の歌詞を1モーラのかな（`ー`/`_` で伸ばし、空で休符）として歌う。
  スキーマ変更は楽器名の追加と、必要なら `voice`（モデル名）オプションのみ。
- 既定の `render()` にはまだ接続しない。`src/singer/` は単独のモジュールで、パッケージの公開 API も変えていない。

## 5. マイルストーン

| # | 内容 | 状態 |
| --- | --- | --- |
| S0 | 計画、データ準備スクリプト、TS の土台（かな→音素、フレーム、manifest、ORT の遅延読込） | このPR |
| S1 | vocatab engine-web の推論部を移植（MIT 表記）、ダミー ONNX で配線テスト | |
| S2 | 事前学習（Common Voice + つくよみ）、アライナー選定 | |
| S3 | 自前収録（同意書）と微調整、最初の公開モデル（CC0 または MIT） | |
| S4 | `render()` への統合、スキーマ、モデルのダウンロード、`instruments` 表示 | |
| S5 | ブラウザ版（onnxruntime-web）、LLM 評価に歌詞入りの課題を追加 | |

## 6. 未決事項（ユーザー判断）

- PLAN.md の「no model」方針の例外として singer を認めるか。
- 重みのライセンス（CC0 / MIT / CC-BY）と公開場所。
- 歌い手（自分か協力者か）と歌唱データの量。
- 規約の原文確認（Common Voice / Mozilla Data Collective、つくよみちゃん）。法的助言ではない。
