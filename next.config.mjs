/** @type {import('next').NextConfig} */
const nextConfig = {
  // firebase-admin はサーバー専用。バンドルせず Node の require に任せる
  serverExternalPackages: ['firebase-admin'],
  // 「相談」が方針の文書を読むので、サーバー関数に同梱する
  outputFileTracingIncludes: {
    '/api/chat': ['./CLAUDE.md', './docs/claude-memory/*.md'],
    '/chat': ['./CLAUDE.md', './docs/claude-memory/*.md'],
  },
};

export default nextConfig;
