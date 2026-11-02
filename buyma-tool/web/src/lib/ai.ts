/**
 * Claude API で BUYMA 向けの日本語タイトル・説明文を作る。サーバー側でだけ使う。
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { TITLE_MAX, fitTitle } from './listingRules';
import type { Product } from './product';
import type { TokenUsage } from './cost';

export const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
type Effort = 'low' | 'medium' | 'high';
const EFFORT: Effort = (['low', 'medium', 'high'] as const).includes(process.env.CLAUDE_EFFORT as Effort)
  ? (process.env.CLAUDE_EFFORT as Effort)
  : 'low';

let _client: Anthropic | null = null;
export function anthropic(): Anthropic {
  if (!_client) _client = new Anthropic();
  return _client;
}

export const GeneratedSchema = z.object({
  title: z.string().describe(`BUYMA の商品名。日本語で${TITLE_MAX}文字以内`),
  description: z.string().describe('商品の説明（素材・特徴・サイズ感など）。日本語。配送や注意事項は書かない'),
  colors: z.array(z.object({ original: z.string(), ja: z.string() })).describe('色の選択肢の日本語訳'),
  sizes: z.array(z.object({ original: z.string(), ja: z.string() })).describe('サイズの選択肢（日本語の表記に直したもの）'),
  material: z.string().describe('素材（わからなければ空文字）'),
  category: z.string().describe('BUYMA のカテゴリの候補（例：レディースファッション > アウター > コート）'),
  cautions: z.array(z.string()).describe('出品者への注意（偽物の疑い、ブランド名の扱い、情報不足など）。なければ空'),
});
export type Generated = z.infer<typeof GeneratedSchema>;

const SYSTEM = `あなたは BUYMA（日本の海外通販サイト）のパーソナルショッパーの出品作業を手伝う担当者です。
海外の通販サイト（主にタオバオ・天猫）の商品情報をもとに、日本の買い物客に伝わる商品名と説明文を作ります。

商品名のルール：
- ${TITLE_MAX}文字以内の自然な日本語。検索されやすい言葉（アイテム名、素材、特徴）を入れる
- 仕入れ元の情報に書かれていないことは書かない
- ブランド名は、仕入れ元にはっきり正規品と書かれている場合以外は入れない。「同款」「大牌」は「〇〇風」の意味なのでブランド名に置き換えない
- 「最安」「激安」「送料無料」「即納」「100%」などの誇大な言葉、記号の連打は使わない

説明文のルール：
- 2〜6段落、合計600字程度まで。素材、デザインの特徴、サイズ感、使う場面を、仕入れ元の情報の範囲で書く
- 配送日数・関税・返品などの注意事項は書かない（出品者のテンプレートが後ろに付くため）
- 色とサイズは日本の通販で使われる表記にする（例：驼色→キャメル、均码→フリーサイズ）

偽物を思わせる言葉（高仿、复刻、原单、1:1 など）や、ブランドのロゴ・デザインの写しと思われる場合は、cautions に必ず書く。
入力は中国語のほか、英語・韓国語・イタリア語・フランス語などのこともある。どの言語でも日本語で出力する。`;

function productPrompt(p: Product): string {
  const lines = [
    `仕入れ先: ${p.source}`,
    `商品名（原文）: ${p.title}`,
    p.price ? `価格: ${p.price.min === p.price.max ? p.price.min : `${p.price.min}〜${p.price.max}`} ${p.price.currency}` : '',
    ...p.skus.map((g) => `${g.name}: ${g.values.map((v) => v.name + (v.disabled ? '（品切れ）' : '')).join(' / ')}`),
    ...(p.specs.length ? ['仕様:', ...p.specs.map((s) => `- ${s.name}: ${s.value}`)] : []),
  ];
  return lines.filter(Boolean).join('\n');
}

export interface GenerateResult {
  generated: Generated;
  usage: TokenUsage;
  model: string;
}

export class AiRefusalError extends Error {}

function readUsage(u: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }): TokenUsage {
  return {
    input_tokens: u.input_tokens,
    output_tokens: u.output_tokens,
    cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
    cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
  };
}

export async function generateListing(product: Product, extraInstruction = '', client = anthropic()): Promise<GenerateResult> {
  const content = productPrompt(product) + (extraInstruction ? `\n\n出品者からの追加の指示:\n${extraInstruction.slice(0, 1000)}` : '');
  const res = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    // 断られたときは、サーバー側で別のモデルに自動で切り替える
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM,
    output_config: { effort: EFFORT, format: betaZodOutputFormat(GeneratedSchema) },
    messages: [{ role: 'user', content }],
  });
  if (res.stop_reason === 'refusal') throw new AiRefusalError('この商品の文章は作れませんでした');
  if (!res.parsed_output) throw new Error(`AI の出力を読み取れませんでした（${res.stop_reason}）`);
  const generated = { ...res.parsed_output, title: fitTitle(res.parsed_output.title) };
  return { generated, usage: readUsage(res.usage), model: res.model };
}

/** スクリーンショットから商品情報を読み取る（拡張機能で取れなかったときの逃げ道） */
export const VisionSchema = z.object({
  title: z.string(),
  priceMin: z.number().nullable(),
  priceMax: z.number().nullable(),
  currency: z.string(),
  skus: z.array(z.object({ name: z.string(), values: z.array(z.string()) })),
  specs: z.array(z.object({ name: z.string(), value: z.string() })),
});
export type VisionResult = z.infer<typeof VisionSchema>;

export async function readScreenshot(
  imageBase64: string,
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp',
  client = anthropic()
): Promise<{ result: VisionResult; usage: TokenUsage; model: string }> {
  const res = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: EFFORT, format: betaZodOutputFormat(VisionSchema) },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
          {
            type: 'text',
            text: '通販サイトの商品ページのスクリーンショットです。商品名（原文のまま）、価格（数字のみ。幅があれば最小と最大）、通貨（CNY など）、SKU（色・サイズなどの項目と選択肢）、仕様（素材など）を読み取ってください。読めない項目は空にしてください。',
          },
        ],
      },
    ],
  });
  if (res.stop_reason === 'refusal') throw new AiRefusalError('画像を読み取れませんでした');
  if (!res.parsed_output) throw new Error(`AI の出力を読み取れませんでした（${res.stop_reason}）`);
  return { result: res.parsed_output, usage: readUsage(res.usage), model: res.model };
}

/** 説明文の完成形：AI の本文＋色・サイズ＋出品者のテンプレート */
export function composeDescription(g: Generated, templateBody: string): string {
  const parts = [g.description.trim()];
  if (g.colors.length) parts.push('【カラー】\n' + g.colors.map((c) => c.ja).join(' / '));
  if (g.sizes.length) parts.push('【サイズ】\n' + g.sizes.map((s) => s.ja).join(' / '));
  if (g.material) parts.push('【素材】\n' + g.material);
  if (templateBody.trim()) parts.push(templateBody.trim());
  return parts.join('\n\n');
}
