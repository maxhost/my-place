import { test, expect } from '@playwright/test'
import { storageStateFor } from '../../helpers/playwright-auth'
import { placeUrl } from '../../helpers/subdomain'
import { E2E_PLACES, E2E_TIERS } from '../../fixtures/e2e-data'

/**
 * Flow T.x — Tiers feature (definición + CRUD owner-only).
 *
 * Cubre los escenarios definidos en `docs/features/tiers/spec.md` § 14:
 *  1. Owner CRUD happy path (free + paid).
 *  2. N tiers con mismo name HIDDEN coexisten (decisión #11 ADR
 *     actualizada 2026-05-02).
 *  3. Publicar segundo tier con mismo name → bloqueado (invariante
 *     "máx 1 PUBLISHED por (placeId, name) lower-case").
 *  4. Admin gateado en page (`/settings/tiers` → 404).
 *  5. Admin no ve item en FAB (`<SettingsNavFab>`).
 *  6. Member común gateado (página y FAB ocultos).
 *
 * **Aislamiento entre workers**: chromium + mobile-safari corren en paralelo
 * contra el mismo cloud DB. Los tests usan nombres únicos derivados de
 * `testInfo.workerIndex + Date.now()` para garantizar no-colisión entre
 * runs paralelos.
 *
 * **Empty state copy**: la `not-found.tsx` global de Next dice "No existe."
 * (no "404"), por eso el regex de gate matchea esa frase específica.
 *
 * Storage states usados:
 *  - `owner` → OWNER del place palermo (vía PlaceOwnership).
 *  - `admin` → ADMIN del place palermo (sin PlaceOwnership).
 *  - `memberA` → MEMBER del place palermo.
 */

const palermoSlug = E2E_PLACES.palermo.slug

const NOT_FOUND_REGEX = /No existe|Lo que buscabas/i

function uniqueTierName(testInfo: { workerIndex: number }): string {
  return `Test Tier w${testInfo.workerIndex}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

test.describe('Tiers — owner read-only happy path (T.4)', () => {
  test.use({ storageState: storageStateFor('owner') })

  test('owner ve la page con tiers baseline (free PUBLISHED + paid HIDDEN)', async ({ page }) => {
    await page.goto(placeUrl(palermoSlug, '/settings/tiers'))
    await expect(page.getByRole('heading', { name: 'Tiers', exact: true })).toBeVisible()
    // Los 2 tiers baseline están visibles. Usamos heading-role para evitar
    // colisiones con otros tests que crean tiers con nombres similares (la
    // page acumula data entre tests dentro del mismo describe).
    await expect(
      page.getByRole('heading', { name: E2E_TIERS.colaboradores.name, exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { name: E2E_TIERS.premium.name, exact: true }),
    ).toBeVisible()
    // El tier free muestra "Gratis" como copy del precio.
    await expect(page.getByText(/Gratis/i).first()).toBeVisible()
    // El tier paid muestra el precio formateado (seed: 999 cents → 9,99).
    await expect(page.getByText(/9,99/).first()).toBeVisible()
  })

  test('FAB de settings muestra item "Tiers" para owner', async ({ page }) => {
    await page.goto(placeUrl(palermoSlug, '/settings'))
    await page.getByRole('button', { name: 'Navegación de settings' }).click()
    await expect(page.getByRole('menuitem', { name: /Tiers/i })).toBeVisible()
  })
})

test.describe('Tiers — owner CRUD (T.4)', () => {
  test.use({ storageState: storageStateFor('owner') })

  test('crear → publicar → ocultar un tier propio (CRUD atómico end-to-end)', async ({
    page,
  }, testInfo) => {
    // Test atómico: crea un tier propio con nombre único + ejecuta todo el
    // ciclo visibility en una sola navegación, sin compartir estado con
    // otros tests. Evita race entre workers paralelos que mutan el mismo DB.
    const uniqueName = uniqueTierName(testInfo)
    await page.goto(placeUrl(palermoSlug, '/settings/tiers'))

    // CREATE — arranca HIDDEN (default). Sheet usa botón "Listo" (sub-form
    // pattern canon post 2026-05-12).
    await page.getByRole('button', { name: 'Nuevo tier' }).first().click()
    await page.getByLabel('Nombre').fill(uniqueName)
    await page.getByLabel(/Precio/).fill('1.99')
    await page.getByRole('button', { name: 'Listo' }).click()
    await expect(page.getByText(/Tier creado/i).first()).toBeVisible({ timeout: 10_000 })

    // El tier card vive en `<div className="rounded-md border">` con un
    // heading que lleva el nombre. Localizamos via el heading (único).
    const card = page
      .locator('div')
      .filter({ has: page.getByRole('heading', { name: uniqueName, exact: true }) })
      .first()
    await expect(card).toBeVisible({ timeout: 10_000 })
    await expect(card.getByText('Oculto')).toBeVisible()

    // PUBLISH — save model "todo manual" (S6, 2026-05-13): el switch cambia
    // estado local + dirty indicator; el botón "Guardar cambios" page-level
    // persiste todos los pendientes. Toast es agregado ("N tier guardado").
    await page
      .getByRole('switch', { name: new RegExp(`^${escapeRegex(uniqueName)}: oculto`) })
      .click()
    // Chip refleja el estado effective inmediato (sin esperar persist).
    await expect(card.getByText('Publicado')).toBeVisible()
    // Click Guardar para persistir.
    await page.getByRole('button', { name: 'Guardar cambios' }).click()
    await expect(page.getByText(/tier guardado/i).first()).toBeVisible({ timeout: 10_000 })

    // HIDE de vuelta — mismo flow.
    await page
      .getByRole('switch', { name: new RegExp(`^${escapeRegex(uniqueName)}: publicado`) })
      .click()
    await expect(card.getByText('Oculto')).toBeVisible()
    await page.getByRole('button', { name: 'Guardar cambios' }).click()
    await expect(page.getByText(/tier guardado/i).first()).toBeVisible({ timeout: 10_000 })
  })

  test('crear N tiers con mismo nombre HIDDEN coexisten — sin error', async ({
    page,
  }, testInfo) => {
    // Decisión #11 ADR (actualizada 2026-05-02): N tiers con mismo nombre
    // pueden coexistir mientras no haya MÁS DE UNO publicado.
    // Acá creamos 2 tiers con el mismo name lower-case, ambos HIDDEN.
    // Ambos creates deben pasar.
    const sharedName = `Basic-${testInfo.workerIndex}-${Date.now()}`
    await page.goto(placeUrl(palermoSlug, '/settings/tiers'))

    // Primer create OK. Sheet usa "Listo" (sub-form canon post 2026-05-12).
    await page.getByRole('button', { name: 'Nuevo tier' }).first().click()
    await page.getByLabel('Nombre').fill(sharedName)
    await page.getByLabel(/Precio/).fill('1.00')
    await page.getByRole('button', { name: 'Listo' }).click()
    await expect(page.getByText(/Tier creado/i).first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10_000 })

    // Segundo create con MISMO name pero CASE-INSENSITIVE distinto — también OK.
    await page.getByRole('button', { name: 'Nuevo tier' }).first().click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 })
    await page.getByLabel('Nombre').fill(sharedName.toUpperCase())
    await page.getByLabel(/Precio/).fill('2.00')
    await page.getByRole('button', { name: 'Listo' }).click()
    await expect(page.getByText(/Tier creado/i).first()).toBeVisible({ timeout: 10_000 })

    // Ambos tiers visibles en la lista (heading-role para evitar match con
    // chips u otros textos).
    await expect(
      page.getByRole('heading', { name: new RegExp(escapeRegex(sharedName), 'i') }).first(),
    ).toBeVisible({ timeout: 10_000 })
  })

  test('publicar segundo tier con mismo nombre case-insensitive → toast friendly', async ({
    page,
  }, testInfo) => {
    // Caso de uso real (decisión #11 ADR actualizada): owner crea 2 tiers
    // "Basic" (uno con precio viejo, otro con precio nuevo). Publica el
    // primero. Cuando intenta publicar el segundo → error: "ya hay otro
    // PUBLISHED con ese nombre, ocultalo primero". Garantizado por el
    // partial unique `Tier_placeId_lowerName_published_unique`.
    const sharedName = `Premium-${testInfo.workerIndex}-${Date.now()}`
    await page.goto(placeUrl(palermoSlug, '/settings/tiers'))

    // Crear tier #1. Sheet "Listo" (sub-form canon).
    await page.getByRole('button', { name: 'Nuevo tier' }).first().click()
    await page.getByLabel('Nombre').fill(sharedName)
    await page.getByLabel(/Precio/).fill('1.99')
    await page.getByRole('button', { name: 'Listo' }).click()
    await expect(page.getByText(/Tier creado/i).first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10_000 })

    // Crear tier #2 (mismo name, distinto precio).
    await page.getByRole('button', { name: 'Nuevo tier' }).first().click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 })
    await page.getByLabel('Nombre').fill(sharedName)
    await page.getByLabel(/Precio/).fill('2.99')
    await page.getByRole('button', { name: 'Listo' }).click()
    await expect(page.getByText(/Tier creado/i).first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10_000 })

    // Publicar via switch on/off + save manual (S6, 2026-05-13).
    // Ambos tiers están HIDDEN al crearse. Tocamos el primer switch +
    // Guardar cambios → debería pasar a PUBLISHED.
    const hiddenSwitches = page.getByRole('switch', {
      name: new RegExp(`^${escapeRegex(sharedName)}: oculto`, 'i'),
    })
    await expect(hiddenSwitches).toHaveCount(2, { timeout: 10_000 })
    await hiddenSwitches.first().click()
    await page.getByRole('button', { name: 'Guardar cambios' }).click()
    await expect(page.getByText(/tier guardado/i).first()).toBeVisible({ timeout: 10_000 })

    // Intentar publicar tier #2 + Guardar — debería fallar (otro PUBLISHED
    // con mismo name). El switch que queda en "oculto" es el del segundo.
    await page
      .getByRole('switch', { name: new RegExp(`^${escapeRegex(sharedName)}: oculto`, 'i') })
      .click()
    await page.getByRole('button', { name: 'Guardar cambios' }).click()
    // El bulk save reporta failure con resumen. Buscamos el copy "ya hay
    // otro publicado con ese nombre" que viene del action mapping.
    await expect(page.getByText(/ya hay otro publicado con ese nombre/i).first()).toBeVisible({
      timeout: 10_000,
    })
  })
})

/**
 * Escapa caracteres regex en strings dinámicos (nombres de tier con
 * timestamps + workerIndex). Evita falsos matches por `.` o caracteres
 * especiales en nombres user-input style.
 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

test.describe('Tiers — admin gateado (T.4)', () => {
  test.use({ storageState: storageStateFor('admin') })

  test('admin entra a /settings/tiers → custom 404 ("No existe.")', async ({ page }) => {
    await page.goto(placeUrl(palermoSlug, '/settings/tiers'))
    await expect(page.getByText(NOT_FOUND_REGEX).first()).toBeVisible({ timeout: 10_000 })
  })

  test('admin no ve item "Tiers" en el FAB de settings', async ({ page }) => {
    await page.goto(placeUrl(palermoSlug, '/settings'))
    await page.getByRole('button', { name: 'Navegación de settings' }).click()
    await expect(page.getByRole('menuitem', { name: /Tiers/i })).toHaveCount(0)
  })
})

test.describe('Tiers — member común gateado (T.4)', () => {
  test.use({ storageState: storageStateFor('memberA') })

  test('memberA navega a /settings/tiers → custom 404 (gate del layout settings)', async ({
    page,
  }) => {
    await page.goto(placeUrl(palermoSlug, '/settings/tiers'))
    await expect(page.getByText(NOT_FOUND_REGEX).first()).toBeVisible({ timeout: 10_000 })
  })
})
