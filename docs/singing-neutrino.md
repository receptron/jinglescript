# NEUTRINO で歌わせる（Node のみ）

JingleScript の歌詞付きトラックを、利用者が自分でインストールした [NEUTRINO](https://studio-neutrino.com/)（無料の歌声合成ソフト）で歌わせられます。JingleScript には NEUTRINO 本体も歌声ライブラリも含まれていません。ダウンロードもしません。

## インストール（自分で行ってください）

1. https://studio-neutrino.com/downloads/ から NEUTRINO（macOS は Apple Silicon 版）をダウンロードし、利用許諾契約書に同意します。
2. zip を展開し、`NEUTRINO` フォルダを `/Applications` に置きます（または好きな場所に置いて `NEUTRINO_DIR` 環境変数で指定）。
3. 探す順番は `NEUTRINO_DIR` → `/Applications/NEUTRINO` → `~/.cache/jinglescript/neutrino` です。
4. macOS で初回に「開発元を確認できない」と出る場合は、NEUTRINO 付属の `Run.sh` と同じく `xattr -dr com.apple.quarantine <NEUTRINO>/bin` を自分で実行してください。

NEUTRINO のフォルダには何も書き込みません。中間ファイルは `~/.cache/jinglescript/neutrino-renders/work-*` に作って消し（`NEUTRINO_KEEP_WORK=1` で残せます）、できた WAV は楽譜・声・オプション・NEUTRINO のバージョンから作ったハッシュで `~/.cache/jinglescript/neutrino-renders/` にキャッシュします（同じ楽譜の 2 回目はすぐ終わります）。

## 使い方

```ts
import { renderWithNeutrino } from "jinglescript/src/singer/index.ts";

const result = await renderWithNeutrino(score, {
  track: 0, // 歌詞（かな）付きのトラック
  voice: "reina", // model/ 以下のフォルダ名（MERROW, NAKUMO, REINA, RUNO, SOMA。大文字小文字は区別しない）
  transpose: 0, // 半音単位で全体を上げる（NEUTRINO -f）
  styleShift: 0, // そのキー分上の歌い方で歌う（NEUTRINO -k、-5〜5 くらい）
  threads: 8, // CPU スレッド数（NEUTRINO -n、省略時は全コア）
  fallbackModel: "tiny-placeholder", // NEUTRINO が無いとき、警告を出してこの内蔵モデルで歌う
});
```

- 歌詞は 1 音符 1 モーラのかな（カタカナはひらがなに変換）。`ー` や `_` は前の母音を伸ばします。
- 0.1 秒未満の音符の隙間はつなげて歌い、それより長い隙間は休符（息継ぎ）になります。NEUTRINO は休符ごとにフレーズを区切るので、長いフレーズには休符を入れてください。
- 小節をまたぐ音符はタイでつなぎます。微分音（detune）は半音に丸めます。
- 48 kHz の出力を描画のサンプルレートに変換し、楽譜の 0 秒にそろえてから、ほかのトラックと一緒にミックスします。
- デモ：`node scripts/sing-neutrino-demo.ts [out.wav] [voice]`（既定は `~/Desktop/neutrino_demo.wav`）

ブラウザでは使えません（`child_process` を使うため）。`src/browser.ts` からは読み込まれません。

## 利用規約で気をつけること

NEUTRINO 本体の利用許諾契約書と、各歌声ライブラリの規約に従ってください。要点は以下のとおりです（正式な内容は原文を確認してください）。

- NEUTRINO はフリーウェアです。作った音声は、各歌声ライブラリの規約の範囲で使えます。付属の歌声なら商用利用もできます。
- 出力した音声や中間データを、AI の歌声合成、音声合成、声質変換の学習データに使うことは禁止です。声質変換の入力に使うことも禁止です。JingleScript の自前モデルの学習には絶対に使わないでください。
- 歌声ライブラリを、転移学習やファインチューニング、蒸留の元モデルに使うことも禁止です。
- 作った音声を、シンセサイザーやサンプルライブラリなど楽器の音源として配ることには、別途許諾が必要です。
- NEUTRINO の再配布はできません。アプリやサービスに組み込む場合は許諾が必要なことがあるので（[FAQ](https://studio-neutrino.com/faq/)）、事前に Studio NEUTRINO（support@studio-neutrino.com）に確認してください。

## 音量とタイミング

- 歌声は伴奏（他のトラック）よりラウドネスで `vocalLevel` LU（既定 `VOCAL_LEVEL_DB` = 4）大きくなるよう自動で調整されます。トラックの `gain` はそこからの増減、ベロシティは音符ごとの強弱としてそのまま効きます。`vocalLevel: null` で NEUTRINO の出力レベルのままになります。
- NEUTRINO は母音を拍の頭に置き、子音はその 50〜100 ms ほど前から歌います。曲の頭（0 秒）より前は切れるので、最初の音符の前に 1 拍ほど休符を置くと最初の子音まで聞こえます。
