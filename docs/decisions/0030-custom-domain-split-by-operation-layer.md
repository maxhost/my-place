# 0030 — Custom Domain: split del slice por capa de operación (commands vs lazy poll) cuando el cap LOC se supera

- **Fecha:** 2026-05-22
- **Estado:** Aceptada
- **Alcance:** organización del código (paradigma vertical-slice, `docs/architecture.md` §17-25) · slice `custom-domain` (cede el lazy poll y los helpers V6) · slice nuevo `custom-domain-verification` (autónomo, con su propio `public.ts`) · sin impacto en producto / runtime / DB / contrato de UX
- **Habilita:** que el slice `custom-domain` cumpla el cap LOC ≤1500 (CLAUDE.md §"Límites de tamaño") después de absorber la nueva lógica del fix ADR-0029 (chequeo dual V9 + V6 + helpers puros del flow) · que el grafo de dependencias siga reflejando la realidad del feature post-ADR-0029: comandos del owner (register/archive) vs consulta de estado (lazy poll dual + decisión pura) son capas técnicas distintas con dueños y ritmos de evolución distintos · que Features B (host routing edge) y C (OIDC SSO) consuman el lazy poll directamente sin arrastrar la UI del settings
- **Refina parcialmente:** ADR-0028 §"Alternativas rechazadas" #4 ("Splittear `custom-domain` en sub-slices sería over-engineering"). Al cerrarse S4 (2026-05-21) la sub-división se descartó porque el slice estaba en 1306 LOC con margen de 194 sobre el cap, y los helpers V6 todavía no existían. Al implementarse ADR-0029 (S2 del fix verified-false-positive, 2026-05-22) la lógica nueva — wrapper V6 + 3 helpers puros + reescritura del lazy poll + chequeo dual en register — sumó ~290 LOC reales al slice, dejándolo en 1553 LOC. La compactación agresiva de comentarios redujo a 1553 pero NO debajo del cap. El contexto cambió: lo que era "over-engineering" al cerrar S4 pasó a ser la opción menos invasiva para respetar el cap.
- **No supersede:** ADR-0026 (contrato de comportamiento del feature V1) · ADR-0028 (promoción inicial fuera de `place-settings`, namespace i18n estable, forward-compat Features B/C — todas intactas) · ADR-0029 (decisiones del fix verified-false-positive — intactas; este ADR resuelve el efecto colateral LOC del fix, no su lógica) · paradigma vertical-slice de `docs/architecture.md`.

Las ADR son registro histórico: no se editan, se reemplazan con una nueva ADR que la supersede.

## Contexto

ADR-0029 (2026-05-22) cerró el bug `verified_at` falsa-positiva del custom-domain V1. La decisión: consumir el endpoint Vercel V6 (`GET /v6/domains/{domain}/config`) además del V9 que ya usábamos, porque V9 `verified` es sticky (ownership) mientras que V6 `misconfigured` es dinámico (DNS actual). Vercel pattern oficial multi-tenant: `verified && !misconfigured`.

La implementación canónica del fix tiene 3 piezas estructurales:

1. **Wrapper V6** en `src/shared/lib/vercel/` (cerrado en S1 del fix, 2026-05-22). Fuera del slice — no entra en este análisis LOC.
2. **Helpers puros del flow** en `actions/_v6-helpers.ts`: `v6ConfigToDnsRecords`, `vercelRecordsToDnsRecords` (movido), `decideDomainFlow` (decisión discriminada de 5 outcomes). 117 LOC + 250 LOC de tests.
3. **Reescritura del lazy poll** en `actions/get-custom-domain-status.ts` (elimina short-circuit, agrega `resetVerifiedAt`, orquesta V6 SIEMPRE + V9 condicional). 204 LOC, +14 vs antes.
4. **Chequeo dual en register** en `actions/register-custom-domain.ts` (post-`addDomain`: V6 check antes de persistir `verified_at`). 265 LOC, +28 vs antes.

Distribución de LOC del slice tras S2.a del fix (sin compactación adicional):

| Archivo | LOC pre-fix | LOC post-fix S2.a | Δ |
|---|---|---|---|
| `public.ts` | 79 | 79 | 0 |
| `ui/domain-section.tsx` | 255 | 255 | 0 |
| `ui/domain-section-archive.tsx` | 166 | 166 | 0 |
| `ui/domain-section-pending.tsx` | 189 | 189 | 0 |
| `types/custom-domain.ts` | 153 | 161 | +8 |
| `actions/archive-custom-domain.ts` | 117 | 117 | 0 |
| `actions/register-custom-domain.ts` | 237 | 265 | +28 |
| `actions/get-custom-domain-status.ts` | 190 | 204 | +14 |
| `actions/_v6-helpers.ts` | 0 | 117 | +117 (nuevo) |
| **Total slice** | **1386** | **1553** | **+167** |

CLAUDE.md §"Límites de tamaño" cap el slice en **1500 LOC**: "Superar un límite = dividir antes de continuar." 1553 supera por 53, y la regla es estricta. Y S2.b del fix (UX banner downreverted) suma otros ~15-20 LOC, llevando el slice a ~1570.

ADR-0028 §"Alternativas rechazadas" #4 había descartado el split en sub-slices al cerrar S4 (2026-05-21) con el argumento "el grafo de archivos es cohesivo, comparten types y UI states, y la unidad conceptual 'custom domain del place' es atómica desde la perspectiva del owner". Era correcto entonces: el slice estaba en 1306 LOC con margen 194, los helpers V6 no existían, y la "unidad conceptual" del owner alineaba con el grafo físico.

ADR-0029 cambió el contexto sin alterar la UX:

1. **El lazy poll dejó de ser un wrapper trivial sobre V9** y pasó a ser un orquestador con decisión consolidada V6+V9 + helpers puros + side-effects DB (`persistVerifiedAt` + `resetVerifiedAt`). Pieza técnica con su propia complejidad interna.
2. **Los helpers son testeables vía vitest** (canon Server Actions: actions no se testean directo; piezas puras sí). `_v6-helpers.test.ts` cubre 17 casos del flow — cobertura que vive con la lógica que cubre, no con UI ni comandos.
3. **El register `lookup verified` también consume los helpers** (`v6ConfigToDnsRecords`, `vercelRecordsToDnsRecords`). Hay un sub-grafo "lazy poll + helpers + register's V6 check" que es internamente cohesivo y externamente independiente de la UI.
4. **Features B y C consumirán el lazy poll directo**, no la UI: Feature B (host routing edge) llamará a una variante del lookup en `app.lookup_place_by_domain` que NO es UI; Feature C (OIDC SSO callback) usará `getCustomDomainStatus` para validar que el dominio está verified antes de emitir cookie local. El sub-slice de verification es la unidad que esos features consumen.

Frente a 1553 LOC sobre cap, las opciones realistas:

1. **Compactar headers y jsdocs hasta caer bajo cap** — discutida; ahorro estimado 70 LOC (alcanza a ~1480) pero sacrifica documentación canónica que en este slice tiene valor (3 capas de razonamiento: ADR-0026 lazy + ADR-0028 promoción + ADR-0029 dual). CLAUDE.md §"Documentación primero": comprimir docs es contrario al principio.
2. **Aceptar la excepción con ADR explícita** — discutida en el diálogo de S2 (2026-05-22). El user descartó: "ADR de excepción" sienta precedente para futuras violaciones; CLAUDE.md §"Ante una desviación" pide registrar la decisión pero no autoriza por defecto excepciones recurrentes; el slice seguiría creciendo (S6 V1.1 cron safety-net suma ~100 LOC más).
3. **Split por capa de operación**: `custom-domain` (commands + UI + types) + `custom-domain-verification` (lazy poll + helpers puros). Pro: respeta cap, alinea el grafo con la realidad de Features B/C, precedente de ADR-0014 (split `onboarding` por capas) y ADR-0019 (`place-wizard` dividido cuando el slice excedió cap). Contra: ~40min de refactor mecánico (mover 2 archivos + crear `public.ts` nuevo + ajustar imports en 1 page).
4. **Split por dominio** (`custom-domain-registration` + `custom-domain-verification` + `custom-domain-archive`) — descartada como over-engineering: register y archive son operaciones cohesivas del owner, separarlas duplica la UI host.

El user (2026-05-22, durante S2 del fix verified-false-positive) eligió (3). Esta ADR registra la decisión + sus consecuencias.

## Decisión

**Splittear `custom-domain` por capa de operación**: el slice anfitrión queda como dueño de UI + tipos + comandos del owner (register/archive); se extrae a un slice nuevo `custom-domain-verification` el lazy poll y los helpers puros del flow. Ambos comparten los tipos del dominio vía el `public.ts` de `custom-domain` (paradigma vertical-slice permite features comunicarse así).

**Estructura final del slice `custom-domain/`:**

```
src/features/custom-domain/
  public.ts                              ← interfaz pública (DomainSection, 2 commands, types)
  ui/
    domain-section.tsx                   ← entry-point: DomainSection + Labels
    domain-section-pending.tsx           ← PendingState + DnsRecordsTable + AutoRefresh + DownrevertedBanner (S2.b)
    domain-section-archive.tsx           ← VerifiedState + ArchiveTrigger + ConfirmDialog
  actions/
    register-custom-domain.ts            ← Server Action (cmd) — chequeo dual V9+V6 post-add
    archive-custom-domain.ts             ← Server Action (cmd)
  types/
    custom-domain.ts                     ← types + mapPgErrorToActionError pure helper
    __tests__/custom-domain.test.ts      ← 8 tests del helper puro
  __tests__/
    domain-section.test.tsx              ← tests RTL render + submit + validación + downrevertedBanner (S2.b)
    domain-section-interactions.test.tsx ← tests RTL confirm/copy/refresh/idempotencia
    _domain-section-helpers.tsx          ← LABELS + setup() compartidos
```

**Estructura final del slice `custom-domain-verification/` (nuevo):**

```
src/features/custom-domain-verification/
  public.ts                              ← interfaz pública (getCustomDomainStatus)
  actions/
    get-custom-domain-status.ts          ← helper-server (NO "use server"), lazy poll dual V9+V6
    _v6-helpers.ts                       ← helpers puros (v6ConfigToDnsRecords, vercelRecordsToDnsRecords, decideDomainFlow)
    __tests__/v6-helpers.test.ts         ← 17 tests del flow puro
```

**LOC post-split (sin tests):**

| Slice | LOC | Cap CLAUDE.md | Estado |
|---|---|---|---|
| `custom-domain` | 1232 (+ S2.b ~15 = ~1247) | 1500 | ✓ margen 250+ |
| `custom-domain-verification` | 321 | 1500 | ✓ holgado |

**Razón del nombre `custom-domain-verification`** (en lugar de `custom-domain-status` o `custom-domain-lazy-poll`): "verification" captura mejor la responsabilidad técnica — el sub-slice no es sólo "leer el state actual", es **verificar continuamente que el dominio está bien configurado**. Es lo que distingue el sub-slice de un simple SELECT: ejecuta un protocolo de verificación V9+V6 con decisión consolidada y side-effects DB selectivos. El nombre lo expone honesto. `status` sería confuso porque sugiere "consultar la fila de la DB" cuando en realidad hace mucho más; `lazy-poll` es jerga interna del slice. Forward-compat: el sub-slice acepta naturalmente la futura Feature S6 cron safety-net (verification activa, no lazy) — el nombre sigue válido.

## Cambios concretos en S2.c (parte mecánica)

1. **Archivos movidos** (3): `actions/get-custom-domain-status.ts` + `actions/_v6-helpers.ts` + `actions/__tests__/v6-helpers.test.ts` desde `src/features/custom-domain/` a `src/features/custom-domain-verification/`. `git mv` para los 3 (los tres están untracked al momento de S2.c, pero el contenido proviene de S2.a en el working tree — el commit S2.c incluye ambos: la lógica nueva del fix + el split estructural en un solo commit coherente).
2. **`src/features/custom-domain-verification/public.ts`** (nuevo): re-exporta `getCustomDomainStatus` + los tipos transitivos necesarios para consumers. Header doc apunta a ADR-0029 + ADR-0030 + `docs/features/custom-domain/spec.md`.
3. **`src/features/custom-domain/public.ts`** (modificado): se quita el re-export de `getCustomDomainStatus`. El barrel queda con `DomainSection` + `DomainSectionLabels` + `registerCustomDomainAction` + `archiveCustomDomainAction` + tipos.
4. **`src/app/(app)/place/[placeSlug]/settings/domain/page.tsx`** (modificado): el import de `getCustomDomainStatus` pasa de `@/features/custom-domain/public` a `@/features/custom-domain-verification/public`. Ninguna otra línea cambia.
5. **`src/features/custom-domain-verification/actions/get-custom-domain-status.ts`** (movido y ajustado): el import de los tipos pasa de `../types/custom-domain` (relative dentro del slice viejo) a `@/features/custom-domain/public` (cross-slice formal vía barrel). Cero cambios de lógica.
6. **`src/features/custom-domain-verification/actions/_v6-helpers.ts`** (movido y ajustado): mismo cambio de import path.
7. **`src/features/custom-domain-verification/actions/__tests__/v6-helpers.test.ts`** (movido): cero cambios — los tests usan imports relativos `../_v6-helpers` que siguen válidos en la nueva ubicación.
8. **`docs/features/custom-domain/spec.md`** (modificado): actualización de pointers de paths cuando aplica + nota sobre el split.

**Cero cambios** en: schema, migrations, RLS, wrapper Vercel (`src/shared/lib/vercel/`), tipos de `CustomDomainState` o `DnsRecord`, contrato de las Server Actions, i18n (las keys siguen siendo `placeSettings.domain.*` — la SoT del wording es la sección del settings desde la perspectiva del user, no la organización física de los archivos; misma decisión que ADR-0028).

## Decisión deliberada: el i18n namespace **NO** se renombra (idéntica a ADR-0028)

Los ~33 keys del bloque `placeSettings.domain.*` × 6 locales siguen en `placeSettings.*` aunque haya un slice consumidor adicional (`custom-domain-verification`). Razones:

1. **El user ve "Configurar tu lugar → Dominio"**: el namespace i18n refleja la jerarquía de UX, no la organización de código.
2. **El sub-slice `custom-domain-verification` NO tiene UI propia**: es backend-only. Los labels los pasa el page Server Component al `<DomainSection>` del slice anfitrión, idéntico a hoy.
3. **Migration cero**: renombrar requiere modificar 6 JSONs + el page + el `getTranslations({namespace})` — por nada.

## Decisión deliberada: la versión MOVIDA del helper privado mantiene el prefijo `_v6-helpers.ts`

El prefijo `_` ya marca "privado al feature, no re-exportar desde `public.ts`". Sigue válido en la nueva ubicación: el sub-slice `custom-domain-verification` re-exporta sólo `getCustomDomainStatus`; los helpers (`v6ConfigToDnsRecords`, `decideDomainFlow`, `vercelRecordsToDnsRecords`) quedan internos. Si en V2 algún consumer externo necesita reutilizar `decideDomainFlow` (improbable), se promueve eliminando el `_` + agregándolo al barrel — decisión incremental.

## Decisión deliberada: el sub-slice consume el wrapper Vercel desde `shared/`, NO desde el slice padre

`custom-domain-verification` importa `getDomainConfig` + `getDomainStatus` directo desde `@/shared/lib/vercel`. No depende de `@/features/custom-domain/public` para acceder a Vercel — el wrapper Vercel es infraestructura compartida, no parte del slice anfitrión. Esto mantiene el grafo de dependencias mínimo: `custom-domain-verification → custom-domain/public (types) + shared/lib/vercel + shared/lib/db + shared/lib/session`. El slice anfitrión NO depende del nuevo sub-slice (es un consumer del page, no del slice padre).

## Consecuencias

### Inmediatas (al cerrar S2.c con esta ADR)

- El slice `custom-domain` queda en ~1232 LOC con margen 268+ sobre el cap. S2.b (banner) y futuras polish caben sin presión.
- El sub-slice `custom-domain-verification` queda en ~321 LOC con margen >1100. Crecimiento esperado: S6 cron safety-net V1.1 (~100 LOC) + helpers adicionales que requiera Feature B (~150 LOC). Holgado por largo tiempo.
- El grafo de dependencias del page queda explícito: 2 slices independientes consumidos en paralelo, cada uno con responsabilidad clara (UI + commands vs verification).
- Los tests de los helpers puros (`v6-helpers.test.ts`, 17 casos) viven junto a los helpers — no en el slice host con la UI.

### Forward-compat con Features B y C

- **Feature B** (host routing edge `mi-place.com → place`): consumirá `custom-domain-verification` para chequear que la fila esté verified antes de rutear. Por ejemplo, `getCustomDomainStatus` en una variante edge-friendly (cache + `app.lookup_place_by_domain`). Cero impacto en el slice anfitrión `custom-domain`.
- **Feature C** (OIDC SSO + callback handler): el callback `mi-marca.com/api/auth/callback/place-idp/route.ts` consumirá `custom-domain-verification` para validar el dominio. El provisioning de `oauth_client_id` no toca ninguno de los dos slices.

### Política a futuro

- **Cap LOC ≤1500 por feature se sigue respetando estrictamente.** Si un slice supera el cap por evolución (nuevas features, fixes que agregan lógica), las opciones canónicas son: (a) compactar comentarios si quedan obvios, (b) extraer piezas a `shared/lib/` si son infra reusable, (c) sub-dividir por capa de operación con ADR registrando la decisión. Precedente acumulado: 0014, 0015, 0016, 0019, 0028, 0030.
- **El criterio de sub-división por capa de operación** se valida cuando: (a) el slice supera cap, (b) hay un sub-grafo internamente cohesivo y externamente reusable (en este caso: lazy poll + helpers consumidos por features futuras), (c) la división mantiene el grafo de dependencias mínimo (no se introducen ciclos ni shared/ que dependa de features/). Si (b) y (c) no aplican, la sub-división es over-engineering y conviene compactar o aceptar excepción documentada.

## Alternativas rechazadas

### 1. Compactar headers y jsdocs hasta caer bajo cap

Discutida y descartada porque:

- Ahorro realista: 70 LOC (1553 → ~1483). Apretadísimo el cap, sin margen para S2.b ni S6.
- Sacrifica documentación canónica de decisiones (CLAUDE.md §"Documentación primero").
- ADR-0028 había rechazado un argumento similar para la promoción inicial — sería inconsistente aceptarlo ahora.
- No resuelve el growth (V1.1 cron safety-net suma ~100 LOC, S6 plan).

### 2. Aceptar la excepción al cap con ADR explícita

Discutida y descartada porque:

- CLAUDE.md §"Ante una desviación" pide registrar la decisión PERO la regla LOC es estricta ("Superar un límite = dividir antes de continuar"). Aceptar una excepción contradice la regla.
- Sienta precedente para futuras violaciones basadas en "el slice es cohesivo aunque sea grande".
- El sub-grafo de verification es objetivamente extraíble (es lo que B y C consumirán). La excepción ocultaría esa realidad bajo "documentado pero no actuado".

### 3. Split por dominio (registration + verification + archive)

Discutida y descartada porque:

- `register` y `archive` son operaciones cohesivas del owner: comparten la UI host (`<DomainSection>` y `<ArchiveTrigger>`), comparten los types, comparten el slice anfitrión. Separarlos en sub-slices duplicaría la UI host o forzaría un `custom-domain-ui` separado, complicando el grafo.
- Los 3 sub-slices serían chicos: 117 archive + 265 register + ~30 UI cada uno + types compartidos. La fragmentación excede la utilidad.

### 4. Extraer los helpers V6 a `shared/lib/vercel-domain-flow/`

Discutida y descartada porque:

- Los helpers dependen del tipo `DnsRecord` que vive en `src/features/custom-domain/types/custom-domain.ts`. Para mover a `shared/`, habría que mover también `DnsRecord` — pero `DnsRecord` es shape específico para la UI del slice, no genérico de Vercel.
- `shared/` no debe depender de `features/` (paradigma vertical-slice, `docs/architecture.md` §17-25). La inversión necesaria sería invasiva.
- El sub-slice `custom-domain-verification` es la unidad correcta porque agrupa helpers + orquestador + tests con dependencias coherentes.

### 5. Mantener todo en `custom-domain` y comprimir agresivamente UI/types también

Discutida y descartada porque:

- Comprimir headers de los 3 UI files (610 LOC totales) ahorraría ~50 LOC adicionales, llegando a ~1430 — apretado.
- `types/custom-domain.ts` (161) tiene jsdocs útiles para el shape de la API pública del slice (consumido por el page); comprimirlos perjudica DX.
- La inversión sería invasiva (5+ archivos tocados) para ganar margen frágil que vuelve a desaparecer con S2.b + V1.1.

## Implementación de la sub-división (referencia)

Pasos secuenciales que aplica esta ADR (todos cerrados al cerrar S2.c):

1. `mkdir -p src/features/custom-domain-verification/actions/__tests__` (la unidad de tests vive junto a la lógica).
2. `git mv src/features/custom-domain/actions/get-custom-domain-status.ts src/features/custom-domain-verification/actions/get-custom-domain-status.ts`.
3. `git mv src/features/custom-domain/actions/_v6-helpers.ts src/features/custom-domain-verification/actions/_v6-helpers.ts`.
4. `git mv src/features/custom-domain/actions/__tests__/v6-helpers.test.ts src/features/custom-domain-verification/actions/__tests__/v6-helpers.test.ts`. Nota operativa: los 3 archivos del paso 2-4 fueron CREADOS por S2.a (working tree, no committed); el primer commit que los incluye es el de S2.c con la estructura nueva ya aplicada. Esto es deliberado: S2.a verde no se commiteó solo (overflow temporal); el commit S2.c integra ambos cambios atómicamente.
5. Reescribir imports en los 3 archivos movidos: `from "../types/custom-domain"` → `from "@/features/custom-domain/public"` (cross-slice formal).
6. Crear `src/features/custom-domain-verification/public.ts` (nueva interfaz pública).
7. Update `src/features/custom-domain/public.ts` (quita el export de `getCustomDomainStatus`).
8. Update `src/app/(app)/place/[placeSlug]/settings/domain/page.tsx` (1 import path cambia).
9. Update pointers en `docs/features/custom-domain/spec.md` cuando aplica.
10. Esta ADR (`docs/decisions/0030-custom-domain-split-by-operation-layer.md`).
11. Update `docs/decisions/README.md` (entrada nueva — agente paralelo).
12. Banner top en ADR-0028 (refinada parcialmente — agente paralelo).
13. Green-close: `pnpm typecheck` · `pnpm lint` · `pnpm test` (esperado: idéntico al pre-split, 429+ verdes) · `pnpm build`.

**Cero impacto runtime**: el page Server Component renderea exactamente el mismo HTML; los actions invocan los mismos endpoints; el lazy poll ejecuta exactamente la misma secuencia V6 → V9 → decisión → DB update; los tests aplican las mismas assertions.

## Pointers

- **Paradigma vertical-slice**: `docs/architecture.md` §17-25.
- **Cap LOC**: `CLAUDE.md` §"Límites de tamaño".
- **Precedentes de promoción/split**: ADR-0014 (split `onboarding` → `place-creation` + `access` — split por capa), ADR-0015 (extraer `style-assist`), ADR-0016 (extraer `place-wizard`), ADR-0019 (`style-assist` también dueño de UI glue + LOC ≥1500 de `place-wizard`), ADR-0028 (promoción inicial de `custom-domain` fuera de `place-settings`).
- **ADR que originó el LOC overflow**: ADR-0029 (chequeo dual V9 + V6 — cierre falsa-positiva).
- **Feature canónico**: `docs/features/custom-domain/spec.md` + ADR-0026.
- **Slice anfitrión post-split**: `src/features/custom-domain/` (UI + commands + types).
- **Slice nuevo**: `src/features/custom-domain-verification/` (lazy poll + helpers puros + tests).
