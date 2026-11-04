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
