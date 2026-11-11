-- ラク出品：データベースの準備（まとめて1回だけ実行する）
-- Supabase の「SQL Editor」→「New query」に、このファイルの中身を全部貼り付けて「Run」を押してください。
-- 中身は migrations/ の 0001〜0005 を順番につなげたものです。2回目は実行しないでください（「すでにある」というエラーになります）。


-- ===== migrations/0001_init.sql =====
-- BUYMA出品支援ツール：データベースの初期設定
-- Supabase の SQL Editor に貼って実行するか、supabase db push で反映する。

-- ユーザーごとの情報（ログインの仕組み auth.users と1対1）
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  plan text not null default 'trial' check (plan in ('trial', 'light', 'standard', 'pro')),
  billing_interval text check (billing_interval in ('month', 'year')),
  trial_ends_at timestamptz,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  subscription_status text,
  current_period_end timestamptz,
  pricing_settings jsonb not null default '{}'::jsonb,
  fixed_fx_rate numeric,
  referral_code text unique not null default substr(md5(random()::text), 1, 8),
  referred_by uuid references public.profiles (id),
  referral_rewarded boolean not null default false,
  created_at timestamptz not null default now()
);

-- 説明文の後ろに付けるテンプレート（配送日数・関税・注意事項など）
create table public.templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  body text not null default '',
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index templates_user_idx on public.templates (user_id);

-- 作った出品データ（履歴）
create table public.listings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  source text,
  item_id text,
  source_url text,
  raw jsonb not null,
  title_ja text,
  description_ja text,
  colors text[] not null default '{}',
  sizes text[] not null default '{}',
  image_urls text[] not null default '{}',
  price_jpy integer,
  cost_cny numeric,
  fx_rate numeric,
  price_breakdown jsonb,
  issues jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'queued', 'filled', 'listed', 'failed')),
  status_note text,
  buyma_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index listings_user_created_idx on public.listings (user_id, created_at desc);

-- AI を使った記録（回数の上限と、費用の確認に使う）
create table public.usage_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('generate', 'vision')),
  listing_id uuid references public.listings (id) on delete set null,
  model text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd numeric not null default 0,
  created_at timestamptz not null default now()
);
create index usage_user_created_idx on public.usage_events (user_id, created_at);

-- 毎日の為替レート
create table public.fx_rates (
  date date primary key,
  cny_jpy numeric not null,
  source text not null,
  fetched_at timestamptz not null default now()
);

-- 無料ガイドの申し込み・お問い合わせ
create table public.leads (
  id bigint generated always as identity primary key,
  email text not null,
  source text not null default 'guide',
  created_at timestamptz not null default now()
);
create table public.contacts (
  id bigint generated always as identity primary key,
  name text,
  email text not null,
  message text not null,
  created_at timestamptz not null default now()
);

-- Stripe のイベントを2回処理しないための記録
create table public.stripe_events (
  id text primary key,
  type text not null,
  created_at timestamptz not null default now()
);

-- 新しくユーザーが登録されたら、プロフィールとお試し期間・最初のテンプレートを作る
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ref_id uuid;
  trial_days integer := 7;
begin
  if new.raw_user_meta_data ? 'ref' then
    select id into ref_id from public.profiles where referral_code = new.raw_user_meta_data ->> 'ref';
    if ref_id is not null then
      trial_days := 30; -- 紹介で来た人は1か月無料
    end if;
  end if;
  insert into public.profiles (id, email, trial_ends_at, referred_by)
  values (new.id, new.email, now() + make_interval(days => trial_days), ref_id);
  insert into public.templates (user_id, name, body, is_default) values (
    new.id, '基本テンプレート',
    E'【お届けについて】\nご注文をいただいてから買い付けを行います。お届けまで2〜3週間ほどかかります。\n\n【関税について】\n関税は販売価格に含まれています。\n\n【ご注意】\n海外製品のため、縫製や仕上がりに多少の個体差がある場合がございます。\nモニターにより実物と色味が異なって見えることがございます。',
    true
  );
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- 誰が何を見られるか（行レベルのセキュリティ）
alter table public.profiles enable row level security;
alter table public.templates enable row level security;
alter table public.listings enable row level security;
alter table public.usage_events enable row level security;
alter table public.fx_rates enable row level security;
alter table public.leads enable row level security;
alter table public.contacts enable row level security;
alter table public.stripe_events enable row level security;

create policy "own profile read" on public.profiles for select using (auth.uid() = id);
-- プランや Stripe の項目はサーバー（service role）だけが書き換える。本人が直せるのは設定だけ
create policy "own profile settings" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);
revoke update on public.profiles from authenticated;
grant update (pricing_settings, fixed_fx_rate) on public.profiles to authenticated;

create policy "own templates" on public.templates for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own listings read" on public.listings for select using (auth.uid() = user_id);
create policy "own listings update" on public.listings for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own listings delete" on public.listings for delete using (auth.uid() = user_id);
revoke update on public.listings from authenticated;
grant update (title_ja, description_ja, price_jpy, status, status_note, buyma_url, updated_at) on public.listings to authenticated;
create policy "own usage read" on public.usage_events for select using (auth.uid() = user_id);
create policy "fx read" on public.fx_rates for select using (true);
-- leads / contacts / stripe_events はサーバーだけが書く（ポリシーなし＝一般ユーザーは触れない）

-- ===== migrations/0002_mini_plan.sql =====
-- 入口の「ミニ」プラン（月980円・30件）を追加
alter table public.profiles drop constraint if exists profiles_plan_check;
alter table public.profiles add constraint profiles_plan_check check (plan in ('trial', 'mini', 'light', 'standard', 'pro'));

-- ===== migrations/0003_writing_tone.sql =====
-- お店ごとの言い回し（ていねい・カジュアル）と、説明文テンプレートの見出しを「お届け目安」に
alter table public.profiles add column if not exists writing_tone text not null default 'polite'
  check (writing_tone in ('polite', 'casual'));
grant update (writing_tone) on public.profiles to authenticated;

-- 新しく登録した人の最初のテンプレートを「売れている出品の型」の【お届け目安】に合わせる
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ref_id uuid;
  trial_days integer := 7;
begin
  if new.raw_user_meta_data ? 'ref' then
    select id into ref_id from public.profiles where referral_code = new.raw_user_meta_data ->> 'ref';
    if ref_id is not null then
      trial_days := 30; -- 紹介で来た人は1か月無料
    end if;
  end if;
  insert into public.profiles (id, email, trial_ends_at, referred_by)
  values (new.id, new.email, now() + make_interval(days => trial_days), ref_id);
  insert into public.templates (user_id, name, body, is_default) values (
    new.id, '基本テンプレート',
    E'【お届け目安】\nご注文をいただいてから買い付けを行うため、お届けまで2〜3週間ほどかかります。\n\n【関税について】\n関税は販売価格に含まれています。\n\n【ご注意】\n海外製品のため、縫製や仕上がりに多少の個体差がある場合がございます。\nモニターにより、実物と色味が異なって見えることがございます。',
    true
  );
  return new;
end $$;

-- ===== migrations/0004_any_site.sql =====
-- どのサイトでも使えるようにする：通貨ごとの為替、配送方法、AI 読み取りの記録

-- 為替を通貨ごとに持つ（これまでは人民元だけ）
alter table public.fx_rates add column if not exists currency text not null default 'CNY';
alter table public.fx_rates drop constraint if exists fx_rates_pkey;
alter table public.fx_rates add primary key (date, currency);

-- 通貨ごとの固定レート（例：{"CNY": 21.5, "KRW": 0.11}）と、BUYMA の配送方法
alter table public.profiles add column if not exists fixed_fx_rates jsonb not null default '{}'::jsonb;
alter table public.profiles add column if not exists shipping_method text not null default '';
update public.profiles set fixed_fx_rates = jsonb_build_object('CNY', fixed_fx_rate) where fixed_fx_rate is not null;
grant update (fixed_fx_rates, shipping_method) on public.profiles to authenticated;

-- 仕入れ値の通貨
alter table public.listings add column if not exists cost_currency text not null default 'CNY';
alter table public.listings add column if not exists brand text;
alter table public.listings add column if not exists category text;

-- AI でページを読み取った記録も、費用の安全装置に数える
alter table public.usage_events drop constraint if exists usage_events_kind_check;
alter table public.usage_events add constraint usage_events_kind_check check (kind in ('generate', 'vision', 'extract'));

-- ===== migrations/0005_waitlist.sql =====
-- ホームページのメール登録（ツール完成前に、興味がある人を集める）
-- 同じメールアドレス・同じ申し込み元は1件だけにする
update public.leads set email = lower(trim(email));
delete from public.leads a using public.leads b
  where a.id > b.id and a.email = b.email and a.source = b.source;
alter table public.leads add constraint leads_email_source_key unique (email, source);
