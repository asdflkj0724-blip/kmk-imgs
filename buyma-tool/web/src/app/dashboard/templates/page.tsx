import { requireSession } from '../session';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { TemplatesEditor, type Template } from './TemplatesEditor';

export default async function TemplatesPage() {
  const { profile } = await requireSession();
  const { data } = await supabaseAdmin().from('templates').select('id, name, body, is_default').eq('user_id', profile.id).order('created_at');
  return (
    <>
      <h1>テンプレート</h1>
      <p className="muted small">AI が作った説明文の後ろに、そのまま付ける文章です。配送日数・関税・注意事項などを入れておきます。</p>
      <TemplatesEditor userId={profile.id} initial={(data ?? []) as Template[]} />
    </>
  );
}
