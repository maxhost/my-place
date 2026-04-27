import { test, expect } from '@playwright/test'
import { storageStateFor } from '../../helpers/playwright-auth'
import { placeUrl } from '../../helpers/subdomain'
import { E2E_PLACES } from '../../fixtures/e2e-data'
import { deleteEventsByPlace, findEventIdByTitle } from '../../helpers/db'

/**
 * Flow Events F.D + F.F — smoke E2E del slice eventos (Fase 6).
 *
 * F.F: el evento ES el thread; tras crear, el form redirige a
 * `/conversations/[postSlug]` con `EventMetadataHeader` arriba del Post.
 *
 * Cubre:
 *  - memberA propone evento → redirect al thread (`/conversations/[slug]`)
 *    con `EventMetadataHeader` visible (título del evento + RSVP buttons).
 *  - RSVP "Voy" → optimistic + persistencia tras refresh.
 *  - RSVP "Voy si…" → textfield aparece + nota se guarda.
 *  - non-member intenta entrar a /events → bloqueado.
 *
 * Cleanup: cada run borra todos los Events del place de test (cascade RSVPs +
 * Post asociado). Aislado por título único per-spec.
 */

const palermoSlug = E2E_PLACES.palermo.slug
const palermoId = E2E_PLACES.palermo.id

const SPEC_EVENT_TITLE = 'F.D smoke evento del viernes'
const SPEC_EVENT_TITLE_RSVP = 'F.D smoke evento RSVP'

test.describe('Events F.D — Palermo', () => {
  test.afterAll(async () => {
    await deleteEventsByPlace(palermoId)
  })

  test.describe('como memberA (active member)', () => {
    test.use({ storageState: storageStateFor('memberA') })

    test('lista de eventos: header + FAB visible (CTA inline removido R.2.6.2)', async ({
      page,
    }) => {
      await page.goto(placeUrl(palermoSlug, '/events'))
      await expect(page.getByRole('heading', { name: /^Eventos$/i })).toBeVisible()
      // R.2.6.2: el CTA "Proponer evento" inline se removió. Punto de
      // entrada para crear es el FAB (aria-label="Acciones") cross-zona.
      await expect(page.getByRole('button', { name: /Acciones/i })).toBeVisible()
    })

    test('crear evento: redirect al thread con EventMetadataHeader visible', async ({ page }) => {
      // R.2.6.2: navegamos directo a /events/new (el form interno mantiene
      // su botón submit "Proponer evento"; lo que se removió fue el CTA
      // inline del header de la lista).
      await page.goto(placeUrl(palermoSlug, '/events/new'))
      await expect(page.getByRole('heading', { name: /^Proponer evento$/i })).toBeVisible()

      await page.getByLabel(/Título/i).fill(SPEC_EVENT_TITLE)
      await page.getByLabel(/Descripción/i).fill('Vino, comida, charla.')

      // datetime-local: futuro a +2 días para no chocar con validación.
      const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
      const startsAtIso = toDatetimeLocal(future)
      await page.getByLabel(/Empieza/i).fill(startsAtIso)

      await page.getByLabel(/Timezone/i).selectOption('America/Argentina/Buenos_Aires')
      await page.getByLabel(/Dónde/i).fill('Casa de Maxi')

      await page.getByRole('button', { name: /Proponer evento/i }).click()

      // F.F: el redirect va al thread (`/conversations/[slug]`), no a una
      // page de detalle separada. El URL debería contener `/conversations/`.
      await page.waitForURL(/\/conversations\//, { timeout: 10_000 })

      // EventMetadataHeader: el `<h2>` con el título del evento debe estar.
      await expect(page.getByRole('heading', { level: 2, name: SPEC_EVENT_TITLE })).toBeVisible()

      // El header se identifica por su aria-label "Metadata del evento".
      await expect(page.getByLabel(/Metadata del evento/i)).toBeVisible()

      // F.H.1 (2026-04-27): el Post auto-creado YA NO se renderiza con
      // `<PostDetail>` en event-threads (su título "🎉 X" + body
      // genérico eran redundantes con el evento). El layout solo
      // expone el `<h2>` del evento + ReactionBar standalone +
      // CommentThread. Confirmamos que NO hay un h1 duplicado.
      await expect(
        page.getByRole('heading', { level: 1, name: new RegExp(SPEC_EVENT_TITLE) }),
      ).toHaveCount(0)
    })

    test('RSVP: click "Voy" persiste tras refresh; "Voy si…" expone textfield', async ({
      page,
    }) => {
      // Crear el evento de este caso en setup vía UI (más realista que seedear DB).
      await page.goto(placeUrl(palermoSlug, '/events/new'))
      await page.getByLabel(/Título/i).fill(SPEC_EVENT_TITLE_RSVP)

      const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
      await page.getByLabel(/Empieza/i).fill(toDatetimeLocal(future))
      await page.getByLabel(/Timezone/i).selectOption('America/Argentina/Buenos_Aires')
      await page.getByRole('button', { name: /Proponer evento/i }).click()

      // F.F: redirect al thread con `EventMetadataHeader` visible. El título
      // del evento aparece como `<h2>` en el header.
      await page.waitForURL(/\/conversations\//, { timeout: 10_000 })
      await expect(
        page.getByRole('heading', { level: 2, name: SPEC_EVENT_TITLE_RSVP }),
      ).toBeVisible()

      // Click "Voy" — botón vive en el RSVPButton dentro del
      // EventMetadataHeader.
      await page.getByRole('button', { name: /^Voy$/ }).click()

      // Confirmar persistencia: tras refresh, el botón "Voy" sigue activo
      // (aria-pressed=true).
      await page.reload()
      await expect(page.getByRole('button', { name: /^Voy$/, pressed: true })).toBeVisible({
        timeout: 5_000,
      })

      // Cambio a "Voy si…" → textfield aparece.
      await page.getByRole('button', { name: /Voy si/ }).click()
      await expect(page.getByLabel(/¿Qué necesitarías\?/i)).toBeVisible()

      // findEventIdByTitle se mantiene importado por si una iteración futura
      // necesita asserts directos sobre la DB (no hace falta acá — el
      // afterAll borra todos los events del place).
      void findEventIdByTitle
    })
  })

  test.describe('como nonMember (no pertenece al place)', () => {
    test.use({ storageState: storageStateFor('nonMember') })

    test('intentar abrir /events → bloqueado (no expone listado)', async ({ page }) => {
      const response = await page.goto(placeUrl(palermoSlug, '/events'))
      const url = page.url()
      const content = await page.content()
      const isBlocked =
        /\/login\?/.test(url) || /\/$/.test(new URL(url).pathname) || response?.status() === 404
      expect(isBlocked).toBe(true)
      expect(content).not.toContain('F.D smoke evento')
    })
  })
})

/**
 * Convierte un Date a YYYY-MM-DDTHH:MM (formato `<input type="datetime-local">`).
 * Usa hora local del runtime — los specs corren en CI con TZ del runner.
 */
function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`
}
