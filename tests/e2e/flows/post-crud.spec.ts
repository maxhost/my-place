import { test, expect } from '@playwright/test'
import { storageStateFor } from '../../helpers/playwright-auth'
import { placeUrl } from '../../helpers/subdomain'
import { E2E_PLACES } from '../../fixtures/e2e-data'

/**
 * Flow Post CRUD (C.H, subset inicial — más flows agendados en C.H.1).
 *
 * Cubre:
 *   - Lista de conversaciones de un place contiene el post baseline.
 *   - No-member ve gate de login cuando intenta entrar al place.
 *
 * TODO (próximas iteraciones):
 *   - Crear post via form.
 *   - Editar post dentro de la ventana de 60s (OK).
 *   - Editar post fuera de ventana (denied) usando `backdatePost`.
 *   - Admin-hide + member ve 404 sobre el post.
 */

const palermoSlug = E2E_PLACES.palermo.slug

test.describe('Post CRUD — Palermo', () => {
  test.describe('como memberA (active member)', () => {
    test.use({ storageState: storageStateFor('memberA') })

    test('lista de conversaciones incluye el post baseline', async ({ page }) => {
      await page.goto(placeUrl(palermoSlug, '/conversations'))
      await expect(page.getByRole('heading', { name: /Conversaciones/i })).toBeVisible()
      await expect(page.getByText(/Post baseline Palermo/)).toBeVisible()
    })

    test('link "Nueva conversación" visible en header', async ({ page }) => {
      await page.goto(placeUrl(palermoSlug, '/conversations'))
      await expect(page.getByRole('link', { name: /Nueva conversación/i })).toBeVisible()
    })
  })

  test.describe('como nonMember (no pertenece al place)', () => {
    test.use({ storageState: storageStateFor('nonMember') })

    test('intentar abrir /conversations de palermo → bloqueado (redirige o 404)', async ({
      page,
    }) => {
      const response = await page.goto(placeUrl(palermoSlug, '/conversations'))
      // El middleware puede redirigir a login o a la landing; el server puede
      // devolver 404. Cualquiera de esos estados es aceptable mientras NO
      // exponga la lista.
      const url = page.url()
      const content = await page.content()
      const isBlocked =
        /\/login\?/.test(url) || /\/$/.test(new URL(url).pathname) || response?.status() === 404
      expect(isBlocked).toBe(true)
      expect(content).not.toContain('Post baseline Palermo')
    })
  })
})
