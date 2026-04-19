import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Strict mode for better development
  reactStrictMode: true,

  // For Capacitor static export, uncomment when building for mobile:
  // output: 'export',
  // trailingSlash: true,

  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
      },
    ],
  },

  experimental: {
    // Enable server actions
    serverActions: {
      allowedOrigins: ['localhost:3000'],
    },
  },
};

export default nextConfig;
