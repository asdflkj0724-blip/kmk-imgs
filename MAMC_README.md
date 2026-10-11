# MAMC X 自動投稿システム

MAMC ブランドの商品を、**毎日20時台（日本時間）に画像付きで X（@MAMC_JP）へ自動投稿**します。
GitHub Actions で動くので、パソコンを開いていなくても投稿されます。

> **現在の状態：自動投稿は停止中です。**
> Xの認証情報の準備が終わるまで、毎日の自動実行は動かないように安全スイッチをかけています。
> 開始方法は「4. 自動投稿を開始する」を参照してください。

---

## 既存の「輝く未来教育」システムとの関係

このリポジトリには、**別ブランドの自動投稿システムが2つ**入っています。
ファイル・Secrets・履歴はすべて分かれており、互いに影響しません。

| | 輝く未来教育（既存） | MAMC（こちら） |
|---|---|---|
| 投稿先 | 既存の教育アカウント | **@MAMC_JP** |
| 投稿時間 | 毎朝7:17（JST） | **毎日20:13（JST）** |
| ワークフロー | `.github/workflows/x-post.yml` | `.github/workflows/mamc-x-post.yml` |
| スクリプト | `scripts/generate_and_post.py` | `scripts/mamc_post_to_x.py` |
| 商品リスト | `products.csv` | `mamc_products.csv` |
| 投稿ルール | `prompt.txt` | `mamc_prompt.txt` |
| 画像 | `images/` | `mamc_images/` |
| 投稿履歴 | `history.json` | `mamc_history.json` |
| X の Secrets | `X_API_KEY` など | `MAMC_X_API_KEY` など |

**教育側のファイルは一切変更していません。** MAMC側の作業で教育側の投稿が止まることはありません。

---

## 1. ファイルの役割

| 場所 | 役割 |
|---|---|
| `mamc_images/` | MAMCの商品画像（56枚が登録済み） |
| `mamc_products.csv` | 商品名・URL・特徴・画像ファイル名の一覧 |
| `mamc_prompt.txt` | 投稿文のルール（トーンや長さ）。書き換えると文章が変わります |
| `scripts/mamc_post_to_x.py` | 文章をつくって投稿するプログラム |
| `.github/workflows/mamc-x-post.yml` | 毎日20時台に自動実行する設定 |
| `mamc_history.json` | 投稿履歴（自動で作られます。触らなくてOK） |

---

## 2. 商品の登録のしかた

`mamc_products.csv` に1行ずつ商品を書きます。`#` で始まる行は説明・サンプルなので無視されます。

```
商品ID,商品名,URL,画像ファイル名,特徴,ハッシュタグ
mamc-tee-01,MAMC ロゴTシャツ,https://mamc.example/items/tee01,,肌ざわりがやわらかい|1枚でも重ねても着られる,#MAMC #Tシャツ
```

- **商品ID** … 商品を見分ける短い名前（英数字・重複しないもの）
- **商品名** … そのまま投稿文に入ります
- **URL** … 商品ページのURL。投稿の文末に自動で入ります
- **画像ファイル名** … `mamc_images/` の中のファイル名。
  **空欄でOK** です。空欄なら `mamc_images/` から最近使っていない画像を自動で選びます
- **特徴** … `|` で区切って2〜4個。多いほど文章のバリエーションが増えます
- **ハッシュタグ** … スペース区切り。空欄なら `#MAMC` が付きます

商品は**2つ以上**登録してください。1つだけだと毎日同じ商品になります。

---

## 3. 認証情報の登録（GitHub Secrets）

キーやパスワードは**コードには一切書きません**。GitHubの金庫（Secrets）に入れます。

**@MAMC_JP のアカウント**で X Developer Portal からキーを取得し、
**Settings → Secrets and variables → Actions → New repository secret** から登録します。

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

### （任意）文章をAIに書かせたい場合

`ANTHROPIC_API_KEY`（既存システムと共通でOK）が登録されていれば、
Claude が `mamc_prompt.txt` のルールに沿って毎回文章を書き分けます。
**未登録でも動きます**（あらかじめ用意した言い回しを組み合わせて毎回違う文章を作ります）。

---

## 4. 自動投稿を開始する

安全のため、**初期状態では毎日の自動実行が止まっています**。
上の Secrets 4つを登録し、手動テストで問題ないことを確認してから、以下を行ってください。

**Settings → Secrets and variables → Actions → Variables タブ → New repository variable**

| 名前 | 値 |
|---|---|
| `MAMC_POSTING_ENABLED` | `true` |

これを追加した翌日から、毎日20時台の自動投稿が始まります。
止めたいときは、この値を `false` にするか変数を削除してください。

---

## 5. 動作の確認（投稿せずに試す）

GitHubの **Actions** タブ → **MAMC X Auto Post** → **Run workflow**。

- `テスト実行（実際には投稿しない）` は**初期値がオン**です。そのまま実行すると、
  投稿されず、生成された文章と使われる画像がログに出ます。
- オフにすると実際に投稿されます（Secrets が未登録ならエラーで止まります）。

パソコンで確認したい場合:

```bash
pip install tweepy anthropic requests requests-oauthlib Pillow
python scripts/mamc_post_to_x.py --check             # 商品・画像・履歴の点検
python scripts/mamc_post_to_x.py --dry-run           # 投稿せず文章だけ表示
python scripts/mamc_post_to_x.py --dry-run --sample  # サンプル行で試す
```

---

## 6. 動きのしくみ

1. 毎日20時台（日本時間）にGitHub Actionsが起動します
2. `mamc_products.csv` から、**直近に投稿した商品を避けて**1つ選びます（同じ商品が連続しません）
3. `mamc_prompt.txt` のルールに沿って、20代向けの自然な文章を毎回少し変えて作ります
4. `mamc_images/` の画像（最近使ったものは避ける）を付けて投稿し、
   文末に商品URLとハッシュタグを入れます
5. 投稿した商品と画像を `mamc_history.json` に記録します

文字数はXの上限（全角140文字ぶん）を超えないよう自動で調整されます。
5MBを超える画像は自動で縮小されます。

---

## 7. 困ったときは

| 症状 | 対処 |
|---|---|
| 「投稿できる商品がありません」 | `mamc_products.csv` の行の先頭に `#` が付いていないか確認 |
| 「MAMC用のXの認証情報が設定されていません」 | `MAMC_X_...` の4つの名前が正しいか確認 |
| 「投稿を中止しました。…アカウントは @◯◯ ですが」 | `MAMC_X_...` に @MAMC_JP 以外のキーが入っています |
| 403 エラーで投稿できない | アプリの権限を Read and write にして Access Token を作り直す |
| 毎日の自動実行が走らない | `MAMC_POSTING_ENABLED` 変数が `true` になっているか確認 |
| 20時ちょうどに投稿されない | GitHubの混雑を避けて20:13に設定しています（さらに数分ずれることがあります） |
