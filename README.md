# 輝く未来教育 X自動投稿システム

毎朝7時(日本時間)に、AI(Claude)が投稿文を考えて、画像付きでXに自動投稿します。

## しくみ

- 投稿の種類は「共感ネタ / ワンポイントアドバイス / 前向きメッセージ / 季節・行事情報 / 商品紹介」
- 役立つ投稿を2〜3回続けた後に、商品紹介を1回入れるバランスで自動調整
- `history.json` に履歴を残し、同じ内容の連続を防止
- AIが使えないときは `posts.txt` の予備投稿文から自動で投稿(投稿が止まりません)

## ファイル構成

| ファイル | 役割 |
|---|---|
| `prompt.txt` | 投稿文のルール(トーンや文字数など)。編集すると投稿の雰囲気が変わります |
| `products.csv` | 商品リスト。**URLを実際の商品ページに書き換えると商品紹介が始まります**(example.com のままの商品は紹介されません) |
| `sale.txt` | セール情報を手動で書き足すファイル。書くと商品紹介で自然に触れます |
| `images/` | カテゴリー別の画像。商品紹介はそのカテゴリーの画像、それ以外の投稿はブランド画像を添付 |
| `posts.txt` | AIが使えないときの予備投稿文 |
| `history.json` | 投稿履歴(自動更新。編集不要) |
| `scripts/generate_and_post.py` | 投稿スクリプト |
| `.github/workflows/x-post.yml` | 毎朝7時に実行されるワークフロー |

## 必要なGitHub Secrets

リポジトリの Settings → Secrets and variables → Actions → New repository secret で登録:

| Secret名 | 内容 |
|---|---|
| `X_API_KEY` | X APIのAPI Key |
| `X_API_SECRET` | X APIのAPI Key Secret |
| `X_ACCESS_TOKEN` | X APIのAccess Token |
| `X_ACCESS_TOKEN_SECRET` | X APIのAccess Token Secret |
| `ANTHROPIC_API_KEY` | Claude APIのAPIキー |

## テスト方法

Actions タブ → 「X Auto Post」→「Run workflow」→ dry_run にチェック → Run。
実際には投稿せず、生成された投稿文をログで確認できます。
