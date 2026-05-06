import type { NextConfig } from 'next'
import path from 'node:path'

/**
 * Security headers baseline.
 * En dev se relaja CSP para HMR de Next; en prod es estricta.
 */
const isProd = process.env.NODE_ENV === 'production'

/**
 * Hostname del bucket público de Supabase Storage (avatares hoy, futuros
 * covers de library). Derivado de `NEXT_PUBLIC_SUPABASE_URL`: el host del
 * proyecto Supabase sirve `/storage/v1/object/public/<bucket>/<path>`.
 *
 * Si la env no está al cargar config, devolvemos undefined y `remotePatterns`
 * queda sin entry de Supabase — el optimizer rechaza el host en runtime con
 * un 400 explícito (mejor que cachear default 60s sobre un host no permitido).
 */
function supabaseStorageHostname(): string | undefined {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!raw) return undefined
  try {
    return new URL(raw).hostname
  } catch {
    return undefined
  }
}

const supabaseHost = supabaseStorageHostname()

const cspDirectives = [
  "default-src 'self'",
  // Next necesita 'unsafe-inline' para hydration en dev. En prod usar nonces cuando se agregue SSR de formularios.
  `script-src 'self' ${isProd ? "'unsafe-inline'" : "'unsafe-inline' 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https: ws: wss:",
  // R.7.7+: iframes de embeds externos en library items (YouTube,
  // Vimeo, Google Doc/Sheet). Sin esta directiva el browser bloquea
  // cualquier iframe externo con el mensaje "Este contenido está
  // bloqueado. Comunícate con el propietario del sitio…" — el msg
  // viene del browser, no del provider. Drive/Dropbox/generic los
  // renderizamos como card link (NO iframe), no necesitan acá.
  // El nocookie también lo permitimos por backward-compat con items
  // que se persistieron antes del revert.
  // F.4 (rich-text): nuevos hosts para embeds del Lexical composer —
  // Spotify (`open.spotify.com`), Apple Podcasts
  // (`embed.podcasts.apple.com`), Ivoox (`www.ivoox.com`).
  [
    'frame-src',
    'https://www.youtube.com',
    'https://www.youtube-nocookie.com',
    'https://player.vimeo.com',
    'https://docs.google.com',
    'https://open.spotify.com',
    'https://embed.podcasts.apple.com',
    'https://www.ivoox.com',
  ].join(' '),
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
  // R.2.5: opt-in al comportamiento Next 14 del route cache.
  // Next 15 default = 0s para dinámicas → cada navegación re-fetcha,
  // rompiendo el modelo "cache warm sin re-fetch" del swiper de zonas.
  // Con `dynamic: 30`, los swipes rápidos entre zonas dentro de 30s son
  // cache hit (cero queries Prisma); >30s dispara refresh automático
  // vía `shouldRefreshZone` en `shell/domain/swiper-snap.ts`.
  // Estáticas a 180s (default Next 15 = 300s; bajamos para no perder
  // revalidate semánticos demasiado tiempo).
  // Ver `docs/decisions/2026-04-26-zone-swiper.md` § Decisión 5.
  experimental: {
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
    // Tree-shake agresivo + barrel optimization para libs que se usan con
    // imports nombrados en muchos files. Evita que webpack arrastre el
    // index completo cuando sólo necesitamos un export. Impacto típico:
    // 5-30 kB shared. Lista cerrada para no entrar en babel-loader paths
    // raros.
    optimizePackageImports: [
      'lucide-react',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-popover',
      'sonner',
    ],
  },
  // Caché agresivo para avatares (y futuros covers de library) servidos vía
  // `next/image`. El optimizer de Next proxea las URLs externas, las
  // re-emite optimizadas y devuelve `Cache-Control: public, max-age=<TTL>`.
  //
  // - `minimumCacheTTL = 31536000` (1 año) → el browser y el CDN cachean
  //   por un año sin revalidar. Safe porque los paths de Supabase Storage
  //   incluyen el UUID del file: un upload nuevo genera URL nueva, no reuso.
  // - `remotePatterns` permite el host de Supabase Storage (avatares hoy,
  //   covers mañana). Se omite si `NEXT_PUBLIC_SUPABASE_URL` no está
  //   disponible al build — el optimizer responderá 400 hasta que se setee.
  //
  // OJO: el header `immutable` literal NO se puede setear desde acá; Next
  // sólo emite `public, max-age=...` en el optimizer. Para servir avatares
  // **directo** desde `<supabase>.supabase.co` (bypass del optimizer) hay
  // que pasar `cacheControl: '31536000'` en `storage.upload(..., options)`.
  // Ese upload helper todavía no existe en el repo; cuando se sume, el slice
  // dueño debe setear el cacheControl ahí.
  images: {
    minimumCacheTTL: 31536000,
    remotePatterns: supabaseHost
      ? [{ protocol: 'https', hostname: supabaseHost, pathname: '/storage/v1/object/public/**' }]
      : [],
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

export default nextConfig
