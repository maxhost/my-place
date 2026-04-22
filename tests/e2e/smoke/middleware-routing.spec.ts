import { test, expect } from '@playwright/test'
import { appUrl, appSubdomainUrl, placeUrl } from '../../helpers/subdomain'

/**
 * Smoke del middleware multi-tenant contra dev server.
 * `lvh.me` y sus subdominios resuelven a 127.0.0.1 vía DNS público (sin `/etc/hosts`)
 * y permiten compartir cookies con `Domain=lvh.me` entre apex y subdominios,
 * cosa que Chrome no garantiza con `localhost`.
 */

test('lvh.me → landing', async ({ page }) => {
  await page.goto(appUrl('/'))
  await expect(page.locator('h1')).toContainText('Place')
})

test('app.lvh.me sin sesión → redirige a /login del mismo host', async ({ page }) => {
  await page.goto(appSubdomainUrl('/'))
  await expect(page).toHaveURL(/app\.lvh\.me(:\d+)?\/login\?next=/)
  await expect(page.locator('h1')).toContainText('Entrar')
})

test('{slug}.lvh.me sin sesión → redirige a /login del mismo host', async ({ page }) => {
  await page.goto(placeUrl('prueba', '/'))
  await expect(page).toHaveURL(/prueba\.lvh\.me(:\d+)?\/login\?next=/)
})
