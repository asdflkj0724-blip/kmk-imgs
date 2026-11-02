import { requireSession } from '../session';
import { latestFx, settingsFor } from '@/lib/account';
import { SettingsForm } from './SettingsForm';

export default async function SettingsPage() {
  const { profile } = await requireSession();
  const fx = await latestFx();
  return (
    <>
      <h1>価格の設定</h1>
      <p className="muted small">ここで決めた値で、販売価格を自動で計算します。下の「試算」で結果を確かめられます。</p>
      <SettingsForm
        userId={profile.id}
        initial={settingsFor(profile)}
        fixedFx={profile.fixed_fx_rate ? Number(profile.fixed_fx_rate) : null}
        dailyFx={fx}
      />
    </>
  );
}
