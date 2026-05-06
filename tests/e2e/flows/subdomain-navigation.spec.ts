import { test, expect } from '@playwright/test'
import { storageStateFor } from '../../helpers/playwright-auth'
import { appSubdomainUrl, appUrl, placeUrl } from '../../helpers/subdomain'
import { E2E_PLACES } from '../../fixtures/e2e-data'

/**
 * Regression guard del bug de navegación entre subdominios.
 *
 * Síntoma reportado: el user navega del inbox a un place y termina en
 * `https://the-company.place.community%20/` (con `%20` = espacio URL-encoded).
 *
 * Causa raíz: `NEXT_PUBLIC_APP_DOMAIN` con whitespace al final + URL builders
 * (`PlacesList`, `placeUrl`, `resolveSafeNext`) que no sanitizan el dominio
 * antes de interpolarlo. El whitespace se escapa a `%20` en el href y el
 * navegador resuelve a un host inválido → middleware redirige a `/not-found`.
 *
 * Estos 3 tests detectan tres facetas distintas del bug:
 *
 *  1. El href en `PlacesList` (server-rendered) NO debe contener `%20`
 *     ni whitespace de ningún tipo, y debe matchear el shape esperado del
 *     subdominio del place (`http(s)://<slug>.<appDomain>/`).
 *  2. La navegación directa al subdominio del place sirve la zona
 *     `/conversations` sin redirigir a `/not-found` ni `/login`, y la URL
 *     final no contiene `%20`.
 *  3. El `resolveSafeNext` del callback de auth NO debe propagar un
 *     `next=/not-found` malicioso o accidental — debe caer al inbox o a
 *     `/login` (cuando el code es inválido), nunca renderizar la página
 *     `/not-found` como destino válido.
 *
 * Storage state: `owner` — único rol con membership en palermo + admin.
 *
 * Cuando el bug está presente (estado actual del repo, antes de los fixes
 * del slice de URL sanitization), el Test 1 falla en la aserción del
 * regex del href. Cuando los fixes lleguen a main, los 3 deben quedar
 * verdes — sirven como guard contra reintroducción.
 */

test.use({ storageState: storageStateFor('owner') })

const palermo = E2E_PLACES.palermo

test.describe('Subdomain navigation — regression guard del bug %20', () => {
  test('inbox → click place → URL del subdomain sin whitespace ni %20', async ({ page }) => {
    await page.goto(appSubdomainUrl('/inbox'))

    // El link al place es un `<a href>` cuyo accessible name viene del
    // texto del `<h2>` con el name del place (ver `places-list.tsx`).
    // Usamos regex case-insensitive porque el name es "Palermo E2E" y
    // el matcher por role/name de Playwright hace partial match.
    const link = page.getByRole('link', { name: new RegExp(palermo.name, 'i') }).first()
    await expect(link).toBeVisible()

    const href = await link.getAttribute('href')
    expect(href, 'href del link al place no puede ser null').toBeTruthy()

    // Ninguna codificación de whitespace permitida — ni `%20`, ni `+`,
    // ni whitespace literal. El bug original aparece como `%20` al final
    // del hostname (`the-company.place.community%20/`).
    expect(href).not.toContain('%20')
    expect(href).not.toMatch(/\s/)

    // Shape esperado: `http(s)://<slug>.<appDomain>/` donde `<appDomain>`
    // en E2E es `lvh.me:3001` (override de `playwright.config.ts`). El
    // trailing slash es opcional para tolerar futuros refactors del
    // builder; lo importante es que no haya basura entre el host y el `/`.
    expect(href).toMatch(/^https?:\/\/e2e-palermo\.lvh\.me:3001\/?$/)
  })

  test('navegación directa al subdomain no termina en /not-found ni /login', async ({ page }) => {
    await page.goto(placeUrl(palermo.slug, '/conversations'))
    await page.waitForLoadState('domcontentloaded')

    const finalUrl = page.url()

    // Si el dominio se corrompe con whitespace, el middleware no puede
    // resolver el placeSlug y termina redirigiendo a `/not-found` o
    // `/login`. Cualquiera de las dos == bug presente.
    expect(finalUrl).not.toContain('/not-found')
    expect(finalUrl).not.toContain('/login')
    // Defensivo extra: la URL final tampoco puede traer whitespace
    // codificado — síntoma directo del bug.
    expect(finalUrl).not.toContain('%20')
  })

  test('callback con next=/not-found → fallback seguro (nunca rendea /not-found)', async ({
    page,
  }) => {
    // Simulamos el flow malicioso/accidental: alguien (ej. magiclink
    // generado con next inválido) llega al callback con `next=/not-found`.
    // `resolveSafeNext` debe rechazar el path peligroso y caer al inbox.
    // Como pasamos un `code=fake` el exchange con Supabase va a fallar,
    // así que aceptamos `/login` como destino legítimo (caso "code
    // inválido"). Lo único inaceptable es terminar en `/not-found`.
    await page.goto(appUrl('/auth/callback?next=%2Fnot-found&code=fake'))
    await page.waitForLoadState('domcontentloaded')

    expect(page.url()).not.toContain('/not-found')
  })
})
