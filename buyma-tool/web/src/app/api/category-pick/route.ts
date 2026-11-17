/** BUYMA の出品画面に出ている、カテゴリの候補の中から、合うものを AI に選んでもらう（「BUYMAに反映」で使う） */
import Anthropic from '@anthropic-ai/sdk';
import { getRequestUser } from '@/lib/auth';
import { json, preflight } from '@/lib/http';
import { accountActive, getAllowance, getProfile } from '@/lib/account';
import { AiRefusalError, CategoryPickSchema, pickCategoryOption } from '@/lib/ai';
import { costUsd } from '@/lib/cost';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { INACTIVE_REASON } from '@/lib/usage';

export const OPTIONS = preflight;
export const maxDuration = 30;

export async function POST(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return json(req, { error: 'ログインしてください' }, 401);
  const parsed = CategoryPickSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json(req, { error: 'カテゴリの候補の形が正しくありません' }, 400);

  const profile = await getProfile(user.id);
  if (!accountActive(profile)) return json(req, { error: INACTIVE_REASON }, 402);
  // 件数には数えないが、AI 費用の安全装置には数える
  const allowance = await getAllowance(profile);
  if (!allowance.allowed && allowance.remaining > 0) return json(req, { error: allowance.reason }, 402);

  try {
    const { index, usage, model } = await pickCategoryOption(parsed.data);
    await supabaseAdmin().from('usage_events').insert({
      user_id: user.id,
      kind: 'extract',
      model,
      input_tokens: usage.input_tokens + (usage.cache_read_input_tokens ?? 0),
      output_tokens: usage.output_tokens,
      cost_usd: costUsd(model, usage),
    });
    return json(req, { index });
  } catch (e) {
    if (e instanceof AiRefusalError) return json(req, { index: -1 });
    if (e instanceof Anthropic.APIError) return json(req, { error: 'うまく選べませんでした' }, 502);
    throw e;
  }
}
