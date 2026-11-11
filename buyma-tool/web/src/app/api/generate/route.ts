/**
 * 拡張機能から商品データを受け取り、AI で日本語の商品名・説明文を作って、販売価格を計算し、履歴に保存する。
 */
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { getRequestUser } from '@/lib/auth';
import { json, preflight } from '@/lib/http';
import { fxFor, getAllowance, getProfile, settingsFor } from '@/lib/account';
import { ProductSchema, colorsAndSizes, sourceText } from '@/lib/product';
import { AiRefusalError, composeDescription, generateListing } from '@/lib/ai';
import { calculatePrice } from '@/lib/pricing';
import { checkListing } from '@/lib/listingRules';
import { costUsd } from '@/lib/cost';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { CURRENCY_LABELS, normalizeCurrency } from '@/lib/fx';

export const OPTIONS = preflight;
export const maxDuration = 60;

const Body = z.object({
  product: ProductSchema,
  templateId: z.string().uuid().optional(),
  instruction: z.string().max(1000).optional(),
  /** 価格を手で決めたいとき（商品と同じ通貨） */
  costCny: z.number().positive().optional(),
});

export async function POST(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return json(req, { error: 'ログインしてください' }, 401);

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json(req, { error: '送られてきた商品データの形が正しくありません' }, 400);
  const { product, templateId, instruction, costCny } = parsed.data;
  if (!product.title) return json(req, { error: '商品名がないため作れません。スクショで補ってください' }, 400);

  const profile = await getProfile(user.id);
  const allowance = await getAllowance(profile);
  if (!allowance.allowed) return json(req, { error: allowance.reason, allowance }, 402);

  const db = supabaseAdmin();
  let tq = db.from('templates').select('body').eq('user_id', user.id);
  tq = templateId ? tq.eq('id', templateId) : tq.eq('is_default', true);
  const { data: template } = await tq.limit(1).maybeSingle();

  let result;
  try {
    result = await generateListing(product, instruction, undefined, profile.writing_tone === 'casual' ? 'casual' : 'polite');
  } catch (e) {
    if (e instanceof AiRefusalError) return json(req, { error: e.message }, 422);
    if (e instanceof Anthropic.RateLimitError) return json(req, { error: '混み合っています。少し待ってからもう一度お試しください' }, 503);
    if (e instanceof Anthropic.APIError) {
      console.error('Claude API error', e.status, e.message);
      return json(req, { error: 'うまく作れませんでした。時間をおいてお試しください' }, 502);
    }
    throw e;
  }
  const g = result.generated;
  const description = composeDescription(g, template?.body ?? '');

  // 価格：手で入れた値 → 商品の最低価格 の順に使う。通貨は商品ページの通貨
  const cny = costCny ?? product.price?.min ?? null;
  const currency = normalizeCurrency(product.price?.currency || 'CNY');
  const fx = currency ? await fxFor(profile, currency) : null;
  let breakdown = null;
  let priceError: string | null = null;
  if (!currency) {
    priceError = `通貨（${product.price?.currency ?? '不明'}）に対応していません。価格を確認・修正してください`;
  } else if (cny && fx) {
    try {
      breakdown = calculatePrice(cny, fx.rate, settingsFor(profile));
    } catch (e) {
      priceError = (e as Error).message;
    }
  } else {
    priceError = !fx
      ? `${CURRENCY_LABELS[currency]}の為替レートがまだありません。設定で固定レートを入れてください`
      : '仕入れ値がわかりません';
  }

  const issues = checkListing({ title: g.title, description, sourceText: sourceText(product) });
  const fallbackCs = colorsAndSizes(product);
  const colors = g.colors.length ? g.colors.map((c) => c.ja) : fallbackCs.colors;
  const sizes = g.sizes.length ? g.sizes.map((s) => s.ja) : fallbackCs.sizes;

  const { data: listing, error } = await db
    .from('listings')
    .insert({
      user_id: user.id,
      source: product.source,
      item_id: product.itemId || null,
      source_url: product.url || null,
      raw: product,
      title_ja: g.title,
      description_ja: description,
      colors,
      sizes,
      image_urls: product.images,
      price_jpy: breakdown?.salePriceJpy ?? null,
      cost_cny: cny,
      cost_currency: currency ?? 'CNY',
      brand: g.brand || null,
      category: g.category || null,
      fx_rate: fx?.rate ?? null,
      price_breakdown: breakdown,
      issues,
    })
    .select('id')
    .single();
  if (error || !listing) return json(req, { error: '保存に失敗しました' }, 500);

  await db.from('usage_events').insert({
    user_id: user.id,
    kind: 'generate',
    listing_id: listing.id,
    model: result.model,
    input_tokens: result.usage.input_tokens + (result.usage.cache_read_input_tokens ?? 0),
    output_tokens: result.usage.output_tokens,
    cost_usd: costUsd(result.model, result.usage),
  });

  return json(req, {
    listing: {
      id: listing.id,
      title: g.title,
      description,
      priceJpy: breakdown?.salePriceJpy ?? null,
      breakdown,
      priceError,
      colors,
      sizes,
      images: product.images,
      issues,
      cautions: g.cautions,
      category: g.category,
      brand: g.brand,
      material: g.material,
      shippingMethod: profile.shipping_method ?? '',
      currency,
    },
    allowance: { ...allowance, used: allowance.used + 1, remaining: Math.max(0, allowance.remaining - 1) },
  });
}
