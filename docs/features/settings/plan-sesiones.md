# Plan de implementación — Settings + i18n del place (12 sesiones)

> _Creado 2026-05-20_. Divide el [spec del settings](./spec.md) en sesiones cortas y atómicas. TDD obligatorio (CLAUDE.md §47) donde aplique. Green-close completo antes de commit. Compact entre sesiones para mantener ventana de contexto limpia.

## Resumen

12 sesiones secuenciales (no paralelizables — cada una habilita la siguiente):

| Sesión | Scope | Files | Capa |
|---|---|---|---|
| **S0a** | Docs del feature (spec + plan + tests + ADR-0022 + decisions/README) | 5 | docs |
| **S0b** | ADRs técnicos (0023 app-shell, 0024 fallback i18n) + updates transversales | 5 | docs |
| **S0c** | producto.md + data-model.md + CLAUDE.md + landingpage banners | 5 | docs |
| **S1** | i18n foundation (6 locales + deep-merge fallback + check-translations) | 5 | infra |
| **S1.5** | Smoke `getTranslations({locale})` override + gotcha | 1-2 | infra |
| **S2a** | DB infra (migration 0006 + 0007 additive + schema + zod + create-place) | 5 | DB |
| **S2b** | Wizard selector idioma Paso 1 | 5 | UI |
| **S3** | Slice `place` + loadPlaceBySlug | 4 | data |
| **S4** | Refactor `<AppShell>` agnóstico + nav-hub consumer | 5 | UI |
| **S5** | Slice `nav-place` (consume AppShell, sidebar settings) | 5 | UI |
| **S6** | Settings page shell vacío + i18n del place + html lang dinámico + skip-link | 5 | wiring |
| **S7** | Sección "Idioma del place" + Server Action UPDATE | 5 | feature |

S0a/S0b/S0c son docs only (sin código). S1 a S7 ejecutan. Cada sesión cumple `≤5 archivos` (CLAUDE.md "Un prompt = una responsabilidad").

---

## Sesión S0a — Docs canónicos del feature settings

### Objetivo

Documentar el feature antes de tocar código. CLAUDE.md §"Documentación primero".

### Trabajo

1. **Crear `docs/features/settings/spec.md`** — visión V1, alcance, vistas, journeys, auth/redirects, slice arquitectura, i18n keys, mobile-first checklist, decisiones cerradas.
2. **Crear `docs/features/settings/plan-sesiones.md`** (este archivo).
3. **Crear `docs/features/settings/tests.md`** — TDD plan detallado por sesión.
4. **Crear `docs/decisions/0022-locale-del-place.md`** — ADR de las decisiones de producto/dominio (default_locale editable, scope V1, single-owner V1, migration additive).
5. **Modificar `docs/decisions/README.md`** — agregar entry ADR-0022.

### Files

- **Crear**: `docs/features/settings/spec.md`, `docs/features/settings/plan-sesiones.md`, `docs/features/settings/tests.md`, `docs/decisions/0022-locale-del-place.md`.
- **Modificar**: `docs/decisions/README.md`.

### Verificación

- MD válido (sin errores de sintaxis MD).
- Sin cambios de código → `pnpm test`, `pnpm typecheck`, `pnpm build` verdes (sin regresión).

### Commit

`docs(settings): spec V1 + plan 12 sesiones + ADR-0022 (locale del place editable)`

---

## Sesión S0b — ADRs técnicos i18n + updates transversales

### Objetivo

Documentar las decisiones arquitectónicas/técnicas (app-shell agnóstico, fallback i18n) + actualizar docs canónicos del producto.

### Trabajo

1. **Crear `docs/decisions/0023-app-shell-agnostico-shared-ui.md`** — ADR: extraer shell mobile-first agnóstico a `shared/ui/app-shell`. Mantiene `shared/` sin importar de `features/`. Consumers: `nav-hub`, `nav-place`. Refina ADR-0014/0015/0016 (split de slices).
2. **Crear `docs/decisions/0024-i18n-fallback-deep-merge.md`** — ADR: deep-merge runtime de `defaultLocale.json` con `{locale}.json` en `i18n/request.ts`. UX nunca rompe por key faltante. check-translations es informativo, no fail-closed.
3. **Modificar `docs/multi-tenancy.md`** — agregar sección "Zona Place — Settings" (URL canónica, proxy, RLS owner-only, i18n DB-based, html lang dinámico).
4. **Modificar `docs/architecture.md`** — agregar sección "i18n: dos modos de resolución de locale" (path-based marketing/hub vs DB-based zona place). Update breve de § paradigma para mencionar `shared/ui/app-shell` agnóstico (puntero a ADR-0023).
5. **Modificar `docs/stack.md`** — § i18n: 6 locales operativos, fallback strategy runtime, script `check-translations`.

### Files

- **Crear**: `docs/decisions/0023-app-shell-agnostico-shared-ui.md`, `docs/decisions/0024-i18n-fallback-deep-merge.md`.
- **Modificar**: `docs/multi-tenancy.md`, `docs/architecture.md`, `docs/stack.md`.

### Verificación

- Idem S0a.

### Commit

`docs: ADRs 0023+0024 + actualizaciones canónicas (multi-tenancy, architecture, stack)`

---

## Sesión S0c — producto.md + data-model.md + CLAUDE.md + landingpage banners

### Objetivo

Cerrar la documentación canónica: principio de producto ("locale propio del place"), schema planeado, mapa de docs en CLAUDE.md, banners históricos en landingpage.

### Trabajo

1. **Modificar `docs/producto.md`** — agregar principio "Cada place habla un idioma único" + implicancia UX (miembros ven el chrome del place en el idioma del owner).
2. **Modificar `docs/data-model.md`** — anotar `place.default_locale text NOT NULL DEFAULT 'es'` planeado + CHECK constraint en 6 locales. Invariante: editable por owner.
3. **Modificar `CLAUDE.md`** — § "Mapa de documentos canónicos" agregar línea `docs/features/settings/`.
4. **Modificar `docs/landingpage/README.md`** — agregar banner al inicio "Update 2026-05-20 (post-ADR-0022): 6 locales operativos. Las menciones de 4 locales en este doc son históricas del cierre de la landing V1." No editar el cuerpo (preservar registro histórico per pattern ADR-0005/0006/0008).
5. **Modificar `docs/landingpage/implementation-plan.md`** — banner análogo. No editar cuerpo.

### Files

- **Modificar**: `docs/producto.md`, `docs/data-model.md`, `CLAUDE.md`, `docs/landingpage/README.md`, `docs/landingpage/implementation-plan.md`.

### Verificación

- Idem S0a.

### Commit

`docs: locale del place propio + landing 4→6 locales (banner histórico) + mapa CLAUDE.md`

---

## Sesión S1 — i18n foundation (6 locales + deep-merge fallback + check-translations)

### Objetivo

Habilitar los 6 locales operativos en toda la app + infra de fallback runtime + script informativo de drift.

### Pre-condiciones

- S0c mergeada (docs canónicos primero).
- `git status` limpio.
- `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build` verdes en main local.

### Trabajo

1. **Modificar `src/i18n/routing.ts`** — agregar `de`, `ca` a `locales`. `locales: ["es", "en", "fr", "pt", "de", "ca"]`. Default sigue `es`.
2. **Modificar `src/i18n/request.ts`** — agregar deep-merge runtime. Pseudocódigo:
   ```ts
   const defaultMessages = (await import(`./messages/${routing.defaultLocale}.json`)).default;
   const localeMessages = locale === routing.defaultLocale
     ? defaultMessages
     : (await import(`./messages/${locale}.json`)).default;
   const messages = deepMerge(defaultMessages, localeMessages);
   ```
   `deepMerge` es función pura ~15 LOC; testeable. Si already exists alguna util en el repo, reusar.
3. **Crear `src/i18n/messages/de.json`** — copia de `es.json` (placeholder hasta traducción real).
4. **Crear `src/i18n/messages/ca.json`** — idem.
5. **Crear `scripts/check-translations.mjs`** — compara keys recursivamente entre los 6 JSONs; output informativo `[check-translations] de.json: 12 keys missing vs es.json`. NO `process.exit(1)` — informativo, no fail-closed.

**Decisión sobre en/fr/pt**: si NO existen físicamente hoy, el deep-merge runtime + el routing.ts.locales = ["es","en","fr","pt","de","ca"] generaría error en `await import(./messages/en.json)`. Mitigaciones:
- (a) Crear stubs vacíos `{}` para los faltantes — el deep-merge usa default 100%.
- (b) Copiar `es.json` como stub — UX cae a español pero los nombres de keys validan.

**Recomendado**: (b) copia. Más simple, menos código, garantiza que ninguna key falta. El check-translations alertará drift cuando se agreguen keys nuevas.

Si la decisión es (a) stub vacío y queremos minimizar files, podemos crear los 5 (en, fr, pt, de, ca) en esta sesión — pero excede ≤5 archivos. Mantener S1 a 5 archivos: solo `de` y `ca` se crean (las que están explícitamente requeridas por el feature). `en`, `fr`, `pt` se completan en `S2b` o `S6` cuando se agregue el namespace `placeSettings`.

**Revisión empírica antes de implementar**: verificar si `en/fr/pt.json` existen en `src/i18n/messages/`. Si no, decidir si crearlos como copias de es.json en S1 (suma 3 archivos → 8 total → dividir S1) o tratarlos como gap separado. **Defer la decisión al inicio de S1** post-empírico.

### Files

- **Modificar**: `src/i18n/routing.ts`, `src/i18n/request.ts`.
- **Crear**: `src/i18n/messages/de.json`, `src/i18n/messages/ca.json`, `scripts/check-translations.mjs`.

### Verificación

- `pnpm build` genera SSG para los 6 locales en `[locale]` paths (marketing/hub).
- `node scripts/check-translations.mjs` corre y reporta sin abortar.
- `pnpm test` verde (sin regresión).

### Commit

`feat(i18n): 6 locales operativos + deep-merge fallback + check-translations script`

---

## Sesión S1.5 — Smoke `getTranslations({locale})` override + gotcha

### Objetivo

Verificar empíricamente que `getTranslations({locale: placeLocale})` funciona desde una page sin `[locale]` en el path. Documentar el patrón en gotcha.

### Pre-condiciones

- S1 mergeada (los 6 locales + fallback OK).

### Trabajo

1. Crear una page dummy temporal en `src/app/test-locale-override/page.tsx` (NO bajo route-group) que hace `getTranslations({locale: 'de'})` y rendere algún string del namespace existente (e.g. `inbox.viewTitle` → "Deine Orte" si está traducido, sino fallback a "Tus lugares").
2. Build + smoke local: `pnpm build && pnpm start` → curl `http://localhost:3000/test-locale-override` → confirmar respuesta.
3. **Si funciona**: documentar el patrón en `docs/gotchas/i18n-locale-override-zona-place.md` con el código exacto verificado. Update `docs/gotchas/README.md`. **Borrar** la page dummy.
4. **Si falla**: diagnosticar el error específico. Plan-B documentado: cargar messages a mano con `import(./messages/${locale}.json)` y construir el `t` localmente. Documentar el plan-B en el gotcha.
5. Si falla y el plan-B también requiere ajustes mayores: detener el plan y reevaluar (es un blocker arquitectónico).

### Files

- **Crear** (temporal, borrar al final): `src/app/test-locale-override/page.tsx`.
- **Crear** (permanente): `docs/gotchas/i18n-locale-override-zona-place.md`.
- **Modificar**: `docs/gotchas/README.md`.

### Verificación

- Smoke local OK.
- Gotcha documentado.
- Page dummy borrada (verificar `git status`).

### Commit

`docs(gotcha): patrón getTranslations({locale}) override desde page sin [locale]`

---

## Sesión S2a — DB infra place.default_locale + create_place backward-compatible

### Objetivo

Agregar `place.default_locale` a la DB de forma idempotente + backward-compatible. NO drop+create de funciones (evita downtime).

### Pre-condiciones

- S1 + S1.5 mergeadas. El patrón i18n verificado funciona.

### Trabajo

1. **Crear `src/db/migrations/0006_place_default_locale.sql`**:
   ```sql
   -- Idempotente: IF NOT EXISTS via DO BLOCK.
   DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name='place' AND column_name='default_locale') THEN
       ALTER TABLE place ADD COLUMN default_locale text NOT NULL DEFAULT 'es';
     END IF;
   END $$;

   DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM information_schema.constraint_column_usage
                    WHERE table_name='place' AND constraint_name='place_default_locale_check') THEN
       ALTER TABLE place ADD CONSTRAINT place_default_locale_check
         CHECK (default_locale IN ('es', 'en', 'fr', 'pt', 'de', 'ca'));
     END IF;
   END $$;
   ```

2. **Crear `src/db/migrations/0007_create_place_fn_with_locale.sql`**:
   ```sql
   -- ADITIVA: agregar parámetro con DEFAULT. Calls viejos (5 args) siguen funcionando.
   CREATE OR REPLACE FUNCTION app.create_place(
     p_slug text,
     p_name text,
     p_description text,
     p_theme_config jsonb,
     p_opening_hours jsonb,
     p_default_locale text DEFAULT 'es'
   ) RETURNS ...
   $$
     ...
     INSERT INTO place (slug, name, description, theme_config, opening_hours, default_locale, ...)
       VALUES (p_slug, p_name, p_description, p_theme_config, p_opening_hours, p_default_locale, ...);
     ...
   $$;
   ```
   **No DROP**: `CREATE OR REPLACE` con la misma signature externa pero parámetro nuevo con DEFAULT — Postgres acepta esto (cambio de body + agrego de param opcional). Si Postgres no acepta el cambio de signature, plan-B: function overloading (definir nueva signature de 6 args y mantener la vieja vía wrapper). Verificar empíricamente en local antes de aplicar.

3. **Modificar `src/db/schema/index.ts`** — agregar `defaultLocale: text("default_locale").notNull().default("es")` a la tabla `place`.

4. **Modificar `src/features/place-creation/schema.ts`** — agregar `defaultLocale: z.enum(["es","en","fr","pt","de","ca"]).default("es")` al input zod de `CreatePlaceInput`.

5. **Modificar `src/features/place-creation/create-place.ts`** — pasar `p_default_locale: input.defaultLocale` al `app.create_place(...)` call.

### Files

- **Crear**: `src/db/migrations/0006_place_default_locale.sql`, `src/db/migrations/0007_create_place_fn_with_locale.sql`.
- **Modificar**: `src/db/schema/index.ts`, `src/features/place-creation/schema.ts`, `src/features/place-creation/create-place.ts`.
- **Modificar** (journal): `src/db/migrations/meta/_journal.json` — agregar 2 entries.

(El journal modify cuenta como 1 archivo más. Total 6. Apretado pero aceptable porque journal entries son cambios mecánicos de 1-2 líneas).

### Verificación

- `pnpm db:migrate` local OK (idempotente: re-correr no rompe).
- `pnpm typecheck` verde.
- `pnpm test` verde — todos los tests existentes que llaman `createPlaceAction` siguen verdes (default 'es' si no se pasa).
- `pnpm build` verde.

### Commit

`feat(db): place.default_locale + create_place fn backward-compatible (additive)`

---

## Sesión S2b — Wizard selector idioma Paso 1 (6 endonyms, default = locale path)

### Objetivo

Permitir al owner elegir el idioma del place al crear. UX integrada al Paso 1 sin sumar pasos.

### Pre-condiciones

- S2a mergeada.

### Trabajo

1. **TDD: tests del Paso 1 con el nuevo selector** en `src/features/place-wizard/__tests__/place-wizard.test.tsx`:
   - Selector renderea con 6 opciones (endonyms).
   - Default = el `defaultLocale` pasado como prop.
   - Cambio del selector actualiza el state.
   - Submit incluye `defaultLocale` en el payload de `onSubmit`.
2. **Modificar `src/features/place-wizard/use-identity-step.ts`** — agregar `defaultLocale` state + setter + valid (siempre true porque es enum cerrado).
3. **Modificar `src/features/place-wizard/wizard-steps.tsx`** — agregar segmented control con 6 opciones arriba del campo nombre.
4. **Modificar `src/features/place-wizard/wizard-labels.ts`** — agregar `defaultLocaleLabel: string` + `defaultLocaleOptions: Record<Locale, string>` al interface.
5. **Modificar `src/app/(marketing)/[locale]/crear/page.tsx`** — pasar `defaultLocale={locale}` (del path) como prop default del wizard.

### Files

- **Modificar**: `src/features/place-wizard/use-identity-step.ts`, `src/features/place-wizard/wizard-steps.tsx`, `src/features/place-wizard/wizard-labels.ts`, `src/features/place-wizard/__tests__/place-wizard.test.tsx`, `src/app/(marketing)/[locale]/crear/page.tsx`.

(`use-place-wizard.ts` puede o no requerir cambio dependiendo de cómo el state fluye. Verificar empíricamente — si requiere, ajustar el split a S2b.1 + S2b.2.)

### Verificación

- TDD verde.
- Suite total +6 tests.
- Smoke wizard local: crea place con locale custom (e.g. 'de'); verificar en DB `SELECT default_locale FROM place WHERE slug = ?`.

### Commit

`feat(wizard): selector idioma Paso 1 + propagación al create_place (6 endonyms)`

---

## Sesión S3 — Slice `place` + loadPlaceBySlug

### Objetivo

Crear el slice `place` con la query `loadPlaceBySlug` que retorna `PlaceData | null` filtrado por RLS owner-only.

### Pre-condiciones

- S2a mergeada (la columna `default_locale` existe).

### Trabajo

1. **TDD: tests** en `src/features/place/__tests__/load-place-by-slug.test.ts` (vitest + `inRlsTx`):
   - Test 1: owner del place → retorna `PlaceData` con todos los campos.
   - Test 2: no-owner, no-member → retorna `null` (RLS filtra).
   - Test 3: member no-owner → retorna `null` (settings es owner-only, no member-read).
   - Test 4: slug inexistente → retorna `null`.
   - Test 5: place archived_at NOT NULL → retorna `null` (lifecycle).
2. **Crear `src/features/place/domain/place-data.ts`**:
   ```ts
   export type PlaceLocale = "es" | "en" | "fr" | "pt" | "de" | "ca";
   export type PlaceData = {
     id: string;
     slug: string;
     name: string;
     defaultLocale: PlaceLocale;
     themeConfig: ThemeConfig;
     // ... otros campos según necesidad de consumers
   };
   ```
3. **Crear `src/features/place/queries/load-place-by-slug.ts`**:
   ```ts
   export async function loadPlaceBySlug(
     executor: SqlExecutor,
     slug: string,
   ): Promise<PlaceData | null> {
     const rows = await executor.unsafe(
       `SELECT id, slug, name, default_locale AS "defaultLocale", theme_config AS "themeConfig"
        FROM place WHERE slug = $1 AND archived_at IS NULL LIMIT 1`,
       [slug],
     );
     return rows[0] ?? null;
   }
   ```
4. **Crear `src/features/place/public.ts`** — exports.

### Files

- **Crear**: `src/features/place/public.ts`, `src/features/place/domain/place-data.ts`, `src/features/place/queries/load-place-by-slug.ts`, `src/features/place/__tests__/load-place-by-slug.test.ts`.

### Verificación

- TDD rojo→verde de los 5 tests.
- Suite total +5 tests.

### Commit

`feat(place): slice place + loadPlaceBySlug (RLS owner-only)`

---

## Sesión S4 — Refactor `<AppShell>` agnóstico + nav-hub consumer

### Objetivo

Extraer el shell mobile-first agnóstico (topbar + sidebar + drawer) a `shared/ui/app-shell` para reusar entre nav-hub y nav-place. Sin cambio de comportamiento en el Hub V1.

### Pre-condiciones

- S0b mergeada (ADR-0023 documenta esta decisión).

### Trabajo

1. **Crear `src/shared/ui/app-shell/app-shell.tsx`** — componente Server agnóstico que recibe `sidebarItems: SidebarItem[]` + `activeKey: string` + `displayName?: string` + `onLogout: () => Promise<{redirectTo: string}>` + `title: string` + `labels: AppShellLabels` + `children`. NO importa de `features/`.
2. **Crear `src/shared/ui/app-shell/app-shell-labels.ts`** — interfaces genéricos.
3. **Crear `src/shared/ui/app-shell/__tests__/app-shell.test.tsx`** — tests del shell agnóstico.
4. **Modificar `src/features/nav-hub/ui/nav-hub-layout.tsx`** — pasa a ser thin wrapper que llama `<AppShell sidebarItems={hubSidebarItems(...)} activeKey={activeSection} ... />`.
5. **Modificar `src/features/nav-hub/__tests__/nav-hub-layout.test.tsx`** — verificar que tests del Hub V1 siguen verdes con el refactor (regresión).

### Files

- **Crear**: `src/shared/ui/app-shell/app-shell.tsx`, `src/shared/ui/app-shell/app-shell-labels.ts`, `src/shared/ui/app-shell/__tests__/app-shell.test.tsx`.
- **Modificar**: `src/features/nav-hub/ui/nav-hub-layout.tsx`, `src/features/nav-hub/__tests__/nav-hub-layout.test.tsx`.

### Verificación

- Suite Hub verde (sin regresión).
- Suite total +5 tests (del AppShell).
- LOC: nav-hub-layout reducido (delega al shell); shared/ui/app-shell ≤300.
- Acíclico: `grep -rn "from \"@/features/" src/shared/` → vacío. Crítico.

### Commit

`refactor(shared): extraer AppShell agnóstico a shared/ui + nav-hub consume (ADR-0023)`

---

## Sesión S5 — Slice `nav-place` (consume AppShell)

### Objetivo

Slice del shell del settings: NavPlaceLayout consume `AppShell` con su sidebar de 6 secciones (1 activa, 5 disabled).

### Pre-condiciones

- S4 mergeada (AppShell agnóstico listo).

### Trabajo

1. **TDD: tests** en `src/features/nav-place/__tests__/nav-place-layout.test.tsx`:
   - Render sidebar con 6 items.
   - Item activo ("language") tiene `aria-current="page"`.
   - Items disabled tienen `aria-disabled="true"` + tooltip "Próximamente".
   - Mobile drawer comportamiento (smoke; AppShell ya cubre el detalle).
2. **Crear `src/features/nav-place/ui/nav-place-layout.tsx`** — wrapper de `AppShell` con `placeSidebarItems(labels)`.
3. **Crear `src/features/nav-place/ui/nav-place-labels.ts`** — interface con labels de los 6 ítems.
4. **Crear `src/features/nav-place/public.ts`** — exports `NavPlaceLayout`, `NavPlaceLabels`, `NavPlaceActiveSection`.

### Files

- **Crear**: `src/features/nav-place/public.ts`, `src/features/nav-place/ui/nav-place-layout.tsx`, `src/features/nav-place/ui/nav-place-labels.ts`, `src/features/nav-place/__tests__/nav-place-layout.test.tsx`.

### Verificación

- TDD verde.
- Suite total +6 tests.
- Acíclico OK.

### Commit

`feat(nav-place): slice + NavPlaceLayout (consume AppShell, sidebar settings)`

---

## Sesión S6 — Settings page shell vacío + i18n del place + html lang dinámico + skip-link

### Objetivo

Wire-up: page `/settings/` que carga el place, renderea NavPlaceLayout, layout zona-place con `<html lang>` dinámico y skip-link.

### Pre-condiciones

- S3 + S5 mergeadas.

### Trabajo

1. **Crear `src/app/(app)/place/[placeSlug]/settings/page.tsx`** — guard sesión + loadPlaceBySlug + getTranslations({locale: place.defaultLocale}) + render `<NavPlaceLayout>` con children vacío (`<div>{t("language.title")} — Próximamente la implementación de la sección</div>` o placeholder calmo). `dynamic = "force-dynamic"` + `preferredRegion = "iad1"`.
2. **Modificar `src/app/(app)/place/[placeSlug]/layout.tsx`** — `<html lang={placeLocale}>` dinámico (loadPlaceBySlug en el layout también, o pasar via context — decisión empírica). Skip-link `<a href="#contenido" className="sr-only focus:not-sr-only">...</a>`.
3. **Modificar `src/i18n/messages/es.json`** — agregar namespace `placeSettings` (estructura definida en spec.md § "i18n keys").
4. **Modificar `src/i18n/messages/de.json`** — agregar namespace `placeSettings` (copia de es, stub).
5. **Modificar `src/i18n/messages/ca.json`** — idem.

(en/fr/pt.json se completan cuando se decida — sea en S6 si tienen el archivo, o en S2b/futuro. El deep-merge cubre faltantes.)

### Files

- **Crear**: `src/app/(app)/place/[placeSlug]/settings/page.tsx`.
- **Modificar**: `src/app/(app)/place/[placeSlug]/layout.tsx`, `src/i18n/messages/es.json`, `src/i18n/messages/de.json`, `src/i18n/messages/ca.json`.

### Verificación

- Smoke local: navegar a `{slug}.localhost:3000/settings` como owner → shell renderea en idioma del place; no-owner → notFound.
- `<html lang="de">` aparece si place está en alemán.
- Skip-link visible al tab.
- Build verde.

### Commit

`feat(settings): page shell + nav-place + html lang dinámico + skip-link`

---

## Sesión S7 — Sección "Idioma del place" + Server Action UPDATE

### Objetivo

Primera sección funcional: cambiar el `default_locale` del place desde el settings.

### Pre-condiciones

- S6 mergeada.

### Trabajo

1. **TDD: tests** en `src/features/place-settings/__tests__/locale-section.test.tsx` (Client Component + fake action):
   - Render con `currentLocale="es"` → select muestra "Español" seleccionado.
   - Submit con nuevo locale → invoca `updateAction({placeSlug, newLocale})` exactamente 1 vez.
   - Mock action retorna `{status: "ok"}` → muestra success notice.
   - Mock action retorna `{status: "error"}` → muestra error notice.
   - Pristine state → botón disabled. Dirty → habilitado.
2. **Crear `src/features/place-settings/ui/locale-section.tsx`** — Client Component con form + select + Server Action invocation.
3. **Crear `src/features/place-settings/actions/update-default-locale.ts`** — Server Action:
   - Input zod `{ placeSlug: string, newLocale: enum(6) }`.
   - `requireSessionJwt()` + `getAuthenticatedDb(token, executor => executor.unsafe("UPDATE place SET default_locale = $1 WHERE slug = $2", [newLocale, placeSlug]))`. RLS filtra a owner.
   - `revalidatePath(\`/place/\${placeSlug}/settings\`)`.
   - Return `{status: "ok"}` o `{status: "error"}`.
4. **Crear `src/features/place-settings/public.ts`** — exports.
5. **Modificar `src/app/(app)/place/[placeSlug]/settings/page.tsx`** — render `<LocaleSection currentLocale={place.defaultLocale} placeSlug={place.slug} updateAction={updateDefaultLocaleAction} labels={...} />` en lugar del placeholder.

### Files

- **Crear**: `src/features/place-settings/public.ts`, `src/features/place-settings/ui/locale-section.tsx`, `src/features/place-settings/actions/update-default-locale.ts`, `src/features/place-settings/__tests__/locale-section.test.tsx`.
- **Modificar**: `src/app/(app)/place/[placeSlug]/settings/page.tsx`.

### Verificación

- TDD verde.
- Suite total +6 tests (Client).
- Smoke prod end-to-end:
  - Owner cambia locale desde 'es' a 'de' → success.
  - Próxima carga del settings renderea en alemán.
  - Place sigue accesible (no se rompió).
- Seam-split documentado: Server Action no se testea con vitest; correctitud via typecheck + build + smoke prod.

### Commit

`feat(settings): sección "Idioma del place" + Server Action UPDATE (locale editable)`

### Push final

Tras commit de S7 verde-cerrado: **push con autorización explícita del user** en el turno (memoria `feedback_no_push_until_authorized`). Vercel deploy auto al push. Verificación via MCP del log de build + runtime.

---

## División en sesiones — justificación

- **12 sesiones, no 7-8**: el user pidió "sesiones cortas, manejables en ventana de contexto". 5 archivos por sesión es el sweet spot. Las 3 sesiones de docs (S0a/S0b/S0c) son baratas individualmente pero juntas cubren todo lo decisional canónico. S1.5 es micro-sesión (1-2 archivos) para verificación empírica, evita asumir.
- **Secuencial**: cada sesión depende de la anterior (S2a antes de S2b; S3 antes de S6; S4 antes de S5; etc.). No paralelizable.
- **Por qué S0a/S0b/S0c separadas y no S0 unitaria**: 11 archivos en una sesión gestionables pero menos manejables para el commit log y para el compact entre sesiones.
- **Por qué S2a/S2b separadas**: DB (migrations + schema + zod) es capa distinta de UI (wizard). Separación da rollback fino si una rompe.
- **Por qué S4 antes de S5**: AppShell agnóstico es la base; nav-place lo consume.
- **Por qué S6 antes de S7**: la page shell se prueba primero sin contenido funcional; cuando S6 cierra verde, S7 es agregado seguro.

## ADR vs spec

- **Spec** (`docs/features/settings/`) describe el comportamiento del settings.
- **ADR-0022** registra la decisión reusable "locale editable del place + scope V1 + single-owner".
- **ADR-0023** registra el refactor del shell agnóstico (decisión arquitectónica reusable).
- **ADR-0024** registra el fallback i18n runtime (decisión técnica reusable).
- Spec puede evolucionar; ADRs quedan como histórico.

## Authority push

Tras el commit de cada sesión: green-close local OK. **Push sólo con autorización explícita del user en el turno** (memoria `feedback_no_push_until_authorized`). Vercel deploy es auto al push y dispara `maybe-migrate.mjs` antes de `next build` — las migraciones de S2a se aplican automáticamente al primer push post-S2a (verificado por ADR-0017 §Cierre del Watch del 2026-05-20).
