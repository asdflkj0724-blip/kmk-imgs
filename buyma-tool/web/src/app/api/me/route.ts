import { getRequestUser } from '@/lib/auth';
import { json, preflight } from '@/lib/http';
import { accountActive, fxFor, getAllowance, getProfile, planName } from '@/lib/account';
import { INACTIVE_REASON } from '@/lib/usage';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { TITLE_MAX } from '@/lib/listingRules';

export const OPTIONS = preflight;

export async function GET(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return json(req, { error: 'ログインしてください' }, 401);
  const profile = await getProfile(user.id);
  const [allowance, fx, templates] = await Promise.all([
    getAllowance(profile),
    fxFor(profile),
    supabaseAdmin().from('templates').select('id, name, is_default').eq('user_id', user.id).order('created_at'),
  ]);
  return json(req, {
    email: profile.email,
    plan: profile.plan,
    planName: planName(profile),
    active: accountActive(profile),
    inactiveReason: accountActive(profile) ? null : INACTIVE_REASON,
    allowance,
    templates: templates.data ?? [],
    fx,
    titleMax: TITLE_MAX,
  });
}
