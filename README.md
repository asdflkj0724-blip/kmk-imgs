# スニーカー X 自動投稿システム

毎日 20:00(日本時間)に `products.csv` から商品を1つ選び、画像付きで X(旧Twitter)へ自動投稿します。
20代男性向けに自然なトーンの文章を毎回少しずつ変えて生成し、文末に販売ページURLとハッシュタグ(3〜5個)を付けます。
同じ商品が連続しないよう `post_history.json` で履歴を管理します。

## ファイル構成

| ファイル | 役割 |
|---|---|
| `products.csv` | 商品リスト(商品名・ブランド・Amazon/楽天URL・画像ファイル名・特徴・カラー・サイズ・ハッシュタグ) |
| `images/` | 商品画像(CSVの「画像ファイル」列と同じ名前で置く。`\|`区切りで最大4枚) |
| `prompt.txt` | 投稿文のルール(トーン・必須要素・禁止事項) |
| `post_history.json` | 投稿履歴(自動更新。編集不要) |
| `scripts/sneaker_post.py` | 投稿スクリプト |
| `.github/workflows/sneaker-post.yml` | 毎日20:00(JST)の自動実行設定 |

## 商品の追加方法

1. `images/` に商品画像をアップロード
2. `products.csv` に1行追加(「画像ファイル」列にその画像名を書く)

URLが未設定(`XXXXXXXXXX` のまま)の行や画像が無い行は自動でスキップされます。

## 手動テスト

GitHub の **Actions → Sneaker X Auto Post → Run workflow** から実行できます。
「投稿せず文章の確認だけ行う」にチェックを入れると、Xに投稿せずに生成された文章だけログで確認できます。

## 認証情報(GitHub Secrets)

**Settings → Secrets and variables → Actions** に以下を登録します(コードには書かない):

- `X_API_KEY` / `X_API_SECRET` / `X_ACCESS_TOKEN` / `X_ACCESS_TOKEN_SECRET` … X API の認証情報(必須)
- `ANTHROPIC_API_KEY` … 任意。設定すると Claude AI がより自然な文章を生成(未設定でもテンプレート方式で動作)

X API のキーは https://developer.x.com/ で無料プランのアプリを作成し、
**App permissions を「Read and write」にしてから** Access Token を発行してください。
