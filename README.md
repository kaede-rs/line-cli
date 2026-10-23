# LINE CLI

ターミナルで動く、LINEのCLIクライアントです。マウスとキーボードの両方で操作できます。

**必要なもの**: [Deno](https://deno.com/) 2.x
のみ（依存パッケージは初回起動時に自動取得されます）

- 画像・スタンプ・リッチメッセージの inline 表示は
  [Kitty Graphics Protocol](https://sw.kovidgoyal.net/kitty/graphics-protocol.html)
  対応ターミナル（kitty、WezTerm、Konsole 等）で動作します。非対応ターミナルでは
  `[画像]` 等ラベル表示になります。

## セットアップ

```sh
git clone <このリポジトリ>
cd line-cli
deno task start
```

初回起動時は QR コードが表示されるので、スマートフォンの LINE で 「ホーム →
友だち追加 → QR」から読み取り、端末に表示される PIN をスマホに入力してください。

ログイン情報は `~/.local/share/line-cli/session.json`
に保存され、次回以降は自動ログインします。

### メールアドレスでログインする場合

```sh
deno task start --email <addr> --password <pw>
# または環境変数 LINE_EMAIL / LINE_PASSWORD を設定
```

## 操作方法

起動後、`?` キー（または `/help` コマンド）で操作一覧をご覧いただけます。

| キー              | 動作                                |
| ----------------- | ----------------------------------- |
| `↑` `↓` / `k` `j` | チャットを選択                      |
| `Enter`           | チャットを開く / メッセージを送信   |
| `/`               | チャットを検索                      |
| `r`               | 一覧を更新                          |
| `i`               | チャット情報を表示                  |
| `t`               | テーマを切替（dark / light / mono） |
| `Tab`             | 一覧と入力欄を切替                  |
| `Ctrl+J`          | 送信欄で改行                        |
| `Esc` / `←`       | チャットを閉じる                    |
| `Ctrl+C`          | 終了                                |

メッセージ送信は E2EE
で行われます。マウスでのクリック・スクロール・右クリックメニューにも対応しています。

### コマンド

入力欄で `/` から始めるとコマンドが使えます。

`/open` `/close` `/send` `/search` `/reload` `/info` `/me` `/theme` `/clear`
`/redraw` `/quit`

「/」で始まる本文を送りたい場合は `//本文` のように書くか、`/send`
をご利用ください。

## オプション

| オプション              | 説明                                       |
| ----------------------- | ------------------------------------------ |
| `--theme <名前>`        | dark / light / mono / auto（既定: auto）   |
| `--email`, `--password` | メールアドレスでログイン（両方指定が必要） |
| `--device <名前>`       | 接続端末の種別（既定: DESKTOPWIN）         |
| `--no-mouse`            | マウス追跡を無効化                         |
| `--help`                | ヘルプを表示                               |

## 開発

```sh
deno task check   # 型チェック
deno fmt          # フォーマット
deno lint         # リント
```

## ライセンス

[MIT License](./LICENSE)

---

**注意**:
本ツールは非公式のクライアントです。ご利用は自己責任でお願いいたします。
