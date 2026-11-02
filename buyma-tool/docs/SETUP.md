# 公開までの手順

上から順に進めれば、ホームページ・管理画面・API が動き、拡張機能とつながります。
秘密の値（API キーなど）は `.env.local` か Vercel の環境変数にだけ入れ、Git には入れないでください。
入れる項目の一覧は `web/.env.example` にあります。

## 1. Supabase（データベースとログイン）

1. https://supabase.com でプロジェクトを作る（地域は東京）
2. SQL Editor に `web/supabase/migrations/` の SQL を番号順（0001 → 0002）に貼って実行する
3. Settings → API の値を環境変数に入れる
   - `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`
4. Authentication → URL Configuration
   - Site URL：本番の URL（例 `https://example.com`）
   - Redirect URLs：`https://example.com/auth/callback` と `http://localhost:3000/auth/callback`
5. Authentication → Providers
   - Email：オン（「Confirm email」はオンのままがおすすめ）
   - Google：オンにして、Google Cloud で作った OAuth クライアントの ID と秘密の値を入れる
     （Google 側の「承認済みのリダイレクト URI」には Supabase の画面に出る URL を入れる）
6. Authentication → Email Templates の文面を日本語に直す（任意）

## 2. Claude API

1. https://console.anthropic.com で API キーを作り、`ANTHROPIC_API_KEY` に入れる
2. `CLAUDE_MODEL`（はじめは `claude-sonnet-5-5`）と `CLAUDE_EFFORT`（はじめは `low`）
3. 使いすぎ防止のため、Console で月の利用上限（Spend limit）を決めておく

## 3. Stripe（月額課金）

1. 商品を4つ（ミニ・ライト・スタンダード・プロ）作り、それぞれ「月額」と「年額」の価格を作る（円、税込）
   - ミニ 980円／9,800円、ライト 1,980円／19,800円、スタンダード 2,980円／29,800円、プロ 4,980円／49,800円
2. 8つの価格 ID を `STRIPE_PRICE_MINI_MONTHLY` などに入れる
3. 開発者 → Webhook で送り先を追加
   - URL：`https://example.com/api/stripe/webhook`
   - イベント：`checkout.session.completed`、`customer.subscription.created`、`customer.subscription.updated`、`customer.subscription.deleted`、`invoice.paid`
   - 表示された署名の秘密を `STRIPE_WEBHOOK_SECRET` に入れる
4. 設定 → Billing → カスタマーポータル：プランの変更（3つの価格を選べるように）・解約・カード変更をオンにする
5. まずはテストモードで全部試し、問題なければ本番モードのキーに入れ替える

無料お試しは Stripe ではなくこのアプリが管理しています（登録から7日間 または 10件、カード不要）。
お試し中に申し込んだ場合は、お試しの終わる日まで請求が始まりません。

## 4. Vercel（公開）

1. Vercel でこのリポジトリを読み込み、Root Directory を `buyma-tool/web` にする
2. 環境変数（`web/.env.example` の項目すべて）を入れる。`NEXT_PUBLIC_SITE_URL` は本番の URL
3. `CRON_SECRET` に長いランダムな文字列を入れる（毎朝7時17分（日本時間）の為替更新に使う。`vercel.json` に設定済み）
4. 公開したら、為替を1回手で取っておく：

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://example.com/api/cron/fx
```

## 5. Chrome 拡張

1. `extension/manifest.json` の `host_permissions` と `externally_connectable.matches` に本番のドメイン（例 `https://example.com/*`）を足す
2. Chrome で `chrome://extensions` → デベロッパー モード → 「パッケージ化されていない拡張機能を読み込む」で `extension` フォルダを選ぶ
3. 拡張の「設定」でサーバーの URL を本番の URL にし、「ログインして連携する」を押す
4. 一般に配るときは Chrome ウェブストアに出す。出したあとの拡張 ID を `NEXT_PUBLIC_EXTENSION_ID` に入れる
   （ストアの審査では、プライバシーポリシーの URL と、読み取るサイトの説明が必要）

## 6. 特定商取引法の表記

`NEXT_PUBLIC_SELLER_*` に販売事業者名・所在地・電話番号・メール・運営責任者を入れる。
入れるまでは「準備中」と表示されるので、公開前に必ず入れること。
