import { requireSession } from '../session';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { ListingsTable, type ListingItem } from './ListingsTable';

export default async function ListingsPage() {
  const { profile } = await requireSession();
  const { data } = await supabaseAdmin()
    .from('listings')
    .select('id, title_ja, description_ja, price_jpy, status, status_note, image_urls, source_url, issues, created_at')
    .eq('user_id', profile.id)
    .order('created_at', { ascending: false })
    .limit(300);
  return (
    <>
      <h1>出品履歴</h1>
      <p className="muted small">拡張機能で作った出品データの一覧です。最新300件を表示しています。</p>
      <ListingsTable initial={(data ?? []) as ListingItem[]} />
    </>
  );
}
