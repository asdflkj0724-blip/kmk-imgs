# MAMC X 自動投稿システム

MAMC ブランドの商品を、**毎日20時（日本時間）に画像付きで X（旧Twitter）へ自動投稿**します。
GitHub Actions で動くので、パソコンを開いていなくても勝手に投稿されます。

---

## 1. ファイルの役割

| 場所 | 役割 |
|---|---|
| `images/` | 商品画像を入れるフォルダ |
| `products.csv` | 商品名・URL・特徴・画像ファイル名の一覧 |
| `prompt.txt` | 投稿文のルール（トーンや長さ）。書き換えると文章が変わります |
| `scripts/post_to_x.py` | 実際に文章をつくって投稿するプログラム |
| `.github/workflows/mamc-x-post.yml` | 毎日20時に自動実行する設定 |
| `state/history.json` | 投稿履歴（自動で作られます。触らなくてOK） |

---

## 2. 商品の登録のしかた

`products.csv` に1行ずつ商品を書きます。`#` で始まる行は説明・サンプルなので無視されます。

```
id,name,url,image,features,hashtags
mamc-tee-01,MAMC ロゴTシャツ,https://mamc.example/items/tee01,mamc-tee-01.jpg,肌ざわりがやわらかい|1枚でも重ねても着られる,#MAMC #Tシャツ
```

- **id** … 商品を見分ける短い名前（英数字・重複しないもの）
- **name** … 商品名。そのまま投稿文に入ります
- **url** … 商品ページのURL。投稿の文末に自動で入ります
- **image** … `images/` に入れた画像ファイル名。空欄なら `id` で始まる画像を自動で探します
- **features** … 特徴を `|` で区切って2〜4個。多いほど文章のバリエーションが増えます
- **hashtags** … スペース区切り。空欄なら `#MAMC` が付きます

商品は**2つ以上**登録してください。1つだけだと毎日同じ商品になります。

---

## 3. 認証情報の登録（GitHub Secrets）

キーやパスワードは**コードには一切書きません**。GitHubの金庫（Secrets）に入れます。

リポジトリの **Settings → Secrets and variables → Actions → New repository secret** から、
以下の4つを登録します（値は X Developer Portal で取得します）。

| 名前 | 中身 |
|---|---|
| `X_API_KEY` | API Key（Consumer Key） |
| `X_API_SECRET` | API Key Secret（Consumer Secret） |
| `X_ACCESS_TOKEN` | Access Token |
| `X_ACCESS_TOKEN_SECRET` | Access Token Secret |

> Access Token を作るとき、アプリの権限は **Read and write** にしてください。
> 権限を変えたあとは、Access Token を**作り直す**必要があります。

### （任意）文章をAIに書かせたい場合

`ANTHROPIC_API_KEY` を追加で登録すると、毎回 Claude が `prompt.txt` のルールに沿って文章を書き分けます。
**登録しなくても動きます**（その場合は、あらかじめ用意した言い回しを組み合わせて毎回違う文章を作ります）。

---

## 4. 動作の確認

GitHubの **Actions** タブ → **MAMC X Auto Post** → **Run workflow** から手動実行できます。

- `投稿せずに文章だけ確認する` を **true**（初期値）にすると、投稿されず文章だけログに出ます。
- 問題なければ **false** にして実行すると、実際に投稿されます。

パソコンで確認したい場合:

```bash
pip install -r requirements.txt
python scripts/post_to_x.py --check      # 商品と画像の点検
python scripts/post_to_x.py --dry-run    # 投稿せず文章だけ表示
```

---

## 5. 動きのしくみ

1. 毎日20時（日本時間）にGitHub Actionsが起動します
2. `products.csv` から、**直近に投稿した商品を避けて**1つ選びます（同じ商品が連続しません）
3. `prompt.txt` のルールに沿って、20代向けの自然な文章を毎回少し変えて作ります
4. `images/` の画像を付けて投稿し、文末に商品URLとハッシュタグを入れます
5. 投稿した商品を `state/history.json` に記録します

文字数はXの上限（全角140文字ぶん）を超えないよう自動で調整されます。

---

## 6. 困ったときは

| 症状 | 対処 |
|---|---|
| 「投稿できる商品がありません」 | `products.csv` の行の先頭に `#` が付いていないか確認してください |
| 「Xの認証情報が設定されていません」 | Secrets の4つの名前が正しいか確認してください |
| 403 エラーで投稿できない | アプリの権限を Read and write にして、Access Token を作り直してください |
| 画像が付かない | `images/` にファイルがあるか、`products.csv` の `image` 列の名前と一致しているか確認してください |
| 20時ちょうどに投稿されない | GitHubの混み具合で数分〜数十分ずれます（仕様です） |

---

## 7. 既存の投稿ワークフローについて

このリポジトリには、`posts.txt` の文章を毎朝7時に投稿する `x-post.yml` も残っています。
不要な場合は、GitHubの Actions タブから無効化するか、ファイルを削除してください。
