import { test, expect } from '@playwright/test'
import { storageStateFor } from '../../helpers/playwright-auth'
import { placeUrl } from '../../helpers/subdomain'
import {
  E2E_BASELINE_POST_SLUG,
  E2E_GROUPS,
  E2E_LIBRARY_CATEGORIES,
  E2E_PLACES,
} from '../../fixtures/e2e-data'
import { getTestPrisma } from '../../helpers/prisma'

/**
 * Flow G.x — Permission Groups (page + FAB + gates + CRUD + permission
 * enforcement).
 *
 * Cobertura **owner-only** del CRUD de grupos custom + visibilidad del
 * grupo preset "Administradores" + enforcement de permisos atómicos +
 * scope library en miembros con grupos asignados.
 *
 * Las primeras 6 escenarios cubren los gates del page + FAB (no requieren
 * seed mutativo). Los siguientes blocks (extensión C.5 del plan
 * `tidy-stargazing-summit.md`) ejercen el flujo full owner CRUD +
 * enforcement, apoyándose en los 3 grupos baseline que el seed C.4
 * crea en palermo:
 *
 *  - `E2E_GROUPS.adminPreset` — preset "Administradores", isPreset=true,
 *    todos los permisos. Owner + admin son miembros.
 *  - `E2E_GROUPS.moderators` — custom, perms `discussions:hide-post` +
 *    `flags:review`. memberA es miembro.
 *  - `E2E_GROUPS.libraryMods` — custom, perms `library:moderate-categories`
 *    + `library:moderate-items`, scoped a categoría `resources`.
 *    memberB es miembro.
 *
 * **Aislamiento entre workers**: chromium + mobile-safari corren en
 * paralelo contra el mismo cloud DB. Los tests mutativos NO mutan los
 * grupos baseline — sólo crean/eliminan grupos temporales con nombre
 * único por worker (`uniqueGroupName(testInfo)`) y tienen `afterAll()`
 * defensivo que limpia via Prisma.
 *
 * Spec: docs/features/groups/spec.md § 5.
 * Plan: docs/plans/2026-05-02-permission-groups-and-member-controls.md § G.8.
 * Plan extensión C.5: ~/.claude/plans/tidy-stargazing-summit.md.
 */

const palermoSlug = E2E_PLACES.palermo.slug
const palermoId = E2E_PLACES.palermo.id
const NOT_FOUND_REGEX = /No existe|Lo que buscabas|404/i

function uniqueGroupName(testInfo: { workerIndex: number }): string {
  return `Test Group w${testInfo.workerIndex}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

test.describe('Permission Groups — page gate', () => {
  test.describe('como owner', () => {
    test.use({ storageState: storageStateFor('owner') })

    test('owner entra a /settings/groups y ve la page', async ({ page }) => {
      await page.goto(placeUrl(palermoSlug, '/settings/groups'))
      await expect(
        page.getByRole('heading', { name: /Grupos|Permission Groups/i }).first(),
      ).toBeVisible({ timeout: 10_000 })
    })

    test('FAB muestra item "Grupos" para owner', async ({ page }) => {
      await page.goto(placeUrl(palermoSlug, '/settings'))
      await page.getByRole('button', { name: 'Navegación de settings' }).click()
      await expect(page.getByRole('menuitem', { name: /Grupos/i })).toBeVisible()
    })

    test('click en "Grupos" del FAB navega a /settings/groups', async ({ page }) => {
      await page.goto(placeUrl(palermoSlug, '/settings'))
      await page.getByRole('button', { name: 'Navegación de settings' }).click()
      await page.getByRole('menuitem', { name: /Grupos/i }).click()
      await page.waitForURL(/\/settings\/groups$/)
      expect(new URL(page.url()).pathname).toBe('/settings/groups')
    })
  })

  test.describe('como admin (no owner)', () => {
    test.use({ storageState: storageStateFor('admin') })

    test('admin entra a /settings/groups → 404 (gate del page)', async ({ page }) => {
      await page.goto(placeUrl(palermoSlug, '/settings/groups'))
      await expect(page.getByText(NOT_FOUND_REGEX).first()).toBeVisible({ timeout: 10_000 })
    })

    test('admin no ve item "Grupos" en el FAB', async ({ page }) => {
      await page.goto(placeUrl(palermoSlug, '/settings'))
      await page.getByRole('button', { name: 'Navegación de settings' }).click()
      await expect(page.getByRole('menuitem', { name: /Grupos/i })).toHaveCount(0)
    })
  })

  test.describe('como member común', () => {
    test.use({ storageState: storageStateFor('memberA') })

    test('memberA entra a /settings/groups → 404 (gate de settings layout)', async ({ page }) => {
      await page.goto(placeUrl(palermoSlug, '/settings/groups'))
      await expect(page.getByText(NOT_FOUND_REGEX).first()).toBeVisible({ timeout: 10_000 })
    })
  })
})

// =====================================================================
// Mutative scenarios — extensión C.5.
// Apoyo en seed baseline (E2E_GROUPS.*) + grupos temp con nombre único.
// =====================================================================

test.describe('Permission Groups — owner ve baseline groups', () => {
  test.use({ storageState: storageStateFor('owner') })

  test('owner ve los 3 grupos baseline en /settings/groups', async ({ page }) => {
    await page.goto(placeUrl(palermoSlug, '/settings/groups'))
    // S7 (2026-05-13): rows ahora son `<button aria-label="Ver detalle
    // del grupo X">` (tap-to-detail pattern). Antes eran `<Link>`.
    await expect(
      page.getByRole('button', {
        name: `Ver detalle del grupo ${E2E_GROUPS.adminPreset.name}`,
      }),
    ).toBeVisible({ timeout: 10_000 })
    await expect(
      page.getByRole('button', {
        name: `Ver detalle del grupo ${E2E_GROUPS.moderators.name}`,
      }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', {
        name: `Ver detalle del grupo ${E2E_GROUPS.libraryMods.name}`,
      }),
    ).toBeVisible()
  })
})

test.describe('Permission Groups — preset "Administradores" no se puede eliminar', () => {
  test.use({ storageState: storageStateFor('owner') })

  test('preset Administradores: delete bloqueado en el detail panel (botón "Eliminar" disabled)', async ({
    page,
  }) => {
    // S7 (2026-05-13): el detail vive ahora en un EditPanel inline (no
    // page separada). Tap-row → panel abre con footer. Para el preset,
    // el botón "Eliminar" aparece disabled con aria-label
    // `No se puede eliminar Administradores`.
    await page.goto(placeUrl(palermoSlug, '/settings/groups'))

    // Tap-row → abre detail panel.
    await page
      .getByRole('button', {
        name: `Ver detalle del grupo ${E2E_GROUPS.adminPreset.name}`,
      })
      .click()

    // El detail panel renderea el footer. Para preset, "Eliminar" está
    // disabled con aria-label específico.
    const blockedDeleteButton = page.getByRole('button', {
      name: `No se puede eliminar ${E2E_GROUPS.adminPreset.name}`,
    })
    await expect(blockedDeleteButton).toBeVisible({ timeout: 10_000 })
    await expect(blockedDeleteButton).toBeDisabled()
  })
})

test.describe('Permission Groups — owner CRUD atómico de grupo temporal', () => {
  test.describe.configure({ mode: 'serial' })
  test.use({ storageState: storageStateFor('owner') })

  // Single shared name across the serial block — create → edit → delete
  // todo con la misma row. Nombre único por worker para evitar colisión
  // entre chromium + mobile-safari en cloud DB compartido.
  let tempGroupName: string

  test.beforeAll(({}, testInfo) => {
    tempGroupName = uniqueGroupName(testInfo)
  })

  test.afterAll(async () => {
    // Cleanup defensivo: si el test de delete no llegó a correr o
    // falló, eliminamos el grupo temp via Prisma (matchea por placeId
    // + name único). Idempotente.
    const prisma = getTestPrisma()
    await prisma.permissionGroup
      .deleteMany({
        where: { placeId: palermoId, name: tempGroupName, isPreset: false },
      })
      .catch(() => {})
  })

  test('crear → editar → eliminar grupo temp (atómico end-to-end)', async ({ page }) => {
    await page.goto(placeUrl(palermoSlug, '/settings/groups'))

    // CREATE — trigger "Nuevo grupo" dashed-border button DEBAJO de la
    // lista (canon ux-patterns.md). Abre EditPanel responsive (sidebar
    // desktop / bottom sheet mobile) → role="dialog".
    await page.getByRole('button', { name: 'Nuevo grupo' }).first().click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 })
    await page.getByLabel('Nombre').fill(tempGroupName)
    await page.getByLabel(/Descripción/i).fill('Grupo temporal de E2E para CRUD test.')
    await page.getByRole('button', { name: 'Crear grupo' }).click()

    await expect(page.getByText(/Grupo creado/i).first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10_000 })

    const tempRowButton = page.getByRole('button', {
      name: `Ver detalle del grupo ${tempGroupName}`,
    })
    await expect(tempRowButton).toBeVisible({ timeout: 10_000 })

    // EDIT — tap-row abre detail panel. Click "Editar" del footer → cierra
    // detail + abre form sheet (EditPanel) con prefill.
    await tempRowButton.click()
    await page.getByRole('button', { name: 'Editar', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 })
    const newDescription = `Descripción actualizada — ${Date.now()}`
    const descriptionInput = page.getByLabel(/Descripción/i)
    await descriptionInput.fill(newDescription)
    await page.getByRole('button', { name: 'Guardar cambios' }).click()

    await expect(page.getByText(/Grupo actualizado/i).first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10_000 })

    // DELETE — tap-row de nuevo, abre detail. Click "Eliminar" → confirm
    // dialog interno → "Sí, eliminar" → group desaparece de la lista.
    await tempRowButton.click()
    await page.getByRole('button', { name: 'Eliminar', exact: true }).click()
    await page.getByRole('button', { name: 'Sí, eliminar' }).click()
    await expect(page.getByText(/eliminado/i).first()).toBeVisible({ timeout: 10_000 })

    // Lista refresh: el grupo ya no aparece.
    await expect(
      page.getByRole('button', {
        name: `Ver detalle del grupo ${tempGroupName}`,
      }),
    ).toHaveCount(0, { timeout: 10_000 })
  })
})

test.describe('Permission Groups — enforcement: memberA puede navegar a baseline post', () => {
  test.use({ storageState: storageStateFor('memberA') })

  // memberA está en el grupo `moderators` con permisos `discussions:hide-post`
  // + `flags:review`. La UI condicional para mostrar `<PostAdminMenu>` hoy
  // gateá por `viewer.isAdmin` (owner+admin preset), NO por permiso
  // atómico de grupo. Esto es deuda técnica documentada en el plan
  // `tidy-stargazing-summit.md` § G.7 — hasta que la UI consulte
  // `hasPermission('discussions:hide-post', ...)`, el botón "Ocultar"
  // no aparece para memberA aunque server-side el action lo permita.
  //
  // TODO: cuando la UI de conversations exponga moderation controls
  // basados en grupo (no sólo isAdmin), reemplazar este test por una
  // assertion sobre el botón "Ocultar". Mientras tanto, este escenario
  // verifica el path mínimo: memberA llega al thread y la página
  // renderiza (no 404, no gate).
  test('memberA accede a /conversations/<baseline> sin 404', async ({ page }) => {
    const response = await page.goto(
      placeUrl(palermoSlug, `/conversations/${E2E_BASELINE_POST_SLUG}`),
    )
    // No 404 — el post existe y memberA es miembro activo.
    expect(response?.status() ?? 0).toBeLessThan(400)
    await expect(page.getByText(NOT_FOUND_REGEX).first()).toHaveCount(0, {
      timeout: 5_000,
    })
    // Hay contenido del thread (al menos el composer u otro elemento
    // del PostDetail). Usamos un selector laxo para no atar al markup
    // exacto del thread.
    await expect(page.locator('body')).toContainText(/.+/, { timeout: 10_000 })
  })
})

test.describe('Permission Groups — enforcement scope library: memberB en libraryMods', () => {
  test.use({ storageState: storageStateFor('memberB') })

  // memberB está en `libraryMods` con `library:moderate-categories` +
  // `library:moderate-items`, scoped a la categoría `resources`. La UI
  // de moderación de items (`<ItemAdminMenu>` con archivar) hoy se
  // renderiza sólo cuando `canArchiveItem` retorna true, y este helper
  // chequea `viewer.isAdmin` (owner+admin preset), NO el permiso
  // atómico via grupo. Igual que con memberA arriba, esto es deuda
  // técnica del plan G.7.
  //
  // Mientras la UI no use `hasPermission` para mostrar moderation
  // controls a non-admins, no podemos asertar que memberB ve "Archivar"
  // en `/library/resources` y NO lo ve en `/library/tutorials`. Lo que
  // sí podemos verificar es el path mínimo: memberB llega a ambas
  // categorías sin 404 (es miembro activo del place y las categorías
  // existen). El enforcement real del scope (positivo en resources +
  // negativo en tutorials) está cubierto por unit/integration tests
  // del slice `library/`.
  //
  // TODO: cuando `<ItemAdminMenu>` (o un wrapper equivalente a nivel
  // categoría) use `hasPermission('library:moderate-items', ..., {
  // categoryId })`, reemplazar este test por:
  //   1. memberB en /library/resources → "Archivar" visible.
  //   2. memberB en /library/tutorials → "Archivar" oculto.

  test('memberB navega a /library/resources (categoría dentro del scope) sin 404', async ({
    page,
  }) => {
    const response = await page.goto(
      placeUrl(palermoSlug, `/library/${E2E_LIBRARY_CATEGORIES.resources.slug}`),
    )
    expect(response?.status() ?? 0).toBeLessThan(400)
    await expect(page.getByText(NOT_FOUND_REGEX).first()).toHaveCount(0, {
      timeout: 5_000,
    })
    await expect(
      page.getByRole('heading', {
        name: new RegExp(E2E_LIBRARY_CATEGORIES.resources.title),
      }),
    ).toBeVisible({ timeout: 10_000 })
  })

  test('memberB navega a /library/tutorials (categoría fuera del scope) sin 404', async ({
    page,
  }) => {
    // Negative side: memberB es miembro activo, así que la categoría
    // pública renderiza (sin moderation controls). Sirve como
    // baseline del estado actual; cuando se wire `hasPermission` en
    // la UI, este test debería asertar `Archivar` HIDDEN.
    const response = await page.goto(
      placeUrl(palermoSlug, `/library/${E2E_LIBRARY_CATEGORIES.tutorials.slug}`),
    )
    expect(response?.status() ?? 0).toBeLessThan(400)
    await expect(page.getByText(NOT_FOUND_REGEX).first()).toHaveCount(0, {
      timeout: 5_000,
    })
    await expect(
      page.getByRole('heading', {
        name: new RegExp(E2E_LIBRARY_CATEGORIES.tutorials.title),
      }),
    ).toBeVisible({ timeout: 10_000 })
  })
})
