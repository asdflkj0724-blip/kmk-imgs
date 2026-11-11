import { requireSession } from '../session';
import { fixedRatesOf, latestFxAll, settingsFor } from '@/lib/account';
import { SettingsForm } from './SettingsForm';

export default async function SettingsPage() {
  const { profile } = await requireSession();
  const fx = await latestFxAll();
  return (
    <>
      <h1>設定</h1>
      <p className="muted small">説明文の言い回し・配送方法と、販売価格の計算に使う値を決めます。下の「試算」で価格の結果を確かめられます。</p>
      <SettingsForm
        userId={profile.id}
        initial={settingsFor(profile)}
        fixedRates={fixedRatesOf(profile)}
        shippingMethod={profile.shipping_method ?? ''}
        tone={profile.writing_tone === 'casual' ? 'casual' : 'polite'}
        dailyFx={fx}
      />
    </>
  );
}
