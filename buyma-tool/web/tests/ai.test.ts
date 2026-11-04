import { describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { composeDescription, generateListing, AiRefusalError, type Generated } from '@/lib/ai';
import { ProductSchema } from '@/lib/product';

const product = ProductSchema.parse({
  source: 'taobao',
  itemId: '1',
  title: '双面羊毛大衣女',
  price: { min: 459, max: 459, currency: 'CNY', raw: '459' },
  skus: [{ name: '颜色分类', values: [{ name: '驼色' }] }],
  specs: [{ name: '材质', value: '羊毛90%' }],
});

const generated: Generated = {
  title: 'ダブルフェイス ウール ロングコート ' + 'あ'.repeat(100),
  description: '柔らかいウールのコートです。',
  colors: [{ original: '驼色', ja: 'キャメル' }],
  sizes: [{ original: '均码', ja: 'フリーサイズ' }],
  sizeNote: '着丈 約110cm',
  material: 'ウール90%',
  category: 'レディース > アウター > コート',
  cautions: [],
};

function fakeClient(response: object) {
  const parse = vi.fn().mockResolvedValue(response);
  return { client: { beta: { messages: { parse } } } as unknown as Anthropic, parse };
}

describe('generateListing', () => {
  it('Sonnet に構造化出力で頼み、タイトルを上限に収める', async () => {
    const { client, parse } = fakeClient({
      stop_reason: 'end_turn',
      parsed_output: generated,
      model: 'claude-sonnet-5-5',
      usage: { input_tokens: 900, output_tokens: 400, cache_read_input_tokens: null, cache_creation_input_tokens: null },
    });
    const r = await generateListing(product, '', client);
    const args = parse.mock.calls[0][0];
    expect(args.model).toBe('claude-sonnet-5-5');
    expect(args.fallbacks).toBe('default');
    expect(args.output_config.format).toBeTruthy();
    expect(args.messages[0].content).toContain('双面羊毛大衣女');
    expect(args.messages[0].content).toContain('颜色分类: 驼色');
    expect(Array.from(r.generated.title).length).toBeLessThanOrEqual(60);
    expect(r.usage.input_tokens).toBe(900);
  });

  it('言い回し（ていねい・カジュアル）を指示に入れる', async () => {
    const ok = { stop_reason: 'end_turn', parsed_output: generated, model: 'm', usage: { input_tokens: 1, output_tokens: 1 } };
    const a = fakeClient(ok);
    await generateListing(product, '', a.client, 'casual');
    expect(a.parse.mock.calls[0][0].messages[0].content).toContain('言い回し：カジュアル');
    const b = fakeClient(ok);
    await generateListing(product, '', b.client);
    expect(b.parse.mock.calls[0][0].messages[0].content).toContain('言い回し：ていねい');
  });

  it('断られたら AiRefusalError', async () => {
    const { client } = fakeClient({ stop_reason: 'refusal', parsed_output: null, model: 'x', usage: { input_tokens: 1, output_tokens: 0 } });
    await expect(generateListing(product, '', client)).rejects.toBeInstanceOf(AiRefusalError);
  });
});

describe('composeDescription', () => {
  it('売れている出品の型（商品について→カラー→サイズ→素材→お届け）の順につなぐ', () => {
    const d = composeDescription(generated, '【お届け】2〜3週間');
    expect(d).toBe(
      '【商品について】\n柔らかいウールのコートです。\n\n【カラー】\nキャメル\n\n【サイズ】\nフリーサイズ\n着丈 約110cm\n\n【素材】\nウール90%\n\n【お届け】2〜3週間'
    );
  });
});
