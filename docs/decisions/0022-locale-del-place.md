# 0022 — Locale propio del place: `place.default_locale` editable + 6 locales operativos en toda la app

- **Fecha:** 2026-05-20
- **Estado:** Aceptada
- **Alcance:** producto (locale como propiedad del place, no del path) · arquitectura (i18n dos modos: path-based marketing/hub vs DB-based zona place) · data-model (nueva columna `place.default_locale` + CHECK constraint) · UI/UX (settings como primer caso de uso de edición) · migraciones (additive backward-compatible)
- **Cierra:** la promesa pendiente de `multi-tenancy.md:14` ("`{slug}.place.community/settings` solo owner") con un V1 funcional. Habilita la feature settings.
- **Habilita:** `docs/features/settings/spec.md` (V1).
- **Relación:** depende de ADR-0010 (RLS owner-only sigue siendo el guard, sin trabajo nuevo) · depende de ADR-0012 (migration via función definer) · usa la pipeline de ADR-0017 (deploy corre migrations) · refina implícitamente la decisión de `landing/README.md:15` ("ES day-one; EN/FR/PT después" → ahora "6 locales operativos día uno con stubs + fallback runtime").

Las ADR son registro histórico: no se editan, se reemplazan con una nueva ADR que la supersede.

## Contexto

Hasta este punto, el producto soportaba 4 locales en `routing.ts.locales` (`es, en, fr, pt`), con solo `es.json` poblado físicamente. El `<html lang>` de la zona place era hardcoded `es` (verificado en `src/app/(app)/place/[placeSlug]/layout.tsx:13`), y no había noción de "idioma del place" — los lugares vivían en español implícito.

El user quiere construir `/settings` owner-only de un place y, como primer caso de uso de edición, **cambiar el idioma del place**. La decisión es ambiciosa: no construir solo la mecánica del settings, sino dejar la infraestructura i18n production-grade lista para que las traducciones se vayan incorporando incrementalmente sin romper la UX. Esto exige:

- Una **columna del place** para almacenar su locale (`place.default_locale`).
- Soporte de **6 locales** en toda la app (agregar `de` y `ca` a los existentes).
- Un **modo de resolución del locale** distinto al de marketing/hub: ahí el locale viene del path (`/es/`, `/de/`), pero en la zona place el locale es propiedad del place (no del path) y se carga de DB.
- Un **fallback runtime** que evite romper la UX cuando una key todavía no esté traducida en un locale (período de traducción incremental).
- Una **estrategia de migración additive backward-compatible** para `app.create_place` que evite el equivalente del incidente del 2026-05-20 (DROP+CREATE de función mientras el rolling deploy aún sirve la versión vieja).

Esta ADR cierra las decisiones de producto/dominio. Las decisiones técnicas (deep-merge del fallback, shell agnóstico) se documentan en ADRs separadas (ADR-0023 app-shell, ADR-0024 fallback i18n) para no sobrecargar esta.

## Decisión

1. **Agregar columna `place.default_locale text NOT NULL DEFAULT 'es'` + CHECK constraint** que la limita a los 6 locales operativos (`es, en, fr, pt, de, ca`).

   - **NOT NULL con DEFAULT 'es'**: places existentes pre-migration heredan `'es'` (coherente con su estado actual: el producto vive en español hoy).
   - **CHECK constraint**: invariante de dominio. Si en el futuro se agrega un locale, se actualiza el CHECK + `routing.ts.locales` + JSON.

2. **El locale del place es editable** desde `/settings` (no inmutable como el slug). Razón: el slug es inmutable porque aparece en URLs compartidas, invites y referencias externas (cambio rompe links); el locale **no** aparece en URL del place (la URL es `{slug}.place.community/...` sin `[locale]`), por lo que es una elección de presentación que el owner puede corregir cuando quiera. V1 es single-owner por place (no hay UX para co-owner) → race condition multi-owner no aplica.

3. **Los 6 locales son URL pública también en marketing y Hub**. `routing.ts.locales` pasa de 4 a 6. La landing se pre-renderea SSG×6 (mismo build pattern, ~10s más de tiempo, sub-200ms en CDN). El Hub responde los 6 paths. **Sin asimetría**: el producto soporta los 6 idiomas top-to-bottom.

4. **El locale del place se aplica al chrome del settings** en V1 (sección "Idioma del place" funcional + sidebar + topbar). El `<html lang>` del layout de la zona place se hace dinámico desde `place.default_locale`. El resto del chrome del place (placeholder de `page.tsx`) se migra cuando cada zone se construya (Discusiones, Eventos, etc.) — coherente con el patrón vertical-slice del repo.

5. **Migration `app.create_place` es ADITIVA backward-compatible** (NO DROP+CREATE). Pseudocódigo:

   ```sql
   CREATE OR REPLACE FUNCTION app.create_place(
     p_slug text,
     p_name text,
     p_description text,
     p_theme_config jsonb,
     p_opening_hours jsonb,
     p_default_locale text DEFAULT 'es'
   ) RETURNS ... $$
     ...
     INSERT INTO place (..., default_locale) VALUES (..., p_default_locale);
     ...
   $$;
   ```

   Calls viejos (5 args) siguen funcionando con `DEFAULT 'es'`. Calls nuevos (6 args) pasan el valor. **Crítico durante rolling deploy de Vercel**: la app vieja sirve HTTP hasta que el deploy nuevo está READY (~30s); en ese intervalo, si se llama con 5 args, Postgres usa el DEFAULT y el place se crea OK. Cero usuarios huérfanos durante deploy — exactamente lo que faltó en el incidente del 2026-05-20 con `get_inbox_payload` (donde el código adelantado del schema rompió el Hub).

6. **El selector de idioma en el wizard place-first está en Paso 1** (Identidad), default = locale del path activo. Segmented control con 6 opciones (endonyms: "Español", "English", "Français", "Português", "Deutsch", "Català"). UX descubrible sin sumar paso ni fricción al onboarding.

7. **RLS del settings es owner-only via las policies existentes** (`place_sel` y `place_upd` de ADR-0010). No hay trabajo nuevo en RLS. Member no-owner que intente acceder a `/settings` recibe `notFound()` porque `loadPlaceBySlug` retorna `null` (RLS filtró). El settings NO usa el patrón member-read de ADR-0021.

## Alternativas rechazadas

- **Locale inmutable como el slug.** Rechazada porque el slug es inmutable por razones externas (URLs compartidas, invites, integraciones) — el locale no tiene esas razones. Forzar inmutabilidad obligaría a contactar soporte para corregir un click equivocado al crear. Production-grade exige permitir la corrección.

- **Locale aplica solo a settings; el resto del place sigue hardcoded `es`.** Rechazada porque rompe accesibilidad de día uno: `<html lang="es">` en una página con texto en alemán falla axe. La decisión final extiende el `<html lang>` dinámico desde V1 (mínimo overhead, máxima paridad a11y).

- **Locale aplica a TODO el chrome del place desde V1.** Rechazada en V1 porque exige migrar el placeholder de `page.tsx` (3 strings hardcoded) y resolver el patrón i18n DB-based en una zone que todavía es placeholder. La decisión final delega esa migración al momento en que cada zone se construya (vertical-slice).

- **Marketing solo en 4 locales (`es/en/fr/pt`), `de` y `ca` exclusivos del place.** Rechazada por asimetría: el producto que ofrece crear places en alemán no puede mostrar su landing en alemán. Mala UX.

- **Sin fallback runtime; build falla si una key falta en algún locale.** Rechazada porque obliga a tener los 6 locales 100% traducidos antes de cualquier deploy. Bloquea la iteración. La decisión final (ADR-0024) es fallback runtime + check-translations informativo en CI.

- **Migration `DROP FUNCTION app.create_place(...) + CREATE FUNCTION ... (signature nueva)`.** Rechazada porque entre el `pnpm db:migrate` (inicio del build) y el deploy nuevo READY (~30s), si la app vieja llama con 5 args, Postgres responde `42883 function does not exist`. Es exactamente el incidente del 2026-05-20 multiplicado por cada user que cree un place durante el rolling deploy. La decisión final es additive backward-compatible (DEFAULT param en lugar de cambiar signature).

- **Selector de idioma en paso aparte del wizard (4-5 pasos).** Rechazada por fricción. Default = locale del path elimina la necesidad de un paso explícito en el 95% de los casos.

- **Selector de idioma pre-paso (paso 0) antes de Identidad.** Rechazada por rompe el flujo cognitivo del owner (la primera decisión es el nombre del lugar).

## Consecuencias

- **Migration `0006_place_default_locale.sql`** (S2a) agrega la columna + CHECK. Idempotente via `DO $$ IF NOT EXISTS ... END $$`. Places existentes heredan `'es'`.

- **Migration `0007_create_place_fn_with_locale.sql`** (S2a) actualiza `app.create_place` aditivamente. Sin downtime durante rolling deploy.

- **Schema TS** (`src/db/schema/index.ts`) agrega `defaultLocale: text("default_locale").notNull().default("es")` a `place`. Zod input agrega `defaultLocale: z.enum([...6]).default("es")`. Wizard payload incluye el locale al crear.

- **`routing.ts.locales`** pasa a `["es", "en", "fr", "pt", "de", "ca"]`. SSG genera 6 versiones de marketing/hub.

- **JSONs `de.json` y `ca.json`** se crean como stubs (copia de `es.json`) en S1. `en.json`, `fr.json`, `pt.json` se crean o completan según estado actual. Las traducciones reales se incorporan incrementalmente fuera del scope del feature settings — el deep-merge runtime cubre las keys faltantes con el default (ADR-0024).

- **`docs/features/settings/`** ahora tiene `spec.md`, `plan-sesiones.md`, `tests.md`. Implementación 12 sesiones.

- **`docs/multi-tenancy.md`** agrega sección "Zona Place — Settings" (S0b).

- **`docs/architecture.md`** agrega § "i18n: dos modos de resolución de locale" (S0b).

- **`docs/producto.md`** agrega principio "Cada place habla un idioma único" (S0c).

- **Performance**: SSG×6 en marketing aumenta build time ~5-10s. Aceptable. Bundle cliente sin impacto (next-intl solo envía el locale activo). Settings TTFB <300ms (Server Component + 1 DB query + i18n load).

- **Seguridad**: RLS owner-only ya cubría. Sin nueva superficie. El `UPDATE place SET default_locale = ?` es bloqueado por `place_upd` si el caller no es owner — fail-closed por construcción.

- **Migración data**: places existentes en prod (1 al momento del corte, "the-company") quedan en `default_locale = 'es'` post-S2a. El owner puede cambiarlo desde settings cuando S7 esté en producción.

- **Test coverage**: ~46 tests nuevos esperados (deep-merge, loadPlaceBySlug, wizard selector, AppShell, NavPlaceLayout, LocaleSection). Server Actions del settings via seam-split (smoke prod, no vitest) — patrón canónico del repo.

- **Rollback strategy**: cada sesión commit-cerrable independientemente. Si S7 falla en prod, revertir solo S7 — la columna `default_locale` queda en DB sin user-facing impact (campos opcionales del schema con default no rompen nada). S2a (migration) es additive, no rollback-able sin DROP — pero el DEFAULT 'es' la hace inocua. En el peor caso, `ALTER TABLE place DROP COLUMN default_locale` en migration futura.

- **Pendiente post-V1 (no en este plan)**:
  - Multi-owner concurrency (si emerge UX para co-owners).
  - Migración del chrome del place a `place.default_locale` por zone-por-zone cuando cada zone se construya (Discusiones, Eventos, etc.).
  - Settings desde dominio custom (`midominio.com/settings`) — forward-compat con `place_domain` resolver, sin trabajo extra cuando custom domains entren.
  - Traducciones reales en los 6 locales (operación de producto, no de código).

## Detalle operativo canónico

- Spec del feature: `docs/features/settings/spec.md`.
- Plan de sesiones: `docs/features/settings/plan-sesiones.md`.
- Tests strategy: `docs/features/settings/tests.md`.
- ADRs relacionadas:
  - ADR-0023 (post-S0b): refactor del shell agnóstico a `shared/ui/app-shell`.
  - ADR-0024 (post-S0b): deep-merge fallback runtime + check-translations informativo.
- Pipeline de migration en deploy: ADR-0017 §Cierre del Watch (`scripts/maybe-migrate.mjs` aplica las migrations 0006+0007 al primer push post-S2a).
- RLS guard: ADR-0010 (sin cambios, las policies existentes cubren).

## Notas

- Esta ADR queda como referencia canónica para futuras decisiones sobre i18n de scope-por-recurso (no solo place; e.g. si en el futuro hay "Discusiones" con su propio locale, el patrón se reusa: columna en la entidad + DB-based resolution + edición en su settings).
- Si surge la necesidad de un 7º locale, los pasos son: (1) actualizar CHECK constraint via migration, (2) agregar a `routing.ts.locales`, (3) agregar JSON, (4) agregar al enum zod y al endonym map en `place-settings`. No requiere ADR nuevo — es operación de extensión del enum.
