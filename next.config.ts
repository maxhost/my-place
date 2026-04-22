import type { NextConfig } from 'next'
import path from 'node:path'

/**
 * Security headers baseline.
 * En dev se relaja CSP para HMR de Next; en prod es estricta.
 */
const isProd = process.env.NODE_ENV === 'production'

const cspDirectives = [
  "default-src 'self'",
  // Next necesita 'unsafe-inline' para hydration en dev. En prod usar nonces cuando se agregue SSR de formularios.
  `script-src 'self' ${isProd ? "'unsafe-inline'" : "'unsafe-inline' 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https: ws: wss:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=()' },
  { key: 'Content-Security-Policy', value: cspDirectives },
]

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ['@prisma/client', 'pino', 'pino-pretty'],
  typedRoutes: true,
  outputFileTracingRoot: path.join(__dirname),
  allowedDevOrigins: ['lvh.me', '*.lvh.me'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

export default nextConfig
