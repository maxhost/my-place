import { test, expect } from '@playwright/test'
import { appUrl, appSubdomainUrl, placeUrl } from '../../helpers/subdomain'

/**
 * Smoke del flow de auth (sin completar el magic link — eso requiere mailbox).
 * Verifica:
 *  - Landing tiene botón "Entrar" hacia /login.
 *  - /login muestra el form.
 *  - Rutas protegidas redirigen a /login con ?next=.
 *  - El form dispara la UI de "te enviamos un link" (no verificamos el email real).
 *
 * Usamos `lvh.me` (resuelve a 127.0.0.1) en lugar de `localhost` para ejercitar
 * correctamente cookies cross-subdomain — ver `cookie-domain.ts`.
 */

test('landing → botón Entrar → /login con form', async ({ page }) => {
  await page.goto(appUrl('/'))
  await page.getByRole('link', { name: /entrar/i }).click()
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('textbox', { name: /email/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /enviame el link/i })).toBeVisible()
})

test('/login con email inválido no avanza al estado "link enviado"', async ({ page }) => {
  await page.goto(appUrl('/login'))
  await page.getByRole('textbox', { name: /email/i }).fill('no-es-email')
  await page.getByRole('button', { name: /enviame el link/i }).click()
  // Sin estado "link enviado" → form sigue visible. La validación exacta del
  // tooltip HTML5 no es accesible a Playwright; chequeamos lo observable.
  await expect(page.getByRole('button', { name: /enviame el link/i })).toBeVisible()
  await expect(page.getByText(/te mandamos/i)).toHaveCount(0)
})

test('inbox sin sesión redirige a /login del mismo host', async ({ page }) => {
  await page.goto(appSubdomainUrl('/'))
  await expect(page).toHaveURL(/app\.lvh\.me(:\d+)?\/login\?next=/)
  const nextParam = new URL(page.url()).searchParams.get('next')
  expect(nextParam).toContain('app.lvh.me')
})

test('place sin sesión redirige a /login del mismo host', async ({ page }) => {
  await page.goto(placeUrl('algun-place', '/'))
  await expect(page).toHaveURL(/algun-place\.lvh\.me(:\d+)?\/login\?next=/)
  const nextParam = new URL(page.url()).searchParams.get('next')
  expect(nextParam).toContain('algun-place.lvh.me')
})
