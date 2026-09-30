import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import type { NextConfig } from 'next';
config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });
const nextConfig: NextConfig = {
  experimental: { cpus: 1 },
  transpilePackages: ['@weavepad/shared'],
  ...(process.env.NEXT_OUTPUT === 'standalone' ? { output: 'standalone' as const } : {}),
  outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
};
export default nextConfig;
