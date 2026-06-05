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
// - `Permissions-Policy`: deny-list de browser features que la app NO usa V1.
//   Phase 2.I tightening: además de geolocation/camera/microphone se deniegan
//   payment, usb y browsing-topics (opt-out de la Topics API de tracking). Los
//   directivos no reconocidos por un browser se ignoran sin error. Si V1.3
//   introduce alguna feature, cambiar su entrada a `allow=self` puntual.
//
// - `X-Content-Type-Options: nosniff`: el browser respeta Content-Type
//   server-side (no MIME-sniffing). Anti-XSS via upload de archivos con
//   Content-Type ambiguo (relevante post-Phase 1.G Storage decision).
//
// ## CSP (Content-Security-Policy): vive en `src/proxy.ts`, NO acá
//
// La CSP es strict (nonce-based) y el nonce se genera POR REQUEST → no puede
// ser un header estático de `next.config`. Se compone en el proxy (Phase 2.I).
// Ver `src/shared/lib/security/content-security-policy.ts` + proxy.ts §CSP y
// docs/tech-debt-pre-v1.3.md §Phase 2.I.
const SECURITY_HEADERS = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value:
      "geolocation=(), camera=(), microphone=(), payment=(), usb=(), browsing-topics=()",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
];

const nextConfig: NextConfig = {
  // Lockfile suelto en el home del usuario hace que Next infiera mal el
  // workspace root. Fijarlo a este repo.
  outputFileTracingRoot: path.join(__dirname),

  // E2E (Phase 2.A): los tests Playwright corren la app local sobre el apex
  // `lvh.me` (resuelve a 127.0.0.1 incl. subdominios; es dotted → pasa el regex
  // de auth-config). Next 16 dev bloquea HMR + dev assets para orígenes ≠
  // localhost salvo que estén acá → sin esto la hidratación no completa sobre
  // lvh.me. SOLO afecta `next dev`; ignorado en el build de producción. Ver
  // docs/testing.md.
  //
  // Phase 2.B.2: `127.0.0.1.nip.io` es el custom domain del E2E accept invite
  // cross-domain (registrable domain ≠ lvh.me, loopback IPv4). Sin él la
  // hidratación del `InviteAcceptancePanel` no completa sobre ese host → el
  // botón "Aceptar" nunca se vuelve interactivo (click no-op, flaky por race de
  // hidratación). Mismo carácter dev-only que las entradas `lvh.me`.
  allowedDevOrigins: ["lvh.me", "*.lvh.me", "127.0.0.1.nip.io"],

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
