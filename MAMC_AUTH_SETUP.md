# MAMC（@MAMC_JP）のX認証を設定する手順

この手順は**1回だけ**行う作業です。終わったらこのファイルと
`scripts/mamc_get_access_token.py` は削除してかまいません。

---

## なぜこの作業が必要なのか

X への自動投稿には4つの値が必要です。

| 値 | 性質 |
|---|---|
| API Key | **アプリ**のもの（@kagayakumir と共通） |
| API Key Secret | **アプリ**のもの（@kagayakumir と共通） |
| Access Token | **アカウントごと**。@MAMC_JP のものが必要 |
| Access Token Secret | **アカウントごと**。@MAMC_JP のものが必要 |

X Developer Portal の画面にある「Generate（生成）」ボタンで作れる Access Token は、
**アプリの持ち主のアカウント（@kagayakumir）のもの**になります。
@MAMC_JP の Access Token を手に入れるには、
**@MAMC_JP でログインしてアプリを認可する**という手順（OAuth 1.0a の3-legged認証）が必要です。

そのための一時スクリプト `scripts/mamc_get_access_token.py` を用意しました。
**ご自身のパソコンで実行します**（キーを外部に送らないため）。

---

## ⚠️ 絶対に押さないでください

既存の「輝く未来教育」の自動投稿が止まります。

| 場所 | 押してはいけないボタン | 押すとどうなるか |
|---|---|---|
| Keys and tokens > Consumer Keys | **Regenerate**（API Key と Secret の再生成） | 両方のシステムが即座に止まる |
| Keys and tokens > Authentication Tokens > Access Token and Secret | **Regenerate**（Access Tokenの再生成） | @kagayakumir の投稿が止まる |
| User authentication settings | App permissions の**変更** | 既存トークンの権限がずれる（今の Read and write のままでOK） |

**この手順で行う設定変更は、Callback URI を1つ「追加」するだけです。**
追加は既存のトークンに影響しません。

---

## 準備：パソコンにPythonを用意する

ターミナル（Windowsは「コマンドプロンプト」または「PowerShell」、Macは「ターミナル」）を開いて確認します。

```bash
python --version
```

バージョンが表示されればOKです（`python3 --version` で表示される場合は、以降 `python` を `python3` に読み替えてください）。
表示されない場合は https://www.python.org/downloads/ からインストールしてください。

次に、必要なライブラリを入れます。

```bash
pip install requests-oauthlib
```

最後に、このリポジトリをパソコンにダウンロードします（すでにある場合は `git pull`）。

```bash
git clone https://github.com/asdflkj0724-blip/kmk-imgs.git
cd kmk-imgs
```

---

## ステップ 1：アプリ設定の確認（変更は不要）

**Xアプリの設定は変更しません。** 登録済みの内容を確認するだけです。

1. https://developer.x.com/en/portal/dashboard を開きます
2. 左側のメニューから、アプリ **「FABMIC FASHION」**（App ID: 33425237）を選びます
3. **「User authentication settings」** に、次が登録されていることを確認します
   - **App permissions** … `Read and write`
   - **Callback URI / Redirect URL** … `http://127.0.0.1:8765/callback`

> すでにこの値が登録済みなら、**何も変更せずに次へ進んでください**。
>
> もし登録されているコールバックURLが別の値だった場合は、
> **その値を消さずに**、ステップ4で次のように指定して実行してください。
> ```
> python scripts/mamc_get_access_token.py --callback-url "登録されている値"
> ```

## ステップ 2：API Key と API Key Secret を手元に出す（ブラウザ）

1. 同じアプリの **「Keys and tokens」** タブを開きます
2. **「Consumer Keys」→「API Key and Secret」** の **「View Keys」** を押します
   - 表示されない場合は、過去に控えた値を使ってください
   - **ここで「Regenerate」は押さないでください**
3. **API Key** と **API Key Secret** をコピーできる状態にしておきます（次のステップで入力します）

---

## ステップ 3：ブラウザで @kagayakumir からログアウトする（重要）

ログインしたままだと、**@kagayakumir のトークンが出てきてしまいます**。

- **おすすめ**：ブラウザの**シークレットウィンドウ（プライベートウィンドウ）**を1つ開く
  - Chrome / Edge … `Ctrl + Shift + N`（Macは `⌘ + Shift + N`）
  - Safari … ファイル > 新規プライベートウインドウ
  - Firefox … `Ctrl + Shift + P`（Macは `⌘ + Shift + P`）
- または https://x.com でいったんログアウトする

---

## ステップ 4：スクリプトを実行する（ターミナル）

```bash
python scripts/mamc_get_access_token.py
```

1. `API Key          :` と出たら、ステップ2の **API Key** を貼り付けて Enter
   - **入力した文字は画面に表示されません**（セキュリティのためです。貼り付けは効いています）
2. `API Key Secret   :` と出たら、**API Key Secret** を貼り付けて Enter
3. 画面に **認可用のURL** が表示されます（このURLは人に見せないでください）
4. ターミナルはそのまま開いたままにして、次のステップへ進みます

---

## ステップ 5：ブラウザで @MAMC_JP として認可する（ブラウザ）

1. ステップ4で表示されたURLを、**ステップ3で開いたシークレットウィンドウ**に貼り付けて開きます
2. ログイン画面が出たら、**@MAMC_JP** のユーザー名とパスワードでログインします
3. 「**FABMIC FASHION** に以下を許可しますか？」という画面が出ます
4. 画面に表示されているアカウント名が **@MAMC_JP** になっていることを**必ず確認**してください
   - @kagayakumir になっていたら、いったん閉じてログアウトし、ステップ3からやり直します
5. **「アプリにアクセスを許可」**（Authorize app）を押します

---

## ステップ 6：エラー画面のURLをコピーして貼り付ける（ここが重要）

認可を押すと、ブラウザは `http://127.0.0.1:8765/callback` へ移動し、

> **このサイトにアクセスできません**
> **127.0.0.1 で接続が拒否されました。ERR_CONNECTION_REFUSED**

という画面になります。**これは正常です。失敗ではありません。**
（お使いのパソコンでは、この住所で待ち受けているプログラムが無いためです）

1. **この画面を閉じないでください。**
2. ブラウザの**アドレスバーをクリック**します
3. **URL全体を選択してコピー**します（`Ctrl + A` → `Ctrl + C`、Macは `⌘ + A` → `⌘ + C`）
   - 次のような長い文字列です
     ```
     http://127.0.0.1:8765/callback?oauth_token=XXXXXXXX&oauth_verifier=YYYYYYY
     ```
   - **`oauth_verifier=` が含まれていることを確認**してください
4. ターミナルに戻ります。`コールバックURL :` と表示されています
5. コピーしたURLを**貼り付けて Enter**を押します
   - **貼り付けた文字は画面に表示されません**（セキュリティのためです。貼り付けは効いています）
   - Windowsのコマンドプロンプトでは、右クリックで貼り付けできます
6. `受け取りました（oauth_verifier: <7文字の値>）` と出れば成功です

> **貼り付けを間違えても大丈夫です。** 3回までやり直せます。
> 「oauth_verifier= が見つかりませんでした」と出たら、URLの一部だけをコピーしています。
> アドレスバーで `Ctrl + A` を押してから `Ctrl + C` でコピーし直してください。
>
> **時間をかけすぎないでください。** `oauth_verifier` には有効期限があります。
> 「Access Token の取得に失敗しました」と出たら、ステップ4から通しでやり直してください。

---

## ステップ 7：表示された値をGitHubに登録する

ターミナルに、`@MAMC_JP の Access Token を取得しました` と表示され、
2つの値が出ます。これを GitHub に登録します。

1. https://github.com/asdflkj0724-blip/kmk-imgs/settings/secrets/actions を開きます
2. **「New repository secret」** を押して、次の**4つ**を1つずつ登録します

| Name | Secret に入れる値 |
|---|---|
| `MAMC_X_API_KEY` | ステップ2の **API Key** |
| `MAMC_X_API_SECRET` | ステップ2の **API Key Secret** |
| `MAMC_X_ACCESS_TOKEN` | ターミナルに出た **MAMC_X_ACCESS_TOKEN** の値 |
| `MAMC_X_ACCESS_TOKEN_SECRET` | ターミナルに出た **MAMC_X_ACCESS_TOKEN_SECRET** の値 |

> 既存の `X_API_KEY` / `X_API_SECRET` / `X_ACCESS_TOKEN` / `X_ACCESS_TOKEN_SECRET`
> （@kagayakumir 用）は**触らないでください**。別の4つとして追加します。
>
> 上2つは既存システムと同じ値になりますが、それで正しいです（同じアプリなので）。

あわせて、まだ登録していなければ **Variables タブ**で次も登録します。

| Name | 値 |
|---|---|
| `MAMC_BUYMA_URL` | `https://www.buyma.com/r/_MAMC-%E3%82%A8%E3%83%A0%E3%82%A8%E3%83%BC%E3%82%A8%E3%83%A0%E3%82%B7%E3%83%BC/-B10083192/` |

---

## ステップ 8：ターミナルの表示を消す

登録が終わったら、画面に残っている Access Token を消します。

- Windows … `cls` と入力して Enter
- Mac / Linux … `clear` と入力して Enter
- もしくはターミナルのウィンドウを閉じる

**この値は、チャット・メール・PR・Issue などに貼らないでください。**

---

## ステップ 9：投稿せずに、認証だけを確認する

実際の投稿はまだ行いません。認証情報が正しいかだけを確認します。

1. https://github.com/asdflkj0724-blip/kmk-imgs/actions を開きます
2. 左から **「MAMC X Auto Post」** を選びます
3. 右上の **「Run workflow」** を押します
4. **`X認証情報の確認だけを行う（投稿しない）` にチェックを入れます**
5. **「Run workflow」** を押します
6. 実行結果のログに次のように出れば成功です

   ```
   認証できました: @MAMC_JP
   @MAMC_JP の認証情報として正しく設定されています。
   ※このコマンドは投稿を行いません。
   ```

   `このキーは @kagayakumir のものです` と出た場合は、
   Access Token の登録を間違えています。ステップ3からやり直してください。

次に、投稿文と画像の中身も確認できます（これも投稿しません）。

9'. `テスト実行（実際には投稿しない）` にチェックを入れて **Run workflow**
→ ログに投稿文と使われる画像ファイル名が表示されます。

---

## ステップ 10：片付け（任意）

- `scripts/mamc_get_access_token.py` と この `MAMC_AUTH_SETUP.md` は削除してOKです
  （Access Token を作り直したくなったときに、また使えるので残しても問題ありません）
- Xアプリの Callback URI の設定は、そのまま残しておいてください
  （トークンを作り直すときに必要です）

---

## 自動投稿の開始は、まだ行いません

ここまでで認証は完了ですが、**自動投稿はまだ始まりません**。
開始したくなったら、Variables タブに次を追加してください。

| Name | 値 |
|---|---|
| `MAMC_POSTING_ENABLED` | `true` |

---

## 困ったときは

| 症状 | 原因と対処 |
|---|---|
| `requests-oauthlib が入っていません` | `pip install requests-oauthlib` を実行 |
| **`ERR_CONNECTION_REFUSED` / このサイトにアクセスできません** | **正常です。** その画面のアドレスバーのURL全体をコピーして、ターミナルに貼り付けてください（ステップ6） |
| `oauth_verifier= が見つかりませんでした` | URLの一部だけをコピーしています。アドレスバーで `Ctrl + A` → `Ctrl + C` でコピーし直す |
| `貼り付けられたURLは、今回の認証とは別のものです` | 古いタブのURLを貼っています。ステップ4から通しでやり直す |
| `認可がキャンセルされています` | 認可画面で「許可」を押していません。もう一度認可する |
| `Access Token の取得に失敗しました` | `oauth_verifier` の有効期限切れ。ステップ4から通しで、手早くやり直す |
| `リクエストトークンの取得に失敗しました` | API Key / Secret の貼り付け間違い、またはアプリに登録されたコールバックURLが別の値。`--callback-url "登録されている値"` を付けて実行 |
| `取得したトークンは @kagayakumir のものでした` | ログアウトし忘れ。シークレットウィンドウでステップ3からやり直す |
| 認可画面が「このアプリは不明」などで止まる | アプリの Website URL が空の可能性。Developer Portal で確認 |
| アプリにコールバックURLを登録していない | `python scripts/mamc_get_access_token.py --pin` で PIN 方式を使う |
| ターミナルに貼り付けができない（Windows） | コマンドプロンプトでは**右クリック**で貼り付けできます |
