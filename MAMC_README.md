# MAMC X 自動投稿システム

MAMC（レディースファッション／BUYMA）のアイテムを、
**毎日20:00（日本時間）に画像付きで X（@MAMC_JP）へ自動投稿**します。
GitHub Actions で動くので、パソコンを開いていなくても投稿されます。

> **現在の状態：自動投稿は停止中です。**
> 準備が終わるまで、毎日の自動実行は動かないように安全スイッチをかけています。
> 開始方法は「4. 自動投稿を開始する」を参照してください。

---

## 既存の「輝く未来教育」システムとの関係

このリポジトリには、**別ブランドの自動投稿システムが2つ**入っています。
ファイル・Secrets・変数・履歴はすべて分かれており、互いに影響しません。

| | 輝く未来教育（既存） | MAMC（こちら） |
|---|---|---|
| 投稿先 | 既存の教育アカウント | **@MAMC_JP** |
| 投稿時間 | 毎朝7:17（JST） | **毎日20:00（JST）** |
| ワークフロー | `.github/workflows/x-post.yml` | `.github/workflows/mamc-x-post.yml` |
| スクリプト | `scripts/generate_and_post.py` | `scripts/mamc_post_to_x.py` |
| 商品リスト | `products.csv` | `mamc_products.csv` |
| 投稿ルール | `prompt.txt` | `mamc_prompt.txt` |
| 画像 | `images/` | `mamc_images/` |
| 投稿履歴 | `history.json` | `mamc_history.json` |
| X の Secrets | `X_API_KEY` など | `MAMC_X_API_KEY` など |
| リンク | 商品ごとのURL | 変数 `MAMC_BUYMA_URL`（固定） |

**教育側のファイルは一切変更していません。**

---

## 1. ファイルの役割

| 場所 | 役割 |
|---|---|
| `mamc_images/` | 投稿に使う画像（登録済み）。毎回ここから違う画像が選ばれます |
| `mamc_products.csv` | 商品リスト。**空のままでもOK**（その場合はブランド紹介投稿になります） |
| `mamc_prompt.txt` | 投稿文のルール（トーンや長さ）。書き換えると文章が変わります |
| `scripts/mamc_post_to_x.py` | 文章をつくって投稿するプログラム |
| `.github/workflows/mamc-x-post.yml` | 毎日20:00に自動実行する設定 |
| `mamc_history.json` | 投稿履歴（自動で作られます。触らなくてOK） |

---

## 2. 必要な設定

### ① BUYMAショップURL（リポジトリ変数）

投稿の文末には、**毎回このURLが固定で入ります**。商品ごとのURL登録は不要です。

**Settings → Secrets and variables → Actions → Variables タブ → New repository variable**

| 名前 | 値 |
|---|---|
| `MAMC_BUYMA_URL` | 下のURLをそのままコピーしてください |

```
https://www.buyma.com/r/_MAMC-%E3%82%A8%E3%83%A0%E3%82%A8%E3%83%BC%E3%82%A8%E3%83%A0%E3%82%B7%E3%83%BC/-B10083192/
```

（`_MAMC-エムエーエムシー` がURLエンコードされた形です。このまま貼り付けてください）

> 未設定のあいだは、**投稿せずに安全に停止**します（誤ったリンクで投稿されることはありません）。
> URLが変わったときは、この変数の値を書き換えるだけで次の投稿から反映されます。

### ② X の認証情報（Secrets）

キーやパスワードは**コードには一切書きません**。GitHubの金庫（Secrets）に入れます。
**@MAMC_JP のアカウント**で X Developer Portal からキーを取得してください。

**Settings → Secrets and variables → Actions → Secrets タブ → New repository secret**

| 名前 | 中身 |
|---|---|
| `MAMC_X_API_KEY` | API Key（Consumer Key） |
| `MAMC_X_API_SECRET` | API Key Secret（Consumer Secret） |
| `MAMC_X_ACCESS_TOKEN` | Access Token |
| `MAMC_X_ACCESS_TOKEN_SECRET` | Access Token Secret |

> 既存の教育アカウント用の `X_API_KEY` などとは**別の名前**です。上書きしないでください。
> アプリの権限は **Read and write** にし、権限を変えたあとは Access Token を**作り直して**ください。

**誤投稿防止の仕組み**：投稿の直前に、キーの持ち主が `@MAMC_JP` かどうかを確認します。
違うアカウント（たとえば教育アカウント）のキーが入っていた場合は、**投稿せずに中止**します。

### ③（任意）文章をAIに書かせたい場合

`ANTHROPIC_API_KEY`（既存システムと共通でOK）が登録されていれば、
Claude が `mamc_prompt.txt` のルールに沿って毎回文章を書き分けます。
**未登録でも動きます**（あらかじめ用意した言い回しを組み合わせて毎回違う文章を作ります）。

---

## 3. 商品の登録（任意）

`mamc_products.csv` は**空のままでも動きます**。
商品を登録しない場合は、`mamc_images/` の画像を使った「ブランド紹介」の投稿になります。

商品名を出したい場合は、1行ずつ書きます（`#` で始まる行は説明・サンプルなので無視されます）。

```
商品名,特徴,画像ファイル名,ハッシュタグ
リボンブラウス,袖のボリュームがきれい|合わせやすい,,#MAMC #ブラウス
```

- **商品名** … そのまま投稿文に入ります
- **特徴** … `|` で区切って2〜4個。**ここに書いた内容だけ**が投稿文に使われます
- **画像ファイル名** … `mamc_images/` の中のファイル名。**空欄推奨**（空欄なら自動で選びます）
- **ハッシュタグ** … スペース区切り。空欄なら `#MAMC` が付きます

> **URLの列はありません。** リンクは常に `MAMC_BUYMA_URL` が使われます。

### 事実を創作しない仕組み

素材・価格・サイズ・在庫・送料・割引・機能などは、
**`mamc_products.csv` の「特徴」に書かれていない限り、投稿文に入りません。**

- AIが生成した文章にそうした情報が混ざった場合は、自動で検出してテンプレート文に切り替えます
- テンプレート文にも混ざっていた場合は、**投稿せずに中止**します

価格や素材を載せたい場合は、「特徴」欄に正確な内容を自分で書いてください。

---

## 4. 自動投稿を開始する

安全のため、**初期状態では毎日の自動実行が止まっています**。
`MAMC_BUYMA_URL` と4つの Secrets を登録し、手動テストで確認してから以下を行ってください。

**Settings → Secrets and variables → Actions → Variables タブ → New repository variable**

| 名前 | 値 |
|---|---|
| `MAMC_POSTING_ENABLED` | `true` |

これを追加した日から、毎日20:00の自動投稿が始まります。
止めたいときは、この値を `false` にするか変数を削除してください。

---

## 5. 動作の確認（投稿せずに試す）

GitHubの **Actions** タブ → **MAMC X Auto Post** → **Run workflow**。

- `テスト実行（実際には投稿しない）` は**初期値がオン**です。そのまま実行すると、
  投稿されず、**生成された文章と使われる画像ファイル名**がログに出ます。
- `商品が登録されていてもブランド紹介として投稿する` … ブランド紹介文を試したいとき
- `投稿したい商品名` … 特定の商品で試したいとき
- テスト実行をオフにすると実際に投稿されます（設定が未完了ならエラーで止まります）。

パソコンで確認したい場合:

```bash
pip install tweepy anthropic requests requests-oauthlib Pillow
export MAMC_BUYMA_URL="（BUYMAショップのURL）"
python scripts/mamc_post_to_x.py --check      # 設定・商品・画像の点検
python scripts/mamc_post_to_x.py --dry-run    # 投稿せず文章と画像を表示
```

---

## 6. 動きのしくみ

1. 毎日20:00（日本時間）にGitHub Actionsが起動します
2. `mamc_products.csv` に商品があれば、**直近に投稿した商品を避けて**1つ選びます。
   商品が無ければ「ブランド紹介」の投稿になります
3. `mamc_prompt.txt` のルールに沿って、20〜30代の女性向けのおしゃれな文章を生成します
4. `mamc_images/` から画像を選びます。**直近30回で使った画像は避け、直前と同じ画像は絶対に使いません**
5. 文末に `MAMC_BUYMA_URL` と ハッシュタグ（`#MAMC` を必ず含む）を付けます
6. 投稿した商品・文章・画像を `mamc_history.json` に記録し、同じ文章・同じ画像が続かないようにします

文字数はXの上限（全角140文字ぶん）を超えないよう自動で調整されます。
5MBを超える画像は自動で縮小されます。

---

## 7. 困ったときは

| 症状 | 対処 |
|---|---|
| 「BUYMAショップのURL（MAMC_BUYMA_URL）が設定されていない」 | Variables タブに `MAMC_BUYMA_URL` を登録 |
| 「MAMC用のXの認証情報が設定されていません」 | `MAMC_X_...` の4つの名前が正しいか確認 |
| 「投稿を中止しました。…アカウントは @◯◯ ですが」 | `MAMC_X_...` に @MAMC_JP 以外のキーが入っています |
| 「登録されていない情報が本文に含まれています」 | その情報を `mamc_products.csv` の「特徴」に正確に書くか、削除してください |
| 403 エラーで投稿できない | アプリの権限を Read and write にして Access Token を作り直す |
| 毎日の自動実行が走らない | `MAMC_POSTING_ENABLED` 変数が `true` になっているか確認 |
| 20時ちょうどに投稿されない | 20:00に設定していますが、GitHub Actionsの仕様で数分〜数十分遅れることがあります（指定より早くは実行されません） |
