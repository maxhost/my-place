import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test'

// Port 3001 (no 3000) para evitar colisión con dev servers de otros proyectos
// corriendo en el host. reuseExistingServer:false garantiza que Playwright siempre
// arranque ESTE dev server. Override con PLAYWRIGHT_BASE_URL en CI si hace falta.
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://lvh.me:3001'
const port = new URL(baseURL).port || '3001'

const base = {
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: (process.env.CI ? 'github' : 'list') as 'github' | 'list',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  globalSetup: './tests/global-setup.ts',
  use: {
    baseURL,
    trace: 'on-first-retry' as const,
    screenshot: 'only-on-failure' as const,
    video: 'retain-on-failure' as const,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-safari', use: { ...devices['iPhone 14'] } },
  ],
} satisfies PlaywrightTestConfig

const config: PlaywrightTestConfig = process.env.PLAYWRIGHT_NO_WEBSERVER
  ? base
  : {
      ...base,
      webServer: {
        command: `pnpm dev --port ${port}`,
        url: baseURL,
        reuseExistingServer: false,
        timeout: 120_000,
        env: {
          // Overridemos los URLs de NEXT_PUBLIC_* para que el dev server se
          // considere a sí mismo en el puerto 3001 (no 3000 como dice .env.local).
          // cookie-domain.ts strippea el puerto → cookies cross-subdomain siguen OK.
          NEXT_PUBLIC_APP_URL: baseURL,
          NEXT_PUBLIC_APP_DOMAIN: `lvh.me:${port}`,
        },
      },
    }

export default defineConfig(config)
