-- 入口の「ミニ」プラン（月980円・30件）を追加
alter table public.profiles drop constraint if exists profiles_plan_check;
alter table public.profiles add constraint profiles_plan_check check (plan in ('trial', 'mini', 'light', 'standard', 'pro'));
