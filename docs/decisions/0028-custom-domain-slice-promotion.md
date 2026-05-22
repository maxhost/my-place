# 0028 — Custom Domain: promoción a slice propio (`src/features/custom-domain/`) en S4 del plan V1

- **Fecha:** 2026-05-21
- **Estado:** Aceptada
- **Alcance:** organización del código (paradigma vertical-slice, `docs/architecture.md` §17-25) · slice `place-settings` (deja de ser host de la sub-feature Dominio) · slice nuevo `custom-domain` (autónomo, con su propio `public.ts`) · sin impacto en producto / runtime / DB
- **Habilita:** que `place-settings` cumpla el cap LOC ≤1500 (CLAUDE.md §Límites de tamaño) sin sacrificar documentación canónica de decisiones · que Features B (host routing) y C (OIDC SSO) tengan un slice consumidor claro sin depender de un slice cross-concern · que cuando entren las próximas sub-features del settings (Apariencia/Billing/Zonas/Grupos/Tiers/etc.) no carguen el peso histórico de Dominio
- **Refina:** la decisión de S0 del plan custom-domain V1 (`docs/features/custom-domain/plan-sesiones.md`) que asumía Dominio como "sub-feature de `place-settings`" — la asunción era razonable cuando se esperaban ~600 LOC; al cerrar S4 el sub-feature midió 1306 LOC productivos (3 UI + 3 actions + types) y empujó al slice anfitrión a 1731 LOC. Esta ADR NO supersede ADR-0026 — el contrato de comportamiento del custom domain V1 (lazy verification, partial unique, archived libera dominio, single-domain V1, `oauth_client_id` NULL, forward-compat `SECURITY DEFINER` para Feature B) sigue intacto.
- **No supersede:** ADR-0001 / ADR-0026 (las dos del feature) · ADR-0014 / ADR-0015 / ADR-0016 / ADR-0019 (precedentes de promoción/split de slices) · paradigma vertical-slice de `docs/architecture.md`.

Las ADR son registro histórico: no se editan, se reemplazan con una nueva ADR que la supersede.

> **Refinada parcialmente por [ADR-0030](0030-custom-domain-split-by-operation-layer.md) (2026-05-22):** la sección "Alternativas rechazadas → 4. Splittear `custom-domain` en sub-slices" se evaluó como over-engineering al cerrar S4 (2026-05-21). Al implementarse el fix ADR-0029 (chequeo dual V9 + V6) el slice midió 1553 LOC — sobre el cap 1500. ADR-0030 revisita esa alternativa con el nuevo contexto y decide dividir por capa de operación: `custom-domain` (commands + UI + types) y `custom-domain-verification` (lazy poll + helpers puros). El resto de las decisiones de esta ADR (promoción inicial fuera de `place-settings`, namespace i18n estable, forward-compat con Features B/C) sigue intacto.

## Contexto

El plan custom-domain V1 (`docs/features/custom-domain/plan-sesiones.md`) cerró en S0 (2026-05-21) la decisión de modelar el feature como "sub-feature `place-settings/domain` (UI + actions)" — la sección "Dominio" del settings sería el segundo módulo del slice `place-settings` después de "Idioma" (S7 settings, ADR-0022). La motivación fue que ambos comparten:

- El page route base `/settings/...` y el `<NavPlaceLayout>` shell.
- El i18n namespace `placeSettings.*` (`placeSettings.language.*` + `placeSettings.domain.*`).
- El concepto "configurar el place" desde la perspectiva del owner.

Esa lectura era correcta para un sub-feature pequeño. Al cerrar S4 (UI + page + i18n + sidebar) el sub-feature Dominio terminó con:

| Componente | LOC |
|---|---|
| `ui/domain-section.tsx` + `-pending.tsx` + `-archive.tsx` | 610 |
| `actions/register-custom-domain.ts` + `archive-...` + `get-...status.ts` | 543 |
| `types/custom-domain.ts` (con helper `mapPgErrorToActionError`) | 153 |
| Total sub-feature Dominio (sin tests) | **1306** |
| Sub-feature Idioma (sin tests) | 332 |
| `public.ts` transversal | 93 |
| **Total slice `place-settings` (sin tests)** | **1731** |

CLAUDE.md §"Límites de tamaño" cap el feature en **1500 LOC**: "Superar un límite = dividir antes de continuar". 1731 supera, **y la regla es estricta y producción-grade exige cumplirla** (ADR-0019 precedente: split de `place-wizard` por LOC; ADR-0014/0015/0016 precedentes de extracción de slices).

Además, evidencia adicional acumulada en S0-S3 que sugiere que Dominio es una **concern claramente independiente**, no una sub-feature secundaria:

1. **ADR propia**: ADR-0026 (lazy verification + partial unique + lifecycle archived). Ningún otro sub-feature potencial del settings tendrá una ADR de esa magnitud (Apariencia es config visual, Billing es Stripe integration, Zonas es schema delta).
2. **Spec propio**: `docs/features/custom-domain/spec.md` (275 líneas) + `plan-sesiones.md` + `tests.md`. Otros sub-features comparten un spec `docs/features/settings/spec.md`.
3. **Migration propia**: `0008_place_domain_partial_unique.sql`. Otros sub-features comparten migrations (o reusan).
4. **Integración externa propia**: Vercel Domains API wrapper (`src/shared/lib/vercel/`, 200+ LOC + tests). Idioma no requiere integración externa.
5. **Features B y C dependen de custom-domain, NO de place-settings**: Feature B (host routing edge) consumirá `place_domain` directo desde Postgres con `SECURITY DEFINER`; Feature C (OIDC SSO + callback) tocará `oauth_client_id` y el callback handler de Better Auth — ninguno toca el slice settings. Si Dominio queda dentro de `place-settings`, Features B y C importarían un slice "settings" para ejercer su feature de "host routing / SSO", lo cual es semánticamente ruidoso.
6. **Cohesión interna alta del sub-feature**: los 3 actions + types + 3 UI components forman una unidad cerrada que no toca código de Idioma. El único punto de contacto era el `public.ts` compartido.

Frente a esto, las opciones realistas al cerrar S4 eran:

1. **Aceptar la excepción** con ADR explícita: "el cap 1500 es guía; el slice integra 2 sub-features cohesivas, todos los archivos ≤300 y todas las funciones ≤60, se splittea cuando entre la 3ra sub-feature". Pro: avanza S4 sin refactor. Contra: precedente para futuras violaciones del cap; ignora la evidencia (ADR + spec + features futuras dependen de Dominio, no de settings).
2. **Comprimir docstrings agresivamente** (~80 LOC menos). Pro: cero refactor estructural. Contra: queda en ~1650 — sigue sobre cap; sacrifica documentación canónica de decisiones; aplica una vez y no resuelve para el growth futuro.
3. **Promover Dominio a slice propio** (`src/features/custom-domain/`). Pro: respeta cap estricto; alinea el grafo de dependencias con la realidad de Features B/C; precedente de ADR-0014/0015/0016/0019 ya establecido. Contra: ~20min de refactor mecánico (git mv + actualizar imports en 2 archivos consumers + crear `public.ts` propio).

El user (2026-05-21, al cerrar S4) eligió (3). Esta ADR registra la decisión + sus consecuencias.

## Decisión

**Promovemos `custom-domain` a slice propio en `src/features/custom-domain/`**, autónomo del slice anfitrión `place-settings`. La promoción es **mecánica** (movimiento de archivos + reescritura del `public.ts`); el comportamiento del feature, el contrato de UX, la SoT en `place_domain`, la integración con Vercel, las decisiones de ADR-0026, y las migrations NO cambian.

**Estructura final del slice `custom-domain/`:**

```
src/features/custom-domain/
  public.ts                              ← interfaz pública (DomainSection, 3 actions, types)
  ui/
    domain-section.tsx                   ← entry-point: DomainSection + Labels + NoneState
    domain-section-pending.tsx           ← PendingState + DnsRecordsTable + AutoRefresh
    domain-section-archive.tsx           ← VerifiedState + ArchiveTrigger + ConfirmDialog
  actions/
    register-custom-domain.ts            ← Server Action
    archive-custom-domain.ts             ← Server Action
    get-custom-domain-status.ts          ← helper-server (NO "use server")
  types/
    custom-domain.ts                     ← types + mapPgErrorToActionError pure helper
    __tests__/custom-domain.test.ts      ← 8 tests del helper puro
  __tests__/
    domain-section.test.tsx              ← 9 tests RTL (render + submit + validación)
    domain-section-interactions.test.tsx ← 6 tests RTL (confirm/copy/refresh/idempotencia)
    _domain-section-helpers.tsx          ← LABELS + setup() compartidos por los 2 tests
```

**Estructura final del slice `place-settings/` (post-promoción):**

```
src/features/place-settings/
  public.ts                              ← LocaleSection + updateDefaultLocaleAction
  ui/locale-section.tsx                  ← Client Component (V1 Idioma)
  actions/update-default-locale.ts       ← Server Action (V1 Idioma)
  __tests__/locale-section.test.tsx      ← 8 tests RTL
```

**LOC post-promoción (sin tests):**

| Slice | LOC | Cap CLAUDE.md | Estado |
|---|---|---|---|
| `custom-domain` | 1306 | 1500 | ✓ holgado para V1.1 (cron safety-net opcional, ~100 LOC más) |
| `place-settings` | 425 | 1500 | ✓ holgado para próximas sub-features (Apariencia/Billing/Zonas/etc.) |

## Cambios concretos en S4 (parte mecánica)

1. **Archivos movidos** (11): los 3 UI + 3 actions + types + types/test + 3 UI tests + helpers (`git mv` para los 5 tracked desde S3, `mv` para los 6 que aún estaban untracked en S4).
2. **`src/features/custom-domain/public.ts`** (nuevo): re-exporta `DomainSection` + `DomainSectionLabels` + 3 actions + tipos del slice. Header doc apunta a ADR-0026 + ADR-0028 + `docs/features/custom-domain/spec.md`.
3. **`src/features/place-settings/public.ts`** (modificado): se quitaron los exports de custom-domain; header doc actualizado con pointer a `@/features/custom-domain/public` para consumers que necesiten la sección Dominio.
4. **`src/app/(app)/place/[placeSlug]/settings/domain/page.tsx`** (modificado): el import de los 5 símbolos (`registerCustomDomainAction`, `archiveCustomDomainAction`, `getCustomDomainStatus`, `DomainSection`, `DomainSectionLabels`) pasó de `@/features/place-settings/public` a `@/features/custom-domain/public`. Ninguna otra línea cambió.
5. **`docs/features/custom-domain/spec.md`** (modificado): actualización de pointers de paths internos (paths `src/features/place-settings/...` → `src/features/custom-domain/...` en las menciones explícitas).
6. **`docs/decisions/README.md`** (modificado): entrada de ADR-0028.

**Cero cambios** en: schema, migrations, RLS, Server Actions (sólo se movieron de carpeta), wrappers Vercel, i18n (las keys siguen siendo `placeSettings.domain.*` — el namespace i18n se mantiene porque la SoT del wording es la sección del settings desde la perspectiva del user, no la organización física de los archivos).

## Decisión deliberada: el i18n namespace **NO** se renombra

Los ~33 keys del bloque `placeSettings.domain.*` × 6 locales siguen en `placeSettings.*` aunque el slice consumidor ya no sea `place-settings`. Razones:

1. **El user ve "Configurar tu lugar → Dominio"**: el namespace i18n refleja la jerarquía de UX, no la organización de código. El page del settings es la única superficie del feature V1; el namespace debe espejar esa ubicación.
2. **Future Feature B (host routing) y C (OIDC) NO tienen UI propia bajo el namespace `customDomain.*`**: la única UI del custom-domain es y va a seguir siendo la sección del settings. Crear un namespace `customDomain.*` aislado sería sobre-engineering.
3. **Migration cero**: renombrar el namespace requeriría modificar 6 JSONs + el page + el `getTranslations({namespace})` por nada — el feature funciona idéntico con `placeSettings.domain.*`.

## Consecuencias

### Inmediatas (al cerrar S4 con esta ADR)

- El slice `place-settings` queda holgado bajo el cap (425 LOC); las próximas sub-features (Apariencia/Billing/Zonas/Grupos/Tiers) tienen ~1000 LOC de presupuesto antes de necesitar promoción.
- El slice `custom-domain` queda autónomo: `public.ts` mínima, ADR propia, spec propia, migrations propias, integración externa (Vercel) encapsulada en `shared/lib/vercel/`.
- El grafo de dependencias queda más limpio: page consumer importa de DOS slices (`place-settings` para Idioma, `custom-domain` para Dominio) en lugar de UNO mezclado.

### Forward-compat con Features B y C

- **Feature B** (host routing edge `mi-place.com → place`): consumirá un helper futuro `src/shared/lib/host-routing-by-domain.ts` que llame a la función Postgres `app.lookup_place_by_domain(host)` con `SECURITY DEFINER` (ADR-0026 §"Forward-compat Feature B"). Cero hooks en el slice `custom-domain`; el slice es product-surface, no edge-routing. Feature B vive en `src/shared/lib/` + `src/middleware.ts`.
- **Feature C** (OIDC SSO + callback handler): el callback handler vivirá en `src/app/api/auth/callback/custom-domain/route.ts` y consumirá el slice `custom-domain` (por ejemplo, `getCustomDomainStatus` para validar que la fila esté verified). El provisioning de `oauth_client_id` será un script en `scripts/` (idempotente, retroactivo, ADR-0027 cuando se redacte). El slice `custom-domain` NO se modifica para Feature C — sólo se consume.

### Política a futuro

- **El cap LOC ≤1500 por feature se respeta estrictamente.** Si un slice supera el cap, se decide promoción/split antes del commit final del feature, con ADR registrando la decisión (precedentes: 0014, 0015, 0016, 0019, 0028).
- **El criterio de promoción** combina: (a) supera el cap LOC, (b) tiene ADR / spec / migration / integración externa propias, (c) features futuras consumen el sub-feature directamente, no el slice anfitrión. La regla LOC sola no fuerza promoción si los criterios (b) y (c) no aplican; pero supera el cap fuerza al menos una decisión documentada.
- **Cuándo NO promover** (lección de S0): si un sub-feature potencial NO tiene ADR/spec/migration propias y NO es consumido por features futuras (caso típico: una sección de settings sin cross-cutting), se mantiene como sub-folder del slice anfitrión hasta que aparezca una de esas señales.

## Alternativas rechazadas

### 1. Aceptar la excepción y documentar como "cap suave"

Discutida y descartada porque:

- ADR + spec + migration + integración externa propias de Dominio son evidencia objetiva de slice-worthiness; ignorar esto es ignorar el paradigma vertical-slice de `docs/architecture.md`.
- Sienta precedente para futuras violaciones del cap basadas en "el slice es cohesivo aunque sea grande" — argumento que aplicaría a casi cualquier feature.
- ADR-0019 ya cerró el precedente opuesto (`place-wizard` se splittió cuando superó 1500), creando inconsistencia entre slices.

### 2. Comprimir docstrings densos hasta caer bajo el cap

Discutida y descartada porque:

- Sacrifica documentación canónica de decisiones (CLAUDE.md §"Documentación primero": "se documenta antes de codear comportamiento esperado").
- 80 LOC de comprimir + reorganizar dejaría el slice en ~1650 — sigue sobre cap.
- No resuelve para el growth futuro (S6 cron safety-net agregaría ~100 LOC más, llevando el slice a ~1750).

### 3. Sub-folders internos `place-settings/{language,domain}/`

Discutida y descartada porque:

- NO reduce LOC total del slice — la regla del cap es por slice, no por sub-folder.
- Agrega complejidad de navegación sin valor (un slice no es una carpeta padre con sub-features; un slice es **un grafo cerrado de archivos con un `public.ts`**).

### 4. Splittear de forma más agresiva (e.g. `vercel-domains-integration` como slice aparte)

Discutida y descartada porque:

- El wrapper Vercel (`src/shared/lib/vercel/`) ya vive en `shared/` (alineado a su naturaleza de infraestructura compartida); no es slice-material.
- Splittear `custom-domain` en sub-slices (e.g. `domain-registration` + `domain-verification` + `domain-archive`) sería over-engineering: el grafo de archivos es cohesivo, comparten types y UI states, y la unidad conceptual "custom domain del place" es atómica desde la perspectiva del owner.

## Implementación de la promoción (referencia)

Pasos secuenciales que aplica esta ADR (todos cerrados al cerrar S4):

1. `mkdir -p src/features/custom-domain/{ui,actions,types/__tests__,__tests__}` (4 subdirs).
2. `git mv` × 5 archivos tracked desde S3 (3 actions + types + types/test).
3. `mv` × 6 archivos untracked desde S4 (3 UI + 3 tests/helpers).
4. `rmdir src/features/place-settings/types/__tests__ src/features/place-settings/types` (limpieza de dirs vacíos).
5. Crear `src/features/custom-domain/public.ts` (nueva interfaz pública).
6. Update `src/features/place-settings/public.ts` (quita los re-exports del custom-domain, agrega pointer al slice nuevo).
7. Update `src/app/(app)/place/[placeSlug]/settings/domain/page.tsx` (un solo import: `@/features/place-settings/public` → `@/features/custom-domain/public`).
8. Update pointers de paths en `docs/features/custom-domain/spec.md`.
9. Crear esta ADR (`docs/decisions/0028-custom-domain-slice-promotion.md`).
10. Update `docs/decisions/README.md` (entrada nueva).
11. Green-close: `pnpm typecheck` clean · `pnpm lint` 0 problemas · `pnpm test src/features/custom-domain/ src/features/place-settings/` verde (31/31: 8 mapPgErrorToActionError + 9 domain-section + 6 domain-section-interactions + 8 locale-section) · `pnpm build` verde.

**Cero impacto runtime**: el page Server Component renderea exactamente el mismo HTML; el sidebar item navega a la misma URL `/settings/domain`; los actions invocan los mismos endpoints Vercel + las mismas queries SQL; los tests aplican las mismas assertions.

## Pointers

- **Paradigma vertical-slice**: `docs/architecture.md` §17-25.
- **Cap LOC**: `CLAUDE.md` §"Límites de tamaño".
- **Precedentes de promoción/split**: ADR-0014 (split `onboarding` → `place-creation` + `access`), ADR-0015 (extraer `style-assist`), ADR-0016 (extraer `place-wizard`), ADR-0019 (`style-assist` también dueño de UI glue + LOC ≥1500 de `place-wizard`).
- **Feature canónico**: `docs/features/custom-domain/spec.md` + ADR-0026.
- **Slice anfitrión post-promoción**: `src/features/place-settings/` (sólo Idioma V1; recibe nuevas sub-features según evidencia).
