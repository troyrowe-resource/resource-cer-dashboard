/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // ESLint is optional for this project; type-safety is enforced by `tsc` (strict) instead.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
