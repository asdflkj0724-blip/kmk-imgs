import type { Metadata } from 'next';
import '../marketing.css';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import GuideForm from './GuideForm';

export const metadata: Metadata = {
  title: 'BUYMAの始め方 無料ガイド',
  description: 'BUYMAのショッパー登録から、タオバオ仕入れ、価格の決め方、出品のコツまで。はじめての方向けの無料ガイドです。',
};

export default function GuidePage() {
  return (
    <>
      <SiteHeader />
      <main className="prose">
        <h1>BUYMAの始め方 無料ガイド</h1>
        <p>副業でBUYMAを始めたい方、始めたばかりの方向けに、最初に知っておきたいことを1冊にまとめました。</p>
        <ul>
          <li>BUYMAショッパー登録の流れ</li>
          <li>タオバオ仕入れの基本</li>
          <li>赤字にならない価格の決め方</li>
          <li>偽物を扱わないための注意</li>
          <li>売れる出品のコツ</li>
        </ul>
        <div className="card">
          <GuideForm />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
