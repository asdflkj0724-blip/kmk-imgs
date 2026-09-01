# BOBO BIRD X自動投稿システム

毎日1回、ショップの公開ページから商品情報を自動取得し、X（旧Twitter）へ画像付きで自動投稿します。

## 仕組み

```
GitHub Actions（毎日 日本時間12:15）
  → bobo/shop_scraper.py  ショップ公開ページから商品を取得（在庫切れは自動除外・新商品は自動追加）
  → bobo/compose.py       投稿バランス60/25/15・カレンダー・履歴を考慮して文章を生成
  → bobo/x_client.py      画像付きでXへ投稿（失敗時は別の商品・画像なしで再試行）
  → bobo/data/            商品データと投稿履歴を自動保存
```

- 商品情報は **公開ページのみ** から取得します（JSON-LD → OGP → HTML解析の順）。
  MakeShop・BASEなど特定サービスに依存しません。
- ショップを移転した場合は `bobo/config.yml` の `shop:` のURLを書き換えるだけです。
- 投稿の切り口（贈る相手・記念日など約20種類）、納期案内、正規代理店・保証の案内、
  吉幾三さん50周年モデルの実績などを、履歴を見ながらローテーションします。
- 母の日・父の日・敬老の日・クリスマスなどの約1か月前にはオーダーメイドの早期注文を促し、
  直前で納期が間に合わない時期は在庫のある既製品の提案に自動で切り替えます。

## 必要な設定（初回のみ）

GitHubリポジトリの Settings → Secrets and variables → Actions → New repository secret で
以下の4つを登録してください（X Developer Portalで取得。アプリ権限は Read and write）。

| Secret名 | 内容 |
|---|---|
| `BOBO_X_API_KEY` | API Key (Consumer Key) |
| `BOBO_X_API_SECRET` | API Key Secret |
| `BOBO_X_ACCESS_TOKEN` | Access Token |
| `BOBO_X_ACCESS_TOKEN_SECRET` | Access Token Secret |

## テスト方法

Actions タブ → `BOBO BIRD X Auto Post` → Run workflow →
「テスト実行」にチェックを入れて実行すると、**実際には投稿せず**に
生成される投稿内容をログで確認できます。

## 調整したいとき

- 投稿時刻: `.github/workflows/bobo-x-post.yml` の `cron`（UTC表記。日本時間−9時間）
- 投稿バランス・繰り返し防止の強さ: `bobo/config.yml`
- 文章の素材（切り口・言い回し・ハッシュタグ）: `bobo/content.py`
