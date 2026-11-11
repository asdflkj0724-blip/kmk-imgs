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
