'use client';
import { useMemo, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/browser';
import { calculatePrice, DEFAULT_PRICING, validateSettings, type PricingSettings } from '@/lib/pricing';

type NumKey = Exclude<keyof PricingSettings, 'profitMode'>;
const FIELDS: { key: NumKey; label: string; unit: '%' | '円' | '元' | ''; hint?: string }[] = [
  { key: 'profitRate', label: '利益率', unit: '%', hint: '下の「利益の付け方」で意味が変わります' },
  { key: 'minProfitJpy', label: '最低利益', unit: '円', hint: '安い商品でもこれだけは残るようにします' },
  { key: 'buymaFeeRate', label: 'BUYMA の成約手数料率', unit: '%', hint: '仮の値です。ご自分の契約の率に直してください' },
  { key: 'internationalShippingJpy', label: '国際送料', unit: '円' },
  { key: 'domesticShippingCny', label: '中国国内の送料', unit: '元' },
  { key: 'agentFeeRate', label: '代行業者の手数料率', unit: '%' },
  { key: 'fxMarkupRate', label: '為替の上乗せ', unit: '%', hint: 'カード会社の手数料などの分' },
  { key: 'dutyRate', label: '関税・消費税の見込み', unit: '%', hint: '関税込みで売る場合。仕入れ値に対する率' },
  { key: 'otherCostJpy', label: 'その他の費用（梱包など）', unit: '円' },
  { key: 'roundTo', label: '端数の切り上げ単位', unit: '円', hint: '100 なら 4,321円 → 4,400円' },
];

const toInput = (k: NumKey, v: number) => (FIELDS.find((f) => f.key === k)?.unit === '%' ? +(v * 100).toFixed(2) : v);
const fromInput = (k: NumKey, v: number) => (FIELDS.find((f) => f.key === k)?.unit === '%' ? v / 100 : v);

export function SettingsForm(props: {
  userId: string;
  initial: PricingSettings;
  fixedFx: number | null;
  dailyFx: { rate: number; date: string } | null;
  tone: 'polite' | 'casual';
}) {
  const [tone, setTone] = useState<'polite' | 'casual'>(props.tone);
  const [s, setS] = useState<PricingSettings>(props.initial);
  const [fixed, setFixed] = useState<string>(props.fixedFx ? String(props.fixedFx) : '');
  const [sample, setSample] = useState('199');
  const [msg, setMsg] = useState<string | null>(null);

  const rate = fixed ? Number(fixed) : props.dailyFx?.rate ?? 0;
  const errors = validateSettings(s);
  const preview = useMemo(() => {
    try {
      return rate > 0 && Number(sample) > 0 && !errors.length ? calculatePrice(Number(sample), rate, s) : null;
    } catch {
      return null;
    }
  }, [s, rate, sample, errors.length]);

  async function save() {
    if (errors.length) return setMsg(errors.join(' / '));
    const fixedNum = fixed ? Number(fixed) : null;
    if (fixedNum !== null && !(fixedNum > 5 && fixedNum < 100)) return setMsg('固定レートは 1元＝○円 の数字で入れてください（例：21.5）');
    const { error } = await supabaseBrowser()
      .from('profiles')
      .update({ pricing_settings: s, fixed_fx_rate: fixedNum, writing_tone: tone })
      .eq('id', props.userId);
    setMsg(error ? '保存できませんでした' : '保存しました');
  }

  return (
    <div className="grid grid-2">
      <div className="card">
        <label htmlFor="tone">説明文の言い回し</label>
        <select id="tone" value={tone} onChange={(e) => setTone(e.target.value as 'polite' | 'casual')}>
          <option value="polite">ていねい（落ち着いた、品のある書き方）</option>
          <option value="casual">カジュアル（親しみやすく、軽やかな書き方）</option>
        </select>
        <p className="hint">お店の雰囲気に合わせて選べます。どちらも「です・ます」で書きます。</p>
        <label>利益の付け方</label>
        <select value={s.profitMode} onChange={(e) => setS({ ...s, profitMode: e.target.value as PricingSettings['profitMode'] })}>
          <option value="margin">売値に対する利益率（売値の○%が利益）</option>
          <option value="markup">費用に対する上乗せ率（費用に○%を足す）</option>
        </select>
        <div className="form-grid">
          {FIELDS.map((f) => (
            <div key={f.key}>
              <label htmlFor={f.key}>
                {f.label}
                {f.unit && <span className="muted small">（{f.unit}）</span>}
              </label>
              <input
                id={f.key}
                type="number"
                step="any"
                min={0}
                value={toInput(f.key, s[f.key])}
                onChange={(e) => setS({ ...s, [f.key]: fromInput(f.key, Number(e.target.value)) })}
              />
              {f.hint && <p className="hint">{f.hint}</p>}
            </div>
          ))}
        </div>
        <label htmlFor="fixed">為替レートを固定する（1元＝○円。空なら毎日自動）</label>
        <input id="fixed" type="number" step="any" value={fixed} onChange={(e) => setFixed(e.target.value)} placeholder={props.dailyFx ? `今日の自動レート ${props.dailyFx.rate.toFixed(2)}` : '例：21.5'} />
        <p className="row">
          <button className="btn" onClick={save}>保存</button>
          <button className="btn btn-ghost" onClick={() => setS(DEFAULT_PRICING)}>はじめの値に戻す</button>
        </p>
        {errors.length > 0 && <p className="error small">{errors.join(' / ')}</p>}
        {msg && <p className="notice small">{msg}</p>}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>試算</h2>
        <label htmlFor="sample">仕入れ値（元）</label>
        <input id="sample" type="number" min={1} value={sample} onChange={(e) => setSample(e.target.value)} />
        <p className="small muted">使うレート：{rate > 0 ? `1元＝${rate.toFixed(2)}円${fixed ? '（固定）' : '（自動）'}` : 'まだありません'}</p>
        {preview ? (
          <table>
            <tbody>
              <tr><td>商品代</td><td>¥{preview.productJpy.toLocaleString()}</td></tr>
              <tr><td>代行手数料</td><td>¥{preview.agentFeeJpy.toLocaleString()}</td></tr>
              <tr><td>中国国内送料</td><td>¥{preview.domesticShippingJpy.toLocaleString()}</td></tr>
              <tr><td>関税など</td><td>¥{preview.dutyJpy.toLocaleString()}</td></tr>
              <tr><td>国際送料</td><td>¥{preview.internationalShippingJpy.toLocaleString()}</td></tr>
              <tr><td>その他</td><td>¥{preview.otherCostJpy.toLocaleString()}</td></tr>
              <tr><th>費用の合計</th><th>¥{preview.totalCostJpy.toLocaleString()}</th></tr>
              <tr><th>販売価格</th><th className="ok">¥{preview.salePriceJpy.toLocaleString()}</th></tr>
              <tr><td>BUYMA 手数料</td><td>¥{preview.buymaFeeJpy.toLocaleString()}</td></tr>
              <tr><th>利益</th><th>¥{preview.profitJpy.toLocaleString()}（売値の{Math.round(preview.profitRateOfSale * 100)}%）</th></tr>
            </tbody>
          </table>
        ) : (
          <p className="muted small">値を入れると計算結果が出ます。</p>
        )}
      </div>
    </div>
  );
}
