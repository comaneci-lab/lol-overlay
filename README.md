# LoL Overlay

League of Legends の Live Client Data API を利用したOBS向けオーバーレイです。

スコアボード、分間CS、ゴールドチャート、オブジェクトタイマーをリアルタイムで表示できます。

![Screenshot](docs/screenshot.png)
``

## 主な機能

- スコアボード表示
- 分間CS表示
- ゴールドチャート表示
- オブジェクトタイマー表示
- Data Dragon画像対応
- OBSブラウザソース対応

---

## 動作環境

- Windows 10 / 11
- League of Legends
- OBS Studio

---

## ダウンロード

最新版は GitHub Releases からダウンロードしてください。


https://github.com/comaneci-lab/lol-overlay/releases

---

## セットアップ手順

### 1. ファイルを展開する

GitHub Releases からダウンロードしたZIPファイルを任意のフォルダへ展開します。

### 2. League of Legends を起動する

League of Legends クライアントを起動し、試合を開始します。

### 3. LoLAPIGet.exe を起動する

LoLAPIGet.exe を実行してください。

このプログラムは League of Legends の Live Client Data API にアクセスするためのローカルプロキシです。

正常に起動するとコンソールウィンドウが表示されたままになります。

### 4. OBSにブラウザソースを追加する

OBS Studio を起動します。

「ソース」→「追加」→「ブラウザ」を選択します。

「ローカルファイル」を有効にし、以下のファイルを指定してください。

```text
LoL_Overlay_Landscape.html
```

例:

```text
C:\LoLOverlay\LoL_Overlay_Landscape.html
```

### 5. ゲームを開始する

試合開始後、自動的にオーバーレイが更新されます。

---

## 終了方法

### オーバーレイを終了する

LoLAPIGet.exe のウィンドウを閉じてください。

またはコンソールウィンドウで

```text
Ctrl + C
```

を実行してください。

### OBSを終了する

通常どおり OBS Studio を終了してください。

---

## トラブルシューティング

### 情報が表示されない

以下をご確認ください。

- League of Legends の試合中である
- LoLAPIGet.exe が起動している
- OBS が正しいHTMLファイルを参照している

### アイコンが表示されない

Releaseに含まれている画像ファイルが削除されていないか確認してください。

またはDataDragonから最新の画像を取得してください。
https://developer.riotgames.com/docs/lol

---

## 不具合報告・要望

不具合報告や機能要望は GitHub Issues よりお願いします。

---

## 開発ブログ

開発の記録や技術解説を公開しています。

https://do-something.jp/

---

## Author

comaneci

GitHub:
https://github.com/comaneci-lab

Blog:
https://do-something.jp/

---

## Disclaimer

LoL Overlay は Riot Games によって承認、スポンサー、または提携されたものではありません。

League of Legends および関連するアセットの権利は Riot Games に帰属します。

---

## License

This project is licensed under the MIT License.

See the LICENSE file for details.

---

## 実行ファイルのビルド

Python と PyInstaller をインストールした Windows 環境で、プロジェクトのルートにある `build.bat` を実行してください。

```text
dist\LoLAPIGet.exe
```

に単一ファイル形式の実行ファイルが生成されます。実行時に `_internal` フォルダは不要です。HTML、CSS、JavaScript、画像などのオーバーレイファイルは、これまでどおり実行ファイルとは別に配置してください。

ビルド時に `json` フォルダがある場合はJSONデータも実行ファイルに含まれます。ない場合は、従来どおり実行時にデータを取得します。
