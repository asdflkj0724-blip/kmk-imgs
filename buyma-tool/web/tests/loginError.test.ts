import { describe, expect, it } from 'vitest';
import { loginErrorMessage } from '@/app/login/LoginForm';

describe('ログインのエラー表示', () => {
  it('よくある原因は日本語で知らせる', () => {
    expect(loginErrorMessage('email rate limit exceeded')).toMatch(/1時間ほど/);
    expect(loginErrorMessage('Invalid API key')).toMatch(/Supabase のキー/);
    expect(loginErrorMessage('Database error saving new user')).toMatch(/データベース/);
    expect(loginErrorMessage('Failed to fetch')).toMatch(/つながりません/);
  });
  it('わからないものは、原因の文字をそのまま付ける', () => {
    expect(loginErrorMessage('something odd')).toContain('（詳しい内容：something odd）');
  });
});
