import type { NextConfig } from "next";

const contentSecurityPolicy = (connectSrc: string) => [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // unsafe-eval needed for Next.js dev
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src ${connectSrc}`,
  "frame-ancestors 'none'",
].join('; ')

// Only the QR tracking screens may reach Zebra Browser Print on this PC.
const zebraBrowserPrint = 'https://127.0.0.1:9101 http://127.0.0.1:9100'

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-XSS-Protection', value: '1; mode=block' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  {
    key: 'Content-Security-Policy',
    value: contentSecurityPolicy("'self'"),
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
]

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',

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

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
      // These come after the rule above, so they replace its value on these paths only.
      {
        source: '/tracking/:path*',
        headers: [{ key: 'Content-Security-Policy', value: contentSecurityPolicy(`'self' ${zebraBrowserPrint}`) }],
      },
      {
        source: '/admin/tracking',
        headers: [{ key: 'Content-Security-Policy', value: contentSecurityPolicy(`'self' ${zebraBrowserPrint}`) }],
      },
      {
        source: '/tracking/scan',
        headers: [{ key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' }],
      },
    ]
  },

  experimental: {
    serverActions: {
      allowedOrigins: ['localhost:3000'],
    },
  },
};

export default nextConfig;
