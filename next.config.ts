import type { NextConfig } from "next";
import path from "node:path";
import createNextIntlPlugin from "next-intl/plugin";
import withBundleAnalyzer from "@next/bundle-analyzer";
import { withSentryConfig } from "@sentry/nextjs";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// `ANALYZE=true pnpm build` abre el treemap. La ruta de la landing debe
// aparecer con 0 KB de First Load JS propio (README §Performance).
const withAnalyzer = withBundleAnalyzer({ enabled: process.env.ANALYZE === "true" });

// Security headers — Phase 0.D. Aplican a TODAS las rutas (`source: "/(.*)"`).
//
// ## Headers incluidos
//
// - `Strict-Transport-Security`: 2 años (63072000s) + includeSubDomains +
//   preload. Una vez en preload list, downgrade a HTTP imposible vía DNS-
//   hijack. Aplica también a subdominios (`*.place.community`) y custom
//   domains (que ya sirven HTTPS via Vercel auto-SSL).
//
// - `X-Frame-Options: DENY`: cero embedding en iframe (anti-clickjacking).
//   No tenemos uso legítimo de embedding cross-domain V1; si surge (e.g.
//   custom domain quiere embedear a otro custom domain), revisar caso a caso.
//
// - `Referrer-Policy: strict-origin-when-cross-origin`: navegaciones cross-
//   origin leakeán SÓLO el origin (sin path/query). Same-origin envía URL
//   completa. Balance entre privacy + analytics interno.
//
// - `Permissions-Policy`: bloquea geolocation/camera/microphone (no usadas
//   V1). Si V1.3 introduce uno, agregar `allow=self` puntual.
//
// - `X-Content-Type-Options: nosniff`: el browser respeta Content-Type
//   server-side (no MIME-sniffing). Anti-XSS via upload de archivos con
//   Content-Type ambiguo (relevante post-Phase 1.G Storage decision).
//
// ## NO incluido: CSP (Content-Security-Policy)
//
// CSP permisiva tendría valor marginal (sólo bloquea scripts cross-origin
// — vector raro) + Phase 2 vamos a strict CSP (nonce-based) que reescribe
// TODO el setup. Skipear ahora evita work throwaway. Ver:
//   docs/tech-debt-pre-v1.3.md §Phase 2.I — CSP strict (nonce-based).
const SECURITY_HEADERS = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "geolocation=(), camera=(), microphone=()",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
];

const nextConfig: NextConfig = {
  // Lockfile suelto en el home del usuario hace que Next infiera mal el
  // workspace root. Fijarlo a este repo.
  outputFileTracingRoot: path.join(__dirname),

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

// Composición de plugins: orden importa.
//   1. `withNextIntl` → procesa el plugin de next-intl (request.ts wiring).
//   2. `withAnalyzer` → wrap del bundle analyzer (opt-in via ANALYZE=true).
//   3. `withSentryConfig` → wrap más externo, agrega source maps upload +
//      tunneling de errores SDK + auto-instrumentación.
//
// `withSentryConfig` ADR-0047:
//   - `silent: !process.env.CI` → en local no spammea con logs de build;
//     en CI (Vercel build) sí muestra info de source maps upload.
//   - `widenClientFileUpload: true` → más source maps cargados = stack
//     traces client-side más completos.
//   - `disableLogger: true` → bota el Sentry logger interno del bundle
//     client (reduce JS bundle ~5KB).
//   - `org`/`project`/`authToken` los provee Vercel × Sentry integration
//     vía env vars sincronizadas (SENTRY_ORG, SENTRY_PROJECT, SENTRY_AUTH_TOKEN).
//     En dev local sin estos vars → upload skip silencioso.
//   - `tunnelRoute: "/monitoring"` → opt-in V1.3+ (rutea events Sentry vía
//     este path para evadir adblockers que bloquean *.ingest.sentry.io). NO
//     activado V1 — adblockers no son threat model.
const nextConfigComposed = withAnalyzer(withNextIntl(nextConfig));

export default withSentryConfig(nextConfigComposed, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: process.env.CI === undefined || process.env.CI === "",
  widenClientFileUpload: true,
  disableLogger: true,
  // Source maps NO se exponen al cliente (Sentry los recibe vía upload
  // CI-side, pero el bundle final NO los referencia). Privacy + security.
  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
  },
});
