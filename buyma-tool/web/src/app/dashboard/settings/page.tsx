import { requireSession } from '../session';
import { latestFx, settingsFor } from '@/lib/account';
import { SettingsForm } from './SettingsForm';

export default async function SettingsPage() {
  const { profile } = await requireSession();
  const fx = await latestFx();
  return (
    <>
      <h1>設定</h1>
      <p className="muted small">説明文の言い回しと、販売価格の計算に使う値を決めます。下の「試算」で価格の結果を確かめられます。</p>
      <SettingsForm
        userId={profile.id}
        initial={settingsFor(profile)}
        fixedFx={profile.fixed_fx_rate ? Number(profile.fixed_fx_rate) : null}
        tone={profile.writing_tone === 'casual' ? 'casual' : 'polite'}
        dailyFx={fx}
      />
    </>
  );
}
