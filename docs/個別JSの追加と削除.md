# 個別機能の表示・非表示を切り替える方法

オーバーレイの機能は、HTMLから個別のJavaScriptファイルを読み込んで表示しています。使いたい機能の読み込み行をHTMLに追加すると表示対象になり、削除するとその機能を停止できます。

## どのHTMLを編集するか

- 横型オーバーレイ: `LoL_Overlay_Landscape.html`
- 縦型オーバーレイ: `LoL_Overlay_Portrait.html`

OBSで使っている方のHTMLを編集してください。横型と縦型の両方で機能を使いたい場合は、両方のHTMLを編集します。

## 機能とJavaScriptファイル

| 機能 | 読み込むファイル | 現在読み込まれているHTML |
| --- | --- | --- |
| 共通データ・ゲーム情報 | `js/LoL_Api.js` | 横型・縦型 |
| ゴールド差グラフ | `js/LoL_GoldChart.js` | 横型・縦型 |
| スコアボード | `js/LoL_ScoreBord.js` | 横型・縦型 |
| レーン別ゴールド差 | `js/LoL_RoleGoldDiff.js` | 横型 |
| トップバー | `js/LoL_TopBar.js` | 横型・縦型 |
| 分間CS | `js/LoL_CSPerMinute.js` | 横型 |
| オブジェクトタイマー | `js/LoL_ObjectTimer.js` | 横型・縦型 |

`LoL_Api.js` は他の機能が利用する共通ファイルです。特定の表示機能を停止したいだけの場合は、これを削除しないでください。

## 機能ごとのHTML要素

一部の機能は、JavaScriptの読み込み行だけでなく、`<body>` 内にある表示用の `div` も使います。機能を削除するときは、次の対応する要素も削除してください。

| 機能 | HTML内の表示用要素 | 要素の場所 |
| --- | --- | --- |
| ゴールド差グラフ | `<div id="goldChart"></div>` | `#overlay-canvas` の内側 |
| スコアボード | `<div class="scoreboard-widget"> ... <div id="ScoreBord"></div> ... </div>` | `#overlay-canvas` の内側。内側の `scoreboard-scale-frame` も含めた外側の `scoreboard-widget` を削除します。 |
| レーン別ゴールド差 | `<div class="role-gold-diff-widget"><div id="RoleGoldDiff"></div></div>` | `#overlay-canvas` の内側 |
| 分間CS | `<div id="active-player-cs" class="active-player-cs" hidden></div>` | `#overlay-canvas` の内側 |
| トップバー | 固定の表示用 `div` はありません | JSが `#overlay-canvas` に追加するため、HTMLから削除する要素はありません。 |
| オブジェクトタイマー | 固定の表示用 `div` はありません | JSが `#overlay-canvas` に追加するため、HTMLから削除する要素はありません。 |

`#overlay-canvas` 自体は複数機能で共有しています。特定の機能を削除するときに、これを削除しないでください。

## HTMLを編集する

1. オーバーレイのフォルダーにある `LoL_Overlay_Landscape.html` または `LoL_Overlay_Portrait.html` を、メモ帳などのテキストエディターで開きます。
2. ファイル内で `<script src="js/` を検索します。複数のJavaScript読み込み行がまとまっている場所が見つかります。
3. 使いたい機能の行を追加するか、使わない機能の行を削除します。
4. 機能に対応する表示用 `div` が表にある場合は、同じHTMLの `<body>` 内でも追加または削除します。
5. ファイルを保存して、OBSでそのHTMLを再読み込みします。

### 機能を追加する例

たとえば、縦型HTMLでレーン別ゴールド差を表示したい場合は、読み込み行が並んでいる場所に次の行を追加します。

```html
<script src="js/LoL_RoleGoldDiff.js"></script>
```

さらに、`<body>` 内の `#overlay-canvas` の中に、表示用の要素を追加します。

```html
<div class="role-gold-diff-widget">
    <div id="RoleGoldDiff"></div>
</div>
```

HTMLの `<script>` は、共通ファイルの `LoL_Api.js` より後、HTML内の初期化用 `<script>` より前に置いてください。ファイル名や大文字・小文字を変えず、`js/` フォルダー内にそのファイルがあることも確認します。表の「現在読み込まれているHTML」に載っている機能は、すでに読み込み行と表示用要素があるため追加不要です。

### 機能を削除する例

分間CSを表示しない場合は、横型HTMLから、読み込み行と対応する表示用 `div` の両方を削除します。

```html
<script src="js/LoL_CSPerMinute.js"></script>
```

```html
<div id="active-player-cs" class="active-player-cs" hidden></div>
```

削除するのは該当する読み込み行と機能専用の `div` だけです。HTML内の `<script>` や `</script>` のタグ全体、他のJavaScriptの行、共通の `#overlay-canvas` は削除しないでください。トップバーやオブジェクトタイマーのようにJSが表示要素を作る機能は、対応する固定の `div` をHTMLから削除する必要はありません。

## 確認する

変更後、OBSで対象のブラウザーソースを再読み込みします。機能が表示されない場合は、編集したHTMLがOBSで選択されているか、読み込み行のファイル名が正しいか、対象のJSファイルが `js/` フォルダーにあるかを確認してください。

HTMLに読み込み行を追加するだけで利用できるのは、プロジェクトにすでに用意されている機能です。新しい機能用のJavaScriptファイル自体がない場合は、このHTMLの変更だけでは追加できません。
