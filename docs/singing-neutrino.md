# NEUTRINO で歌わせる（Node のみ）

JingleScript の歌詞付きトラックを、利用者が自分でインストールした [NEUTRINO](https://studio-neutrino.com/)（無料の歌声合成ソフト）で歌わせられます。JingleScript には NEUTRINO 本体も歌声ライブラリも含まれていません。ダウンロードもしません。

## インストール（自分で行ってください）

1. https://studio-neutrino.com/downloads/ から NEUTRINO（macOS は Apple Silicon 版）をダウンロードし、利用許諾契約書に同意します。
2. zip を展開し、`NEUTRINO` フォルダを `/Applications` に置きます（既定の場所は `/Applications/NEUTRINO`）。
3. 別の場所に置いたときは、プロジェクトのディレクトリ（コマンドを実行する場所）の `.env` に `NEUTRINO_DIR=/path/to/NEUTRINO` と書きます（`.env.example` 参照、`.env` は git に入りません）。同じ名前の環境変数があればそちらが優先です。
4. macOS で初回に「開発元を確認できない」と出る場合は、NEUTRINO 付属の `Run.sh` と同じく `xattr -dr com.apple.quarantine <NEUTRINO>/bin` を自分で実行してください。

NEUTRINO のフォルダには何も書き込みません。中間ファイルは `~/.cache/jinglescript/neutrino-renders/work-*` に作って消し（`NEUTRINO_KEEP_WORK=1` で残せます）、できた WAV は楽譜・声・オプション・NEUTRINO のバージョンから作ったハッシュで `~/.cache/jinglescript/neutrino-renders/` にキャッシュします（同じ楽譜の 2 回目はすぐ終わります）。キャッシュは描画のたびに整理し、30 日より古いものと、新しい順で 200 個を超えたものを消します。ただのキャッシュなので、`neutrino-renders/` フォルダはいつ消しても構いません。

**注意（セキュリティ）**：`NEUTRINO_DIR` はカレントディレクトリの `.env` から読み、そこにある実行ファイルを動かします。信頼できないリポジトリの中で `sing` のあるスコアを描画すると、その `.env` が指す任意のプログラムが実行されます。他人のチェックアウトでは `.env` を確認するか、環境変数 `NEUTRINO_DIR` を明示してください。

## 使い方

NEUTRINO を使うかどうかは、スコアだけで決まります。専用の API はありません。トラックに `sing` を書けば、いつもの `render()`・CLI・MCP（`renderScore`）がそのトラックを楽器の代わりに NEUTRINO で歌わせます（1 スコアにつき 1 トラック）。

### スコアの例（全体）

```json
{
  "format": "jinglescript/1",
  "title": "かえるのうた（冒頭）",
  "tempo": 100,
  "meter": "4/4",
  "length": { "beats": 10 },
  "tracks": [
    {
      "instrument": "organ",
      "name": "voice",
      "sing": { "engine": "neutrino", "voice": "reina", "level": 4 },
      "notes": [
        { "at": 1, "pitch": "C4", "len": 0.95, "lyric": "か" },
        { "at": 2, "pitch": "D4", "len": 0.95, "lyric": "え" },
        { "at": 3, "pitch": "E4", "len": 0.95, "lyric": "る" },
        { "at": 4, "pitch": "F4", "len": 0.95, "lyric": "の" },
        { "at": 5, "pitch": "E4", "len": 0.95, "lyric": "う" },
        { "at": 6, "pitch": "D4", "len": 0.95, "lyric": "た" },
        { "at": 7, "pitch": "C4", "len": 1.4, "lyric": "が" }
      ]
    },
    {
      "instrument": "vibraphone",
      "name": "vibes",
      "gain": 0.5,
      "notes": [
        { "at": 1, "pitch": ["C4", "E4", "G4"], "len": 3.8 },
        { "at": 5, "pitch": ["G3", "B3", "D4"], "len": 3.8 }
      ]
    }
  ]
}
```

```sh
npx jinglescript render kaeru.json   # CLI
```

```ts
import { parseScore, render } from "jinglescript";
const result = await render(parseScore(json)); // sing のあるトラックは NEUTRINO で歌う
```

### `sing` の項目

- `engine`：`"neutrino"`（必須）。
- `voice`：NEUTRINO の `model/` 以下の歌声（`reina`、`merrow` など。大文字小文字は区別しません）。省略すると `REINA`。
- `level`：伴奏（ほかのトラック）に対する歌声のラウドネス（LU、ほぼ dB、−24〜24）。省略すると 4（歌が少し前に出る）。大きくすると歌が前に、小さくすると引っ込みます。
- トラックの `gain` は `level` にそのまま足されます（`gain: -3` なら伴奏より 1 LU 上）。ベロシティは音符ごとの強弱として効きます。`instrument` は使われません（スキーマ上必須なので何か書いてください）。

### エラー（代わりの音には切り替えません）

- `check`（`checkScore`）の段階で、NEUTRINO を動かす前に次をエラーにします（JSON パスとヒント付き）：`sing` のあるトラックが 2 つ以上、歌うトラックの歌詞がかな 1 モーラ（または `_`/`ー`）でない（`"la"` のようなローマ字・英語や、`"かえる"` のように 1 音符に複数モーラ）。複数モーラは許さず、1 音符 1 モーラに分けてもらいます。
- 歌う音符が 0.1 秒より前に始まると `check` が警告します（子音が切れるため）。描画では切れ目に 5 ms のフェードインをかけてクリックを防ぎます。
- NEUTRINO が見つからない：`NeutrinoMissingError`（調べた場所と `.env` での設定方法を表示）。
- 指定した歌声（省略時は REINA）が入っていない：`NeutrinoVoiceMissingError`（インストール済みの歌声を表示）。
- ブラウザ版（`jinglescript/browser`）で `sing` のあるスコアを描画：`SingerUnavailableError`（NEUTRINO は Node でしか動かないため）。

### 歌い方の細部

- 歌詞は 1 音符 1 モーラのかな（カタカナはひらがなに変換）。`ー` や `_` は前の母音を伸ばします。歌詞のない音符は、直前に歌っている音符があればその母音を伸ばし（`ー` と同じ）、何も鳴っていないときだけ休符になります。
- 0.1 秒未満の音符の隙間はつなげて歌い、それより長い隙間は休符（息継ぎ）になります。NEUTRINO は休符ごとにフレーズを区切るので、長いフレーズには休符を入れてください。
- 小節をまたぐ音符はタイでつなぎます。微分音（detune）は半音に丸めます。
- 48 kHz の出力を描画のサンプルレートに変換し、楽譜の 0 秒にそろえてから、ほかのトラックと一緒にミックスします。
- デモ：`node scripts/sing-neutrino-demo.ts [out.wav] [voice]`（既定は `~/Desktop/neutrino_demo3.wav`）

## 利用規約で気をつけること

NEUTRINO 本体の利用許諾契約書と、各歌声ライブラリの規約に従ってください。要点は以下のとおりです（正式な内容は原文を確認してください）。

- NEUTRINO はフリーウェアです。作った音声は、各歌声ライブラリの規約の範囲で使えます。付属の歌声なら商用利用もできます。
- 出力した音声や中間データを、AI の歌声合成、音声合成、声質変換の学習データに使うことは禁止です。声質変換の入力に使うことも禁止です。
- 歌声ライブラリを、転移学習やファインチューニング、蒸留の元モデルに使うことも禁止です。
- 作った音声を、シンセサイザーやサンプルライブラリなど楽器の音源として配ることには、別途許諾が必要です。
- NEUTRINO の再配布はできません。アプリやサービスに組み込む場合は許諾が必要なことがあるので（[FAQ](https://studio-neutrino.com/faq/)）、事前に Studio NEUTRINO（support@studio-neutrino.com）に確認してください。

## 処理時間

- `render()` は Node では描画をワーカースレッドで行い、NEUTRINO もそのスレッドの中で動きます。キャッシュのない描画は数十秒（MERROW の初回で約 35 秒）かかりますが、待つのはワーカーだけで、呼び出し側のプロセス（MCP サーバーなど）はその間も応答します。
- 音量合わせ（`level`）のために、最終の描画に加えてスコア全体をもう 2 回（歌だけ、伴奏だけ）描画します。ジングルなら問題ありませんが、長いスコアや grandpiano などのサンプル楽器では目に見えて遅くなります。NEUTRINO 自体は 1 回しか動きません。

## 音量とタイミング

- 音量は上の `level` で決まります。伴奏の音量は変えず、歌声だけを調整します。
- NEUTRINO は母音を拍の頭に置き、子音はその 50〜100 ms ほど前から歌います。曲の頭（0 秒）より前は切れるので、最初の音符の前に 1 拍ほど休符を置くと最初の子音まで聞こえます。
