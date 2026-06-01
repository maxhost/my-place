# Settings del place (`{slug}.place.community/settings`) — V1: shell mobile-first + idioma del place

> _Spec creado 2026-05-20. Última actualización 2026-05-21 — V1.1: refactor de IA del sidebar (4 grupos conceptuales + iconoir-react como librería canónica de iconos, ADR-0025)._ Status: **V1 implementado y deployed** (sesiones S0a–S7, commits `c3faba7` + `c20e842`). V1.1 en plan (5 sesiones: S0 docs · S1a/S1b refactor de `AppShell` agnóstico para grupos + iconos · S2 nav-place consume + iconoir · S3 i18n + cableo del page). Cierra los gaps que `multi-tenancy.md:14`, `architecture.md` (i18n hub-only) y la decisión "el wizard agrega un selector de idioma" dejaron pendientes. Primera implementación del **patrón i18n DB-based** del producto (locale como propiedad del place, no del path) en una zona del subdomain.

## Contexto

`{slug}.place.community/settings` es la **consola del owner** de un place: el único lugar donde el dueño puede configurar su lugar (idioma, miembros, apariencia, horario, billing, dominio custom — en sesiones futuras). V1 entrega (a) el **shell mobile-first** del settings (topbar + sidebar + zona central, espejado del Hub pero con su propia sidebar de secciones) y (b) la **primera sección funcional**: cambiar el idioma del place. La columna `place.default_locale` que se agrega en S2a es lo que toda la app (settings ahora, otras zones del place después) lee para renderear en el idioma elegido por el owner.

El settings es **owner-only**: la RLS `place_sel`/`place_upd` (owner-only desde ADR-0010, line 115 del schema) ya garantiza la barrera. Un miembro no-owner que intente acceder a `/settings` ve `notFound()` — la RLS filtra a 0 rows.

El producto dice "_un lugar, no una plataforma_" (`producto.md`). El settings sigue ese principio: nada grita, sin dashboards, sin métricas. **Un selector explícito** donde el owner cambia configuración.

## Alcance V1 (esta spec)

**Arquitectura del settings (mobile-first):**
- **Topbar** superior — logo placeholder + título de la sección actual ("Idioma del place" en V1) + (mobile) botón hamburger + menú de cuenta a la derecha (logout heredado del shell, ver §"Estructura").
- **Sidebar** lateral izquierda con **4 grupos conceptuales** (headers fijos no-colapsables — V1.1, ADR-0025) que agrupan **9 items** (V1: 1 sola sección activa, 8 "Próximamente" como afordancia del roadmap):
  - **Identidad** (cómo el place se ve y se nombra) — Apariencia · **Idioma** (única activa V1) · Dominio
  - **Estructura** (cómo el place se comporta) — Zonas (activar/desactivar Eventos + Biblioteca) · Horario
  - **Suscripción** (la relación owner ↔ producto Place, ADR-0003) — Billing
  - **Gestión** (administración interna) — Miembros · Grupos · Tiers
- Cada item lleva un icono de [iconoir-react](https://iconoir.com/) (librería canónica de iconos del producto, ADR-0025 — reemplaza emojis V1 originales).
- **Main content** — la sección activa ocupa el resto.
- **Mobile** (<768px): el sidebar colapsa a drawer; hamburger lo abre/cierra; main content full width; tap fuera del drawer lo cierra. Idéntico al patrón del Hub V1, **vía el shell agnóstico** `shared/ui/AppShell` extraído en S4.

**Sección "Idioma del place" (única funcional en V1):**
- Form con `<select>` de 6 idiomas (endonyms: "Español", "English", "Français", "Português", "Deutsch", "Català").
- Valor actual = `place.default_locale` cargado desde DB.
- Submit → Server Action `updateDefaultLocale` con zod enum validation → `UPDATE place SET default_locale = $1 WHERE slug = $2` (RLS filtra a owner) → `revalidatePath(/place/{slug}/settings)` → próxima carga renderea en el nuevo locale.
- Estado success calmo (sin toast intrusivo): "Idioma actualizado. La próxima carga aparecerá en {idioma}."
- Estado error calmo: "No pudimos guardar el idioma. Probá de nuevo." + el form se mantiene editable.

**i18n del place:**
- El locale aplica al **chrome del settings** (topbar + sidebar + sección). Es propiedad del place, no del path. URL canónica: `{slug}.place.community/settings` (sin `[locale]` en path — el locale viene de DB).
- `<html lang>` del layout zona-place se hace dinámico desde `place.default_locale` cargado vía `loadPlaceBySlug` (S3) — paridad a11y con marketing/hub.
- **Modo de resolución**: DB-based (a diferencia de marketing/hub que es path-based). Documentado canónicamente en `architecture.md` § "i18n: dos modos de resolución de locale" (post-S0b).
- **Fallback runtime**: si una key del namespace `placeSettings` no está traducida en `de.json` (período de traducción incremental), se cae al default `es.json` por key vía deep-merge (ADR-0024 post-S0b). UX nunca rompe por una key sin traducir.
- **6 locales operativos** desde S1: `es, en, fr, pt, de, ca`. Marketing y Hub también ganan los 6 — `routing.ts.locales` se expande.

**Auth + redirects:**
- **Acceso a `/settings`** chequea sesión PRIMERO. Si null → `redirect("https://place.community/{locale}/login?next=...")`. El `next` para que tras login regrese al settings, pero V1 simplificado: redirect simple al login (el user vuelve a navegar manualmente).
- **RLS owner-only es el guard real**: `loadPlaceBySlug(slug)` retorna `null` si (a) place no existe o (b) caller no es owner. Ambos casos → `notFound()`. Sin código de "verifyOwner" separado.

## Fuera de V1 (diferido a V2+)

- **Sección "Miembros"** — listar miembros, invitar, expulsar, transferir ownership. Cuando entre la spec de "miembros UI" del place.
- **Sección "Apariencia"** — paleta editable, logo del place, fuente. Cuando Storage TBD entre + se decida UX.
- **Sección "Horario"** — opening_hours (gate de actividad, `conversaciones.md`). Cuando se cablee el gate.
- **Sección "Billing"** — suscripción, plan, payment method. Cuando billing real entre (Stripe/equivalente TBD).
- ✓ **Sección "Dominio" — Implementada V1.1** (2026-05-21, `docs/features/custom-domain/`, ADR-0026 + ADR-0028). Registro + verificación lazy en page-load vía Vercel Domains API + lifecycle archived que libera dominios. Promovida a slice propio `src/features/custom-domain/` en S4 del plan (ADR-0028), no es sub-feature de `place-settings`. Host routing real (`mi-place.com → place`) y OIDC SSO desde custom domain quedan como features posteriores (B y C).
- **Sección "Zonas"** (V1.1) — activar/desactivar Eventos + Biblioteca (Discusiones es Core, no se toca, `ontologia/conversaciones.md`). Cuando se cablee el schema de zonas opcionales del place y la UI de activación.
- **Sección "Grupos"** (V1.1) — crear grupos de miembros con permisos granulares (e.g. "admin" como grupo). Roadmap, ADR-0002 §"grupo admin como feature futura".
- **Sección "Tiers"** (V1.1) — monetización de la comunidad (tiers pagados de membresía). Roadmap, ADR-0003 §"schema diferido".
- **Sección "Archivar / cerrar place"** — lifecycle (ADR-0003). Cuando se cablee el state machine de archivado.
- **Multi-owner concurrency** — V1 efectivamente single-owner (no hay UX para co-owner). Cuando entren co-owners se evalúa optimistic locking en el UPDATE.
- **Settings desde dominio custom** (`midominio.com/settings`) — V1 sólo subdomain. El routing por `place_domain` aplica automáticamente al `/settings` cuando custom domains entren; sin trabajo extra en V1.
- **Notificaciones de cambio de idioma a otros owners/miembros** — V1 nadie es notificado. Cuando haya notificaciones, se evalúa.

## Journeys

### A) Owner accede a settings desde el Hub

```
1. User logueado visita https://app.place.community/{locale}/.
2. Click "Configurar" en card del place que es de su ownership.
3. Nueva pestaña abre https://{slug}.place.community/settings.
4. Server-side: chequea sesión (cookie .place.community); chequea ownership via RLS (loadPlaceBySlug retorna null si no es owner → notFound).
5. Si OK: renderea shell + sección "Idioma del place" con valor actual.
6. Owner cambia el idioma → submit → success → próxima carga renderea en el nuevo locale.
```

### B) Owner accede a settings desde el place (futuro)

```
1. User logueado dentro del place visita https://{slug}.place.community/.
2. (UI del place V2+) Click en menú → "Configurar".
3. Misma pestaña navega a /settings.
4. Server-side: chequea ownership; renderea o notFound.
```

V1 sólo soporta entrada vía Hub (journey A). El menú interno del place (journey B) entra cuando la portada del place sea real.

### C) Miembro no-owner intenta acceder

```
1. Miembro visita https://{slug}.place.community/settings.
2. Server-side: sesión OK; loadPlaceBySlug retorna null (RLS filtra: no es owner) → notFound().
3. Renderea la página de Lugar no encontrado del place — sin pistas de "no tenés permiso" (no doxxea que /settings existe).
```

### D) Tercero (no logueado o no miembro)

```
1. Tercero visita https://{slug}.place.community/settings.
2. Server-side: sin sesión → redirect a login.
   O: sesión válida pero no owner → loadPlaceBySlug null → notFound().
```

## Estructura de routes

```
src/app/(app)/place/[placeSlug]/
├── layout.tsx                      # <html lang={placeLocale}> dinámico desde DB + skip-link a11y
├── page.tsx                        # portada del place (placeholder S7, sin cambios en este plan)
├── not-found.tsx                   # 404 owner/place no servible (sin cambios)
└── settings/
    └── page.tsx                    # Server Component: guard owner-only + renderea NavPlaceLayout + LocaleSection
```

**Cambios al `proxy.ts`**: ninguno. El proxy ya reescribe `{slug}.place.community/{path}` → `/place/{slug}/{path}` (multi-tenancy.md). `/settings` cae automáticamente.

**Layout zona place (`layout.tsx`)**: pasa de `<html lang="es">` hardcoded a `<html lang={placeLocale}>` cargado vía `loadPlaceBySlug` (S3). El placeholder de `/place/[slug]/page.tsx` actual no se toca en V1 (su texto sigue en español hardcoded; cuando se construya la portada real del place, migrará a usar el locale del place).

## Pantalla — comportamiento detallado

### Topbar (mobile-first)

**Desktop** (≥768px): logo izquierda + título "Configurar tu lugar" (centro/izquierda) + menú de cuenta derecha. Click avatar → dropdown calmo con "Cerrar sesión" (Server Action `logoutAction` reusado del slice `nav-hub` — sí, cross-slice import permitido vía `public.ts`).

**Mobile** (<768px): hamburger izquierda + título centrado + avatar derecha. Click hamburger → drawer del sidebar slide-in desde la izquierda con overlay semitransparente. Click overlay o swipe-left → cierra drawer.

El avatar muestra iniciales sobre cuadrado de color del producto (no del place — el settings usa la paleta del producto, no la del place). V1 sin storage de avatar real.

### Sidebar (mobile-first) — V1.1 agrupado (ADR-0025)

**Desktop**: ancho fijo ~240px, fondo `surface`. Estructurado en **4 grupos conceptuales** con headers de sección **fijos no-colapsables** (V1.1 — si en futuro el sidebar supera 12 items se evalúa colapsar). Cada grupo expone su lista vertical de items con icono + label. Item activo con fondo `accent-strong`; item disabled con `aria-disabled="true"` + tooltip "Próximamente".

**Mobile**: drawer overlay (no push), ancho ~280px, slide-in/out animation calma (200ms, `prefers-reduced-motion` respect). Misma estructura agrupada — los headers de los 4 grupos aparecen secuencialmente; no requieren tap (no son interactivos).

**Iconos**: librería canónica [iconoir-react](https://iconoir.com/) (ADR-0025). Tree-shake automático per-icon (no cargar el paquete completo). Un solo weight para consistencia visual con el ethos "calmo" de `producto.md`.

**Grupos e items V1.1** (9 items totales · 1 activa · 8 "Próximamente"):

#### Identidad (cómo el place se ve y se nombra)

| # | Item | i18n key | Iconoir candidate | Estado V1 |
|---|---|---|---|---|
| 1 | Apariencia | `placeSettings.sidebar.appearance` | `ColorPicker` o `DesignNib` | disabled (Próx.) |
| 2 | **Idioma** | `placeSettings.sidebar.language` | `Language` o `Translate` | **activa** |
| 3 | Dominio | `placeSettings.sidebar.domain` | `Internet` o `World` | disabled (Próx.) |

#### Estructura (cómo el place se comporta)

| # | Item | i18n key | Iconoir candidate | Estado V1 |
|---|---|---|---|---|
| 4 | Zonas | `placeSettings.sidebar.zones` | `ViewGrid` o `Apps` | disabled (Próx.) — NUEVO V1.1 |
| 5 | Horario | `placeSettings.sidebar.hours` | `Clock` | disabled (Próx.) |

#### Suscripción (relación owner ↔ producto Place, ADR-0003)

| # | Item | i18n key | Iconoir candidate | Estado V1 |
|---|---|---|---|---|
| 6 | Billing | `placeSettings.sidebar.billing` | `CreditCard` o `Wallet` | disabled (Próx.) |

#### Gestión (administración interna del place)

| # | Item | i18n key | Iconoir candidate | Estado V1 |
|---|---|---|---|---|
| 7 | Miembros | `placeSettings.sidebar.members` | `Group` | disabled (Próx.) |
| 8 | Grupos | `placeSettings.sidebar.groups` | `MultiplePages` o `Stack` | disabled (Próx.) — NUEVO V1.1 (Roadmap, ADR-0002) |
| 9 | Tiers | `placeSettings.sidebar.tiers` | `Layers` o `Star` | disabled (Próx.) — NUEVO V1.1 (Roadmap, ADR-0003) |

**i18n keys de headers de grupo** (V1.1):
- `placeSettings.sidebar.groupIdentity` → "Identidad"
- `placeSettings.sidebar.groupStructure` → "Estructura"
- `placeSettings.sidebar.groupSubscription` → "Suscripción"
- `placeSettings.sidebar.groupManagement` → "Gestión"

**Items disabled**: no clicables (no tap-target, no link); el badge "Próximamente" es la afordancia visual suficiente. Decisión cerrada V1.1 (consulta del 2026-05-21): se descartó la idea de un mini-modal "Próximamente" al click — ruido visual sin valor.

**Diseño visual**: Tailwind sólo layout/spacing; colores con tokens del producto (`bg-surface`, `text-ink`, `border-border`, `bg-accent-strong`, `text-muted`). NO clases de color hardcoded. Los headers de grupo usan un `text-xs uppercase tracking-wider text-muted` para diferenciarse visualmente de los items sin agregar peso.

### Sección "Idioma del place" (zona central)

**Header**: título de la sección + descripción corta calma.

> **Idioma del place**
> Es el idioma en el que se mostrará tu lugar a quienes lo visiten. Podés cambiarlo cuando quieras.

**Form**:
- `<label>` "Idioma" + `<select>` con 6 opciones (endonyms):
  - `es` → "Español"
  - `en` → "English"
  - `fr` → "Français"
  - `pt` → "Português"
  - `de` → "Deutsch"
  - `ca` → "Català"
- Valor default = `place.default_locale` cargado.
- Botón "Guardar" — primario calmo, full-width en mobile, inline en desktop.

**Estados:**
- **Pristine** (sin cambios): botón "Guardar" disabled.
- **Dirty** (cambió el select): botón habilitado.
- **Submitting**: botón muestra "Guardando…", select disabled.
- **Success**: aviso calmo "Idioma actualizado. La próxima carga aparecerá en {idioma}." + el form se resetea a pristine con el nuevo valor.
- **Error**: aviso calmo "No pudimos guardar el idioma. Probá de nuevo." + form sigue editable.

**Idempotencia**: ref + state, mismo patrón que el wizard y access-flow.

## Auth guard mechanism

El page del settings (`src/app/(app)/place/[placeSlug]/settings/page.tsx`) es Server Component. Pseudocódigo:

```ts
export default async function SettingsPage({ params }: { params: Promise<{ placeSlug: string }> }) {
  const { placeSlug } = await params;
  if (!isServiceableSlug(placeSlug)) notFound();

  // 1. Sesión obligatoria. Sin sesión → redirect al login del apex.
  const token = await getSessionJwt();
  if (!token) {
    redirect(`https://place.community/es/login`); // locale default; el login negocia su propio locale por cookie/Accept-Language
  }

  // 2. Carga del place vía RLS owner-only. Si caller no es owner → null → notFound.
  const place = await getAuthenticatedDb(token, (executor) =>
    loadPlaceBySlug(executor, placeSlug),
  );
  if (place === null) notFound();

  // 3. i18n del place: load messages para place.default_locale.
  //    `getTranslations({locale: place.defaultLocale, namespace: "placeSettings"})` —
  //    patrón empíricamente verificado en S1.5; ver docs/gotchas/i18n-locale-override-zona-place.md.
  const t = await getTranslations({ locale: place.defaultLocale, namespace: "placeSettings" });

  // 4. Render: shell del settings (topbar + sidebar) + sección activa.
  return (
    <NavPlaceLayout labels={...} placeSlug={placeSlug} activeSection="language">
      <LocaleSection
        labels={...}
        currentLocale={place.defaultLocale}
        placeSlug={placeSlug}
        updateAction={updateDefaultLocaleAction}
      />
    </NavPlaceLayout>
  );
}
```

**Helper `loadPlaceBySlug`** (S3): retorna `PlaceData | null`. Si `null`, RLS filtró (no es owner del place) o slug no existe. Caller no necesita distinguir — `notFound()` cubre ambos.

**Helper `getSessionJwt`** + **`getAuthenticatedDb`**: ya existen (S5b del Hub). Idénticos al patrón del Hub.

**`dynamic = "force-dynamic"`** + **`preferredRegion = "iad1"`**: el settings depende de cookie + DB; no SSG-cacheable. Co-location con Neon (consistente con Hub e `inbox/[locale]/page.tsx`).

## Modelo de datos + migraciones

**Nueva columna en `place`:**

```sql
ALTER TABLE place ADD COLUMN default_locale text NOT NULL DEFAULT 'es';
ALTER TABLE place ADD CONSTRAINT place_default_locale_check
  CHECK (default_locale IN ('es', 'en', 'fr', 'pt', 'de', 'ca'));
```

- `NOT NULL` con `DEFAULT 'es'` — places existentes pre-migration quedan en 'es' (consistente con el comportamiento actual del producto, que es 100% en español).
- `CHECK constraint` — invariante de dominio. Si en el futuro se agrega un locale, se actualiza el CHECK + `routing.ts.locales` + se agrega el JSON. Drift detectable empíricamente (UPDATE con un locale fuera del enum falla en DB).

**Migration 0007 — `app.create_place` backward-compatible:**

```sql
-- ADITIVA, no DROP + CREATE. Parámetro nuevo con DEFAULT.
-- Calls viejos (5 args, sin p_default_locale) siguen funcionando con DEFAULT 'es'.
-- Calls nuevos (6 args) usan el valor pasado.
-- Crítico durante rolling deploy de Vercel: la app vieja sirve HTTP hasta que el deploy
-- nuevo está READY; entre el `pnpm db:migrate` (inicio del build) y el deploy READY
-- (~30s), si la app vieja llama con 5 args, Postgres usa el DEFAULT y el place se crea
-- OK con locale 'es'. Cero usuarios huérfanos durante el deploy.
CREATE OR REPLACE FUNCTION app.create_place(
  p_slug text,
  p_name text,
  p_description text,
  p_theme_config jsonb,
  p_opening_hours jsonb,
  p_default_locale text DEFAULT 'es'
) RETURNS ... $$
  ...
  INSERT INTO place (slug, name, description, theme_config, opening_hours, default_locale, ...)
    VALUES (p_slug, p_name, p_description, p_theme_config, p_opening_hours, p_default_locale, ...);
  ...
$$;
```

El DEFAULT puede quedar a perpetuidad (es razonable como fallback). Si en algún momento se quiere forzar el param explícito, eso va en migración futura — no es necesario.

## RLS — sin cambios

`place_sel`/`place_upd`/`place_del` ya son owner-only desde ADR-0010 (schema línea 115-117). El settings hereda:
- **SELECT** (carga del place) → filtra a 0 rows si no es owner.
- **UPDATE** (cambiar `default_locale`) → falla si no es owner (RLS lo bloquea antes de tocar la fila).

Sin trabajo nuevo en RLS. La columna `default_locale` queda gobernada por las mismas policies que el resto de la fila.

## Slice arquitectura

**Slices nuevos**:

```
src/features/place/                       # slice del dominio "place como recurso" (S3)
├── public.ts
├── domain/
│   └── place-data.ts                     # type PlaceData { id, slug, name, defaultLocale, themeConfig, ... }
├── queries/
│   └── load-place-by-slug.ts             # loadPlaceBySlug(executor, slug) → PlaceData | null
└── __tests__/
    └── load-place-by-slug.test.ts        # contra DB real con inRlsTx

src/features/nav-place/                   # slice del shell del settings (S5)
├── public.ts
├── ui/
│   ├── nav-place-layout.tsx              # consume shared/ui/AppShell
│   └── nav-place-labels.ts               # interface NavPlaceLabels
└── __tests__/
    └── nav-place-layout.test.tsx

src/features/place-settings/              # slice de la primera sección (S7)
├── public.ts
├── ui/
│   ├── locale-section.tsx                # Client Component: form select + submit
│   └── locale-section-labels.ts          # interface
├── actions/
│   └── update-default-locale.ts          # Server Action: zod + UPDATE + revalidatePath
└── __tests__/
    └── locale-section.test.tsx           # fake updateAction
```

**Refactor a `shared/ui/app-shell`** (S4): extrae el shell mobile-first agnóstico (topbar + sidebar + drawer) que hoy vive embebido en `nav-hub-layout.tsx`. `nav-hub` queda como wrapper que consume `AppShell` con su sidebar de Hub. `nav-place` también consume `AppShell` con su sidebar de settings. Decisión canónica: **ADR-0023** (post-S0b).

**Dependencias acíclicas**:
- `place` → `shared/lib` (DB helpers).
- `nav-place` → `shared/ui/app-shell` + `nav-hub` (sólo para `logoutAction`).
- `place-settings` → `place` (loadPlaceBySlug) + `shared/lib` (DB).
- Route `(app)/place/[placeSlug]/settings/page.tsx` → `place/public.ts` + `nav-place/public.ts` + `place-settings/public.ts`.

## i18n keys

V1 agregó namespace `placeSettings` a los 6 JSONs (en S6 — `es` real + `de/ca` stubs · luego traducciones reales de los 6 locales en commit `c3faba7`). V1.1 (S3 del plan-sesiones del sidebar agrupado) extiende `placeSettings.sidebar` con **4 group labels** + **3 items nuevos** (Zonas, Grupos, Tiers). Estructura final en `es.json`:

```json
{
  "placeSettings": {
    "title": "Configurar tu lugar",
    "sidebar": {
      "groupIdentity": "Identidad",
      "groupStructure": "Estructura",
      "groupSubscription": "Suscripción",
      "groupManagement": "Gestión",

      "appearance": "Apariencia",
      "language": "Idioma",
      "domain": "Dominio",

      "zones": "Zonas",
      "hours": "Horario",

      "billing": "Billing",

      "members": "Miembros",
      "groups": "Grupos",
      "tiers": "Tiers",

      "comingSoon": "Próximamente"
    },
    "language": {
      "title": "Idioma del place",
      "description": "Es el idioma en el que se mostrará tu lugar a quienes lo visiten. Podés cambiarlo cuando quieras.",
      "label": "Idioma",
      "options": {
        "es": "Español",
        "en": "English",
        "fr": "Français",
        "pt": "Português",
        "de": "Deutsch",
        "ca": "Català"
      },
      "save": "Guardar",
      "saving": "Guardando…",
      "successTitle": "Idioma actualizado.",
      "successBody": "Tu lugar ahora aparece en {language}.",
      "errorNotice": "No pudimos guardar el idioma. Probá de nuevo."
    }
  }
}
```

Notas:
- **Labels cortos sin "del place"** — el sidebar ya está dentro del scope del place, redundancia eliminada. "Idioma" en lugar de "Idioma del place" (la sección activa sí mantiene "Idioma del place" en su h1 — ahí el contexto se entiende).
- **Renombrado V1.1**: "Dominio custom" → "Dominio" (`placeSettings.sidebar.domain`). El valor cambia, la key se mantiene.
- **Eliminado V1.1 (post copy-fix `c20e842`)**: `successBody` ahora dice "Tu lugar ahora aparece en {language}." — el cambio del locale se refleja inmediato en la UI gracias al refresh automático del Server Component que `revalidatePath` dispara post-Server Action; el copy viejo ("La próxima carga aparecerá…") sugería un mental model de "tenés que recargar" que no aplica.
- `successBody` con `{language}` placeholder (resuelto client con `.replace` desde `language.options[newLocale]`) — mismo patrón que `wizard.terms` y `inbox.cardMemberSince`.
- **Paridad ×6 locales** — `scripts/check-translations.mjs` garantiza 0 missing / 0 extras vs `es.json`. Las 7 keys nuevas de V1.1 (4 groups + 3 items) se agregan a los 6 locales en una sola sesión (S3) para preservar la paridad.

## Tests / TDD plan

Detalle en [`tests.md`](./tests.md). Resumen del scope V1:

- **Sin cambios de RLS**: las policies de `place` ya son owner-only. Sin tests nuevos de RLS.
- **`loadPlaceBySlug`** (S3): ~5 tests integration contra DB real (owner OK; no-owner null; slug inexistente null; archived_at NOT NULL filtrado; defensive case).
- **Wizard selector idioma** (S2b): ~6 tests del Paso 1 con las 6 opciones.
- **AppShell refactor** (S4): ~10 tests de regresión del Hub + ~5 tests nuevos del shell agnóstico.
- **NavPlaceLayout** (S5): ~6 tests del shell + sidebar.
- **LocaleSection** (S7): ~6 tests Client del form (vitest con fake action).
- **Server Action `updateDefaultLocale`** (S7): seam-split — NO se cubre con vitest (`next/headers` + Neon); typecheck + build + smoke prod.

**Total estimado: ~38 tests nuevos. Suite final: ~296 tests** (258 actuales + 38 nuevos).

## Mobile-first checklist

- Layout viewport responsive: 320px mínimo, breakpoint `md` (768px) cambia de drawer a sidebar fijo.
- Touch targets mínimo 44×44 px en mobile (botones, items del sidebar, select).
- `prefers-reduced-motion` respect: drawer slide-in usa transición reducida si está activo.
- Select del idioma: tap-friendly en mobile, options legibles.
- Sidebar drawer: cierre por tap-overlay + swipe-left + ESC key.
- Skip-link a `#contenido` (a11y, paridad con marketing/hub).

## Multi-tenancy update (S0b)

Agregar sección en `docs/multi-tenancy.md`:

```markdown
## Zona Place — Settings (`{slug}.place.community/settings`)

URL canónica: `https://{slug}.place.community/settings`. Path interno
(invisible): `/place/{slug}/settings`. Auth guard: cookie `.place.community`
+ RLS owner-only (`place_sel`). Si no es owner → notFound(). i18n del settings:
DB-based, no path-based — el locale viene de `place.default_locale` cargado
vía `loadPlaceBySlug`. `<html lang>` dinámico desde DB. Co-location iad1.
```

## Decisiones del producto cerradas

| # | Decisión | Origen |
|---|---|---|
| Q1 | `place.default_locale` aplica al chrome del settings + `<html lang>` dinámico (V1). El resto del chrome del place se migra por-zone cuando entra. | User §"todo listo para ir añadiendo traducciones" |
| Q2 | Locale editable desde settings (no inmutable como slug). | User §Q2 |
| Q3 | Selector en Paso 1 del wizard, default = locale del path activo. | User §Q3 |
| Q4 | Shell agnóstico en `shared/ui/AppShell`; nav-hub y nav-place lo consumen. | User §Q4 |
| Q5 | Fallback runtime deep-merge: keys sin traducir caen al default (es). | User §Q5 |
| Q6 | Los 6 locales son URL pública en marketing también. SSG×6. | User §Q6 |
| NEW | Settings owner-only via RLS (no guard separado en código). | Patrón canónico ADR-0010/0021 |
| NEW | Single-owner V1 (no multi-owner concurrency); race condition no aplica. | Schema actual: place_ownership permite múltiples pero no hay UX para co-owner |
| NEW | Migration `app.create_place` additive backward-compatible (DEFAULT param), no DROP+CREATE. | Audit del plan: evita downtime durante rolling deploy de Vercel |
| NEW | Skip-link a11y en layout zona place desde V1 (paridad con marketing/hub). | Audit del plan: gap a11y identificado |
| NEW | Settings reusa `logoutAction` del slice `nav-hub` vía `public.ts`. | Acíclico: feature→feature unidireccional, pattern ADR-0014/0015/0016 |

## Pointers

- **ADRs canónicas consumidas**:
  - [`../../decisions/0022-locale-del-place.md`](../../decisions/0022-locale-del-place.md) — `place.default_locale` editable desde settings (eje de la spec V1) + `<html lang>` dinámico DB-based.
  - [`../../decisions/0024-i18n-fallback-deep-merge.md`](../../decisions/0024-i18n-fallback-deep-merge.md) — fallback runtime deep-merge (keys sin traducir caen al default `es`).
  - [`../../decisions/0023-app-shell-agnostico-shared-ui.md`](../../decisions/0023-app-shell-agnostico-shared-ui.md) + [`../../decisions/0025-sidebar-agrupado-iconoir.md`](../../decisions/0025-sidebar-agrupado-iconoir.md) — AppShell agnóstico + sidebar agrupado (V1.1) que consume el slice de settings.
  - [`../../decisions/0010-rls-por-operacion-invitacion-token-link.md`](../../decisions/0010-rls-por-operacion-invitacion-token-link.md) — patrón RLS owner-only (`place_sel`): el guard de settings es RLS, no código separado.
  - [`../../decisions/0003-lifecycle-cuenta-place-tombstone.md`](../../decisions/0003-lifecycle-cuenta-place-tombstone.md) — sección "Suscripción" del sidebar (relación owner ↔ producto Place).
  - [`../../decisions/0026-custom-domain-v1-lazy-verification.md`](../../decisions/0026-custom-domain-v1-lazy-verification.md) — sub-vista `/settings/domain` (gestión de custom domain).
- **Multi-owner** (V1 schema permite N owners; UX de co-owner en gestión): [`../../decisions/0035-place-ownership-multi-owner-v1.md`](../../decisions/0035-place-ownership-multi-owner-v1.md).
- **Slice que implementa esta spec**: `src/features/place-settings/` (shell + sección idioma) — reusa `logoutAction` de `src/features/nav-hub/` vía su `public.ts`.
- **Schema base + invariantes del dominio**: [`../../data-model.md`](../../data-model.md) — invariante `place.default_locale` editable + CHECK de los 6 locales.
- **Routing multi-tenant** (zona place `{slug}.place.community/settings`): [`../../multi-tenancy.md`](../../multi-tenancy.md).
- **Plan de sesiones operativo**: [`./plan-sesiones.md`](./plan-sesiones.md).
- **Test checklist por sesión**: [`./tests.md`](./tests.md).
