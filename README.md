# LoL Overlay

League of Legends の Live Client Data API を利用した、OBS向けオーバーレイです。スコアボード、ゴールドチャート、オブジェクトタイマーなどを表示できます。

![Screenshot](docs/screenshot.png)

## 動作環境

- Windows 10 / 11
- League of Legends
- OBS Studio
- Data Dragonのデータ取得・更新に必要なインターネット接続

## 導入手順

1. [GitHub Releases](https://github.com/comaneci-lab/lol-overlay/releases) から最新版の配布ZIPをダウンロードし、任意のフォルダーに展開します。展開したファイルやフォルダーは同じ場所に置いてください。
2. `LoLAPIGet.exe` と同じフォルダーの `settings.ini` を開き、`language` がLeague of Legendsクライアントの言語と一致していることを確認します。配布時は `ja_JP` です。変更方法は[利用ガイド](docs/利用ガイド.md#言語設定)を参照してください。
3. `LoLAPIGet.exe` を起動します。使用中はアプリのウィンドウを開いたままにしてください。
4. OBS Studioで「ソース」→「追加」→「ブラウザ」を選び、「ローカルファイル」を無効にして、表示したいオーバーレイのURLとサイズを設定します。たとえばトップバーの場合:

   ```text
   URL: http://127.0.0.1:8888/html/LoL_TopBar_Overlay.html
   幅: 850  高さ: 130
   ```

   他のオーバーレイのURL・サイズや詳しい設定は[OBS設定手順](docs/OBS設定手順.md)を参照してください。アプリの「管理」タブからURLをコピーすることもできます。
5. League of Legendsの試合を開始し、OBSのプレビューで表示を確認します。機能によって表示されるタイミングや対応するゲームモードが異なります。

終了するときは、LoL Overlayのウィンドウを閉じます。ローカルプロキシも終了します。OBSは通常どおり終了してください。

## 表示されない場合

- 試合中で、使用する機能がそのゲームモードに対応していることを確認します。
- `LoLAPIGet.exe` が起動中で、OBSのブラウザソースに正しいURLとサイズが設定されていることを確認します。
- アイコンが表示されない場合は `settings.ini` の言語を確認し、アプリを再起動してOBSのブラウザソースを更新します。

詳しくは[利用ガイド](docs/利用ガイド.md#トラブルシューティング)を参照してください。

## ドキュメント

- [利用ガイド](docs/利用ガイド.md)：言語設定、更新、トラブルシューティング
- [OBS設定手順](docs/OBS設定手順.md)：オーバーレイ一覧、サイズ、OBS連携
- [カスタマイズガイド](docs/カスタマイズガイド.md)：色・表示条件などの変更
- [横型・縦型オーバーレイの設定](docs/横型・縦型オーバーレイ.md)
- [観戦モードの使い方](docs/観戦モード.md)
- [個別オーバーレイ開発ガイド](docs/個別オーバーレイ開発ガイド.md)
- [ビルドからリリースまでの手順](docs/リリース手順.md)

不具合報告や機能要望は [GitHub Issues](https://github.com/comaneci-lab/lol-overlay/issues) にお願いします。開発の記録は[ブログ](https://do-something.jp/)で公開しています。

## Disclaimer

LoL Overlay は Riot Games によって承認、スポンサー、または提携されたものではありません。League of Legends および関連するアセットの権利は Riot Games に帰属します。

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
