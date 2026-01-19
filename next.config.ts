import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_USE_CADENCE_FIX: 'true',
    NEXT_PUBLIC_DEBUG_PAYMENTS: 'true',
  },
  typescript: {
    // !! WARN !!
    // Dangerously allow production builds to successfully complete even if
    // your project has type errors.
    // !! WARN !!
    ignoreBuildErrors: true,
  },
  eslint: {
    // Warning: This allows production builds to successfully complete even if
    // your project has ESLint errors.
    ignoreDuringBuilds: true,
  },
  // Performance optimizations
  compress: true, // Enable gzip compression
  poweredByHeader: false, // Remove X-Powered-By header for security
  reactStrictMode: true, // Enable React strict mode for better development experience
  
  // Optimize package imports to reduce bundle size
  experimental: {
    optimizePackageImports: [
      '@heroicons/react',
      'date-fns',
      '@headlessui/react'
    ],
  },
  
  // Webpack configuration to handle client-side only packages
  webpack: (config, { isServer }) => {
    // Exclude html2canvas from server-side bundle (client-side only)
    if (isServer) {
      config.externals = config.externals || []
      config.externals.push('html2canvas')
    }
    return config
  },
  
  // Optimize images
  images: {
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 60,
  },
};

export default nextConfig;
