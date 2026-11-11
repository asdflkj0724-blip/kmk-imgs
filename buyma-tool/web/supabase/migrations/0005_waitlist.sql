-- ホームページのメール登録（ツール完成前に、興味がある人を集める）
-- 同じメールアドレス・同じ申し込み元は1件だけにする
update public.leads set email = lower(trim(email));
delete from public.leads a using public.leads b
  where a.id > b.id and a.email = b.email and a.source = b.source;
alter table public.leads add constraint leads_email_source_key unique (email, source);
