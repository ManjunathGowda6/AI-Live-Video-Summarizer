import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ['lucide-react', 'framer-motion'],
  experimental: {
    optimizePackageImports: ['lucide-react', 'framer-motion'],
  }
};

export default nextConfig;
