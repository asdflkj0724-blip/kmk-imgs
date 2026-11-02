import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 拡張機能からの API 呼び出しを許可する（CORS は各 API ルートで付ける）
  poweredByHeader: false,
};

export default nextConfig;
