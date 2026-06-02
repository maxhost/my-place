import { config as loadEnv } from "dotenv";
import { defineConfig, devices } from "@playwright/test";

// Config E2E Playwright (Phase 2.A). Los E2E corren la app LOCAL (`next dev`)
// apuntada al branch `test` de Neon, con apex local `lvh.me` (resuelve a
// 127.0.0.1 incl. subdominios). Rationale completo en docs/testing.md.
//
// ## Por qué HTTPS
//
// Neon Auth (Better Auth) RECHAZA orígenes `http://` no-localhost en sus
// `trusted_origins` (sólo `https://` o `http://localhost`). Como el apex de los
// E2E es `lvh.me` (no localhost), el signup DEBE correr sobre `https://`. El
// dev server usa un cert self-signed (`scripts/ensure-e2e-cert.mjs`, corrido por
// `pnpm e2e`) y Playwright lo acepta con `ignoreHTTPSErrors`. Ver docs/testing.md.
//
// ## Carga de env
//
// `.env.e2e` (gitignored) tiene los overrides: DATABASE_URL→test branch,
// NEON_AUTH_*→Neon Auth del test branch (es PER-BRANCH), APP_URL/DOMAIN→lvh.me.
// Lo cargamos acá con dotenv → entra al `process.env` del runner Playwright (lo
// usa el cleanup fixture) Y se lo pasamos explícito al `webServer.env`. Next NO
// pisa vars ya presentes en el entorno con `.env.local` → los valores del test
// branch ganan. Sin esto la app hablaría con el branch dev (split-brain).
const e2eEnv = loadEnv({ path: ".env.e2e" }).parsed ?? {};

const PORT = 3000;
const BASE_URL = e2eEnv.NEXT_PUBLIC_APP_URL ?? `https://lvh.me:${PORT}`;
const isCI = !!process.env.CI;

// Stub HTTP de la Vercel Domains REST API (Phase 2.B.1). El wrapper
// `src/shared/lib/vercel/domains-shared.ts` lee `VERCEL_API_BASE_URL` (seam
// DI, default `api.vercel.com`); en E2E lo apuntamos a este stub local
// (`scripts/e2e-vercel-stub.mjs`) para que el flujo de register custom domain
// sea determinístico y hermético, sin tocar la API real ni registrar dominios
// de verdad. Ver docs/testing.md §"Mock de Vercel en E2E".
const VERCEL_STUB_PORT = 3010;
const VERCEL_STUB_URL = `http://127.0.0.1:${VERCEL_STUB_PORT}`;

// Cert self-signed (gitignored, regenerado por `pnpm e2e`). Paths relativos al
// root del repo — Next los resuelve desde cwd del `next dev`.
const HTTPS_KEY = "certificates/lvh.me-key.pem";
const HTTPS_CERT = "certificates/lvh.me.pem";

export default defineConfig({
  testDir: "./tests/e2e",
  // Pre-clean defensivo (huérfanos de runs crasheados) + barrido post-run de
  // toda la data sembrada por los specs. Ambos matchean por patrón de email de
  // test → nunca tocan data real del branch. Ver docs/testing.md.
  globalSetup: "./tests/e2e/_support/global-setup.ts",
  globalTeardown: "./tests/e2e/_support/global-teardown.ts",
  // El branch test de Neon cold-startea (WebSocket neon-serverless) varios
  // segundos en el primer connect → timeouts generosos, no flakiness a tapar.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: isCI,
  retries: 2,
  workers: 1,
  reporter: isCI ? "list" : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    // Cert self-signed del dev server → el browser lo rechazaría sin esto.
    ignoreHTTPSErrors: true,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  // Dos servidores: (1) el stub de Vercel (arranca primero, sin deps), (2) el
  // dev server de Next apuntado al stub vía `VERCEL_API_BASE_URL`. Playwright
  // espera a que ambos `url` respondan antes de correr los specs.
  webServer: [
    {
      command: `node scripts/e2e-vercel-stub.mjs`,
      url: VERCEL_STUB_URL,
      reuseExistingServer: !isCI,
      timeout: 30_000,
      env: { E2E_VERCEL_STUB_PORT: String(VERCEL_STUB_PORT) },
    },
    {
      // `--experimental-https` + cert propio (no mkcert: evita el `-install` que
      // pide sudo). El cert lo garantiza `pnpm e2e` antes de arrancar Playwright.
      command: `pnpm dev --experimental-https --experimental-https-key ${HTTPS_KEY} --experimental-https-cert ${HTTPS_CERT}`,
      url: `https://lvh.me:${PORT}`,
      ignoreHTTPSErrors: true,
      reuseExistingServer: !isCI,
      timeout: 120_000,
      // Inyecta los overrides del test branch al proceso `next dev`. Next no pisa
      // vars ya seteadas en el entorno → estas ganan sobre `.env.local`.
      // Las VERCEL_* apuntan el wrapper al stub local con creds mock (el stub
      // ignora auth); el `?? default` permite override desde `.env.e2e`.
      env: {
        ...e2eEnv,
        PORT: String(PORT),
        VERCEL_API_BASE_URL: e2eEnv.VERCEL_API_BASE_URL ?? VERCEL_STUB_URL,
        VERCEL_API_TOKEN: e2eEnv.VERCEL_API_TOKEN ?? "e2e-mock-token",
        VERCEL_PROJECT_ID: e2eEnv.VERCEL_PROJECT_ID ?? "e2e-mock-project",
      },
    },
  ],
});
