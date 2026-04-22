import { test, expect } from '@playwright/test'
import { storageStateFor } from '../../helpers/playwright-auth'
import { appSubdomainUrl } from '../../helpers/subdomain'

/**
 * Valida que el `storageState` generado por `tests/global-setup.ts` funciona:
 * el navegador ya trae las cookies de sesión cuando abre el inbox, sin redirigir
 * a `/login`. Si este spec falla es señal de que el pipeline de auth está roto
 * — arreglar ANTES de debug de specs más arriba en la stack.
 *
 * Corre en ambos browsers (chromium + mobile-safari via default projects).
 */

test.use({ storageState: storageStateFor('memberA') })

test('memberA con storageState → inbox NO redirige a /login', async ({ page }) => {
  await page.goto(appSubdomainUrl('/'))
  await expect(page).not.toHaveURL(/\/login\?next=/)
})
