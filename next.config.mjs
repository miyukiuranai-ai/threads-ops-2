/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['firebase-admin', '@anthropic-ai/sdk'],
  experimental: {
    serverActions: { bodySizeLimit: '4mb' },
  },
};
export default nextConfig;
