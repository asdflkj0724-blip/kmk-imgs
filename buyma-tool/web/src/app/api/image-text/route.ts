/** 画像の中の文字（拡張機能で読み取ったもの）を日本語に訳す。画像そのものは受け取らない */
import Anthropic from '@anthropic-ai/sdk';
import { getRequestUser } from '@/lib/auth';
import { json, preflight } from '@/lib/http';
import { accountActive, getAllowance, getProfile } from '@/lib/account';
import { AiRefusalError, ImageTextSchema, translateImageText } from '@/lib/ai';
import { costUsd } from '@/lib/cost';
import { fixChineseTerms } from '@/lib/listingRules';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { INACTIVE_REASON } from '@/lib/usage';

export const OPTIONS = preflight;
export const maxDuration = 60;

export async function POST(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return json(req, { error: 'ログインしてください' }, 401);
  const parsed = ImageTextSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json(req, { error: '画像の文字の形が正しくありません' }, 400);

  const profile = await getProfile(user.id);
  if (!accountActive(profile)) return json(req, { error: INACTIVE_REASON }, 402);
  // 件数には数えないが、AI 費用の安全装置には数える
  const allowance = await getAllowance(profile);
  if (!allowance.allowed && allowance.remaining > 0) return json(req, { error: allowance.reason }, 402);

  try {
    const { ja, usage, model } = await translateImageText(parsed.data);
    await supabaseAdmin().from('usage_events').insert({
      user_id: user.id,
      kind: 'extract',
      model,
      input_tokens: usage.input_tokens + (usage.cache_read_input_tokens ?? 0),
      output_tokens: usage.output_tokens,
      cost_usd: costUsd(model, usage),
    });
    // 中国語が残っていたら、決まった日本語に直す
    return json(req, { ja: ja.map((t) => (t ? fixChineseTerms(t).text : '')) });
  } catch (e) {
    if (e instanceof AiRefusalError) return json(req, { ja: parsed.data.lines.map(() => '') });
    if (e instanceof Anthropic.APIError) return json(req, { error: '画像の文字を訳せませんでした' }, 502);
    throw e;
  }
}
