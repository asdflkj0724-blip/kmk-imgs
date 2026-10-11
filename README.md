# 輝く未来教育 X自動投稿システム

毎朝7時(日本時間)に、AI(Claude)が投稿文を考えて、画像付きでXに自動投稿します。

## 投稿の形式(毎回共通)

1. **小学校受験に役立つミニヒント**(日替わりテーマ: お話の記憶・季節問題・面接・行動観察・数・巧緻性・願書 など15種類)
2. **お母さまへの短い励まし**
3. 末尾に固定の一行 **「学校別の出題傾向・対策はこちら → AmazonストアURL」** と **#輝く未来教育**

- テーマは直近6日間と重複しないよう自動で日替わり
- 3日に1回程度、ヒントの代わりに「心に響く短い言葉」(保護者に寄り添うオリジナルの一言)を投稿
- `history.json` に履歴を残し、同じ内容・表現の繰り返しを防止
- 画像はブランド画像+学校別ガイド画像から日替わりで添付(最近使ったものは避ける)
- AIが使えないときは `posts.txt` の予備投稿文から自動で投稿(投稿が止まりません)

## ファイル構成

| ファイル | 役割 |
|---|---|
| `prompt.txt` | 投稿文のルール(トーンや文字数など)。編集すると投稿の雰囲気が変わります |
| `products.csv` | 商品リスト。**「学校別対策ガイド」行のURLが締めの一行に使われます**。季節カード・ロボテルの行はメイン訴求には使いません |
| `sale.txt` | セール情報を手動で書き足すファイル。書くと投稿内でひと言自然に触れます |
| `images/` | 添付画像(ブランド/学校別対策ガイド のフォルダを使用) |
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
