# Tests del Settings V1 — TDD plan

> _Creado 2026-05-20_. Compañía del [spec del settings](./spec.md). Detalla los tests que cubren genuinamente el comportamiento (no internals). Cada test responde a "¿qué dejaría de funcionar si esto no estuviera?"

## Mandato TDD (CLAUDE.md §47)

**Tests primero, verificar que fallan, implementar, verificar que pasan. Sin excepciones en el core.**

## Lo que SÍ probamos (y por qué importa)

### 1. `deepMerge` i18n fallback — pure function (sesión S1)

**Por qué importa:** todo el render de los 6 locales depende de esta función. Bug aquí = key sin traducir muestra `[settings.title]` literal en lugar del fallback al default.

**Tests** (en `src/i18n/__tests__/deep-merge.test.ts`):

1. **Default solo (locale === default) → retorna default unchanged.**
2. **Locale completo (todas las keys presentes) → retorna locale unchanged.**
3. **Locale parcial (algunas keys faltan) → keys faltantes vienen del default; keys presentes vienen del locale.**
4. **Nested objects (e.g. `placeSettings.sidebar.language`) → merge profundo recursivo.**
5. **Locale tiene key adicional NO presente en default → la key adicional aparece en el output (forward-compat).**
6. **Empty locale (`{}`) → retorna default 100%.**

**Total sesión S1: ~6 tests.**

### 2. `check-translations` script — informativo (sesión S1)

**Por qué importa:** detectar drift entre locales y reportar sin bloquear el build.

**Tests** (en `scripts/__tests__/check-translations.test.mjs` o equivalente):

1. **6 locales idénticos → reporta "0 keys missing" en cada uno.**
2. **`de.json` con 3 keys faltantes → reporta exactamente "3 keys missing in de.json: [...]".**
3. **Locale con key extra (no en default) → reporta "1 extra key in {locale}.json: [...]".**
4. **Exit code = 0 siempre (informativo, no fail-closed).**

(Si el script es Node ESM puro, los tests pueden ser un .mjs script que se corre con `node`, no vitest.)

**Total sesión S1: ~4 tests (script).**

### 3. `getTranslations({locale})` override empírico — smoke (sesión S1.5)

**Por qué importa:** el patrón es el core del i18n DB-based; si no funciona, todo el settings cae.

**Smoke** (no es test unitario sino verificación empírica):

1. **Page dummy en `/test-locale-override/` invoca `getTranslations({locale: "de"})`.**
2. **Build + curl local → respuesta contiene strings alemanes (o fallback al default si las keys no están en de.json).**
3. **Si funciona, documentar el patrón en gotcha + borrar page dummy.**
4. **Si falla, plan-B documentado.**

**Total sesión S1.5: smoke manual + gotcha doc. Cero tests unitarios.**

### 4. `loadPlaceBySlug` — DB integration (sesión S3)

**Por qué importa:** el guard owner-only del settings depende de esta query. Bug = no-owner ve settings (security incident).

**Tests** (en `src/features/place/__tests__/load-place-by-slug.test.ts`, vitest + `inRlsTx`):

1. **Owner del place existente → retorna `PlaceData` con todos los campos (id, slug, name, defaultLocale, themeConfig).**
2. **`defaultLocale` viene como `PlaceLocale` literal type (no `string`).**
3. **No-owner, no-member → retorna `null` (RLS filtra).**
4. **Member no-owner → retorna `null` (settings es owner-only, NO usa member-read).**
5. **Slug inexistente → retorna `null`.**
6. **Place con `archived_at NOT NULL` → retorna `null` (lifecycle: archivados no son servibles).**

**Total sesión S3: ~6 tests.**

### 5. Wizard selector idioma — Client (sesión S2b)

**Por qué importa:** el owner elige el idioma; default del path activo previene fricción ("ya está en mi idioma").

**Tests** (extensión de `src/features/place-wizard/__tests__/place-wizard.test.tsx`):

1. **Render Paso 1 con `defaultLocale="es"` → segmented control renderea con 6 opciones; "Español" seleccionado.**
2. **Render Paso 1 con `defaultLocale="de"` → "Deutsch" seleccionado.**
3. **Click otra opción ("Català") → estado actualizado; "Català" highlighted.**
4. **Cada opción muestra el endonym correcto.**
5. **Touch targets ≥44×44 px en mobile (verificable via getComputedStyle).**
6. **Submit (avance del wizard) propaga `defaultLocale` al `onSubmit` payload (mock).**

**Total sesión S2b: ~6 tests nuevos en el wizard.**

### 6. `AppShell` agnóstico — Server + Client (sesión S4)

**Por qué importa:** abstracción central reusada por nav-hub y nav-place. Bug = ambos rompen.

**Tests** (en `src/shared/ui/app-shell/__tests__/app-shell.test.tsx`):

1. **Render con `sidebarItems: [...]` → todos los items renderean con sus labels.**
2. **`activeKey="language"` → ese item tiene `aria-current="page"` + estilos activos.**
3. **Item con `disabled: true` tiene `aria-disabled="true"` + tooltip mostrado en focus/hover.**
4. **Mobile (viewport <768px): drawer oculto por default + hamburger visible.**
5. **Click hamburger → drawer abre + overlay aparece.**
6. **Click overlay → drawer cierra.**
7. **Avatar muestra iniciales correctas desde `displayName`.**
8. **Click avatar → dropdown abre con "Cerrar sesión".**
9. **Click "Cerrar sesión" → invoca `onLogout()` exactamente 1 vez (mock).**
10. **No imports de `@/features/*` (acíclico) — verificable con grep en CI.**

**Tests de regresión Hub** (en `src/features/nav-hub/__tests__/nav-hub-layout.test.tsx`):

- Todos los tests existentes del Hub deben pasar sin cambio. Si alguno falla post-refactor, el refactor introdujo regresión.

**Total sesión S4: ~10 tests nuevos AppShell + ~existentes Hub sin regresión.**

### 7. `NavPlaceLayout` — Server (sesión S5)

**Por qué importa:** sidebar del settings con 1 sección activa, 5 disabled.

**Tests** (en `src/features/nav-place/__tests__/nav-place-layout.test.tsx`):

1. **Render sidebar con 6 items correctos.**
2. **`activeSection="language"` → "Idioma del place" highlighted + `aria-current`.**
3. **Items 2-6 (members, appearance, hours, billing, domain) tienen `aria-disabled` + tooltip "Próximamente".**
4. **Title en topbar = "Configurar tu lugar".**
5. **Mobile drawer (smoke; el detalle ya está cubierto en AppShell).**
6. **Logout action se reusa correctamente (smoke; mock `logoutAction` invocado al click).**

**Total sesión S5: ~6 tests.**

### 8. `LocaleSection` — Client (sesión S7)

**Por qué importa:** primera sección funcional del settings; UX directa del owner.

**Tests** (en `src/features/place-settings/__tests__/locale-section.test.tsx`):

1. **Render con `currentLocale="es"` → select muestra 6 opciones; "Español" seleccionado.**
2. **Pristine (sin cambios) → botón "Guardar" disabled.**
3. **Cambio del select → botón habilitado (dirty).**
4. **Submit → mock `updateAction({placeSlug, newLocale})` invocado exactamente 1 vez con args correctos.**
5. **Action retorna `{status: "ok"}` → muestra success notice "Idioma actualizado. La próxima carga aparecerá en {endonym}".**
6. **Action retorna `{status: "error"}` → muestra error notice; form sigue editable.**
7. **Durante submit (action pendiente) → botón muestra "Guardando…"; select disabled.**
8. **Idempotencia: doble click no dispara dos actions.**

**Total sesión S7: ~8 tests.**

### 9. Server Action `updateDefaultLocale` — seam-split (sesión S7)

**Por qué NO se testea con vitest:**

- Importa `next/headers` (para `getSessionJwt` que llama Neon Auth).
- Importa `next/cache` (para `revalidatePath`).
- Toca DB real (`getAuthenticatedDb`).
- Su patrón es idéntico a `createPlaceAction`, `logoutAction`, `signUpAccountAction` — todos los cuales son testeados via tipo/build + smoke prod (canon documentado en `docs/features/inbox/spec.md`, `place-wizard.test.tsx:11-15`, etc.).

**Validación:**

- `pnpm typecheck` — verifica que el zod schema + signature están correctos.
- `pnpm build` — verifica que el wiring funciona en build prod.
- **Smoke prod end-to-end** (post-S7):
  1. Login como owner del place.
  2. Visitar `https://{slug}.place.community/settings`.
  3. Cambiar el select a otro idioma (e.g. 'de').
  4. Click "Guardar" → ver success notice.
  5. Hard-reload → ver el chrome en alemán.
  6. Verificar en Neon: `SELECT default_locale FROM place WHERE slug = ?` → 'de'.
  7. Revertir a 'es' para no dejar el place en estado raro.

**Total sesión S7 testing: 8 vitest (Client) + smoke prod (Server Action).**

## Lo que NO probamos (decisión)

- **RLS owner-only de `place_sel`/`place_upd`** — ya cubierto en `src/db/__tests__/rls.test.ts` desde el Hub V1 (tests 1-6 del miembro/owner). El settings hereda sin trabajo nuevo. Si se modifica la policy, esos tests fallan — feedback loop OK.
- **Migration `0006_place_default_locale.sql`** — idempotencia se verifica empíricamente al correr `pnpm db:migrate` dos veces (segunda corrida no rompe). No vitest test.
- **Migration `0007_create_place_fn_with_locale.sql`** — additive backward-compat se verifica via existing tests del wizard (place-first sin `defaultLocale` sigue creando place con DEFAULT 'es'). Si rompe, los tests del wizard fallan.
- **next-intl runtime con `getTranslations({locale})` override** — smoke empírico en S1.5, no vitest (es comportamiento del framework, no del producto).
- **Performance** — no se mide en vitest. Spec lo documenta como target; smoke prod via Vercel Speed Insights.
- **Visual regression** — sin snapshot tests; RTL `getByText`/`getByRole` cubre el contrato.
- **Cross-browser locale rendering** — manual smoke en producción (Chrome + Safari + Firefox).
- **Mobile drawer gestures (swipe-left)** — cubierto en AppShell tests pero el comportamiento real se valida en mobile real (iOS/Android), no en jsdom.

## Smoke manual (post-S7, EN PRODUCCIÓN)

Lista para ejecutar tras el push final:

### Flujos críticos

1. **Owner cambia idioma desde settings**:
   - Login como owner del place con `default_locale = 'es'`.
   - Visitar `{slug}.place.community/settings` → ver chrome en español.
   - Cambiar select a "Deutsch" → click "Guardar".
   - Ver success notice.
   - Hard-reload → ver chrome en alemán; `<html lang="de">`.
   - Verificar en Neon DB: `SELECT default_locale FROM place WHERE slug = ?` → 'de'.

2. **No-owner intenta acceder**:
   - Login como user que es miembro (no owner) del place.
   - Visitar `{slug}.place.community/settings` → ver página de Lugar no encontrado.
   - Sin error específico (no doxxea que /settings existe ni que no tenés permiso).

3. **Sesión expirada**:
   - Logout en apex.
   - Visitar `{slug}.place.community/settings` → redirect a login.

4. **Wizard crea place en alemán**:
   - Sesión limpia, visitar `place.community/de/crear` → wizard en alemán.
   - Default del selector idioma = "Deutsch".
   - Completar pasos → submit.
   - Verificar en Neon: `SELECT default_locale FROM place WHERE slug = ?` → 'de'.
   - Visitar settings del place creado → ya está en alemán.

5. **Mobile** (viewport <768px o phone real):
   - Settings: sidebar oculto, hamburger visible.
   - Tap hamburger → drawer slide-in.
   - Tap overlay → drawer cierra.
   - Form del idioma full-width, select tap-friendly.

### i18n fallback

6. **Locale parcial**:
   - Forzar place en `default_locale = 'de'`.
   - Las keys de `placeSettings` están en `de.json` (stub copiado de es) → todo en alemán literal.
   - Si una key fuera removida de `de.json`, cae a `es.json` (deep-merge). Verificar en build local manipulando un JSON temporal.

### 6 locales SSG en marketing

7. **URLs públicas en marketing**:
   - `place.community/es/` → landing en español (existente).
   - `place.community/en/` → landing renderea con fallback al default (e.g. textos en español por ahora — keys faltantes en en.json).
   - Idem `/fr/`, `/pt/`, `/de/`, `/ca/`.
   - Sin 404 en ningún locale.
   - Build genera SSG para los 6 — Vercel output `Generating static pages using 7 workers (60+/60+)` o equivalente.

### Hub con 6 locales

8. **Hub responde 6 locales**:
   - `app.place.community/de/` → renderea Hub (con fallback al default si keys faltan).
   - Cookie `NEXT_LOCALE=de` persiste cross-subdomain (validar — si no, mini-commit aparte agregando `localeCookie.domain`).

## Métricas de cobertura

V1 esperado:
- ~6 tests deep-merge (sesión S1).
- ~4 tests check-translations (sesión S1).
- ~6 tests loadPlaceBySlug (sesión S3).
- ~6 tests wizard selector (sesión S2b).
- ~10 tests AppShell agnóstico (sesión S4).
- ~6 tests NavPlaceLayout (sesión S5).
- ~8 tests LocaleSection (sesión S7).

**Total esperado: ~46 tests nuevos. Suite final: ~304 tests** (258 actuales + 46 nuevos).

**Deltas en suite existente**: ninguno esperado. El refactor S4 NO debería cambiar tests del Hub (regresión cero).

## Mobile-first checklist

- Layout viewport 320px mínimo.
- Touch targets ≥44×44 px (selector, botón "Guardar", items sidebar).
- Drawer slide-in <200ms con `prefers-reduced-motion` respect.
- Tap overlay cierra drawer.
- Skip-link `a[href="#contenido"]` visible al tab focus.

## Performance target

- TTFB <300ms en settings (Server Component + 1 DB query + i18n load).
- LCP <2.5s.
- CLS = 0.
- Lighthouse Performance ≥90 en settings.
