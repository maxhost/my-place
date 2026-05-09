# Back navigation con origen explícito (`?from=…`)

**Fecha:** 2026-05-09
**Milestone:** Bugfix UX (post-launch threads + library item back button)
**Autor:** Max

## Contexto

El botón "Volver atrás" del thread detail (`/conversations/[postSlug]`)
y del library item detail (`/library/[cat]/[itemSlug]`) no respetaba el
contexto desde el cual el viewer había llegado.

Síntoma reportado por el user:

> "Cuando estoy dentro de un thread y hago click en el botón de UI para
> volver atrás, me lleva al form de creación que es desde donde
> llegué."

El back button usaba `router.back()` cuando había history disponible
(`window.history.length > 1`). El flujo "publicar nueva discusión":

```
/conversations  →  /conversations/new  →  (router.push)  →  /conversations/<slug>
```

dejaba el form `/conversations/new` en el history stack. Click en
"Volver" → `router.back()` → de regreso al form vacío. Anti-UX.

Comportamiento esperado por zona:

- **Discussion estándar** (`post.event === null` && `post.libraryItem
=== null`): siempre volver a `/conversations`.
- **Event-thread** (`post.event !== null`):
  - Llegó desde `/events` → volver a `/events`.
  - Llegó desde `/conversations` → volver a `/conversations`.
- **Library item** (`/library/[cat]/[itemSlug]`):
  - Llegó desde `/conversations` (mention, link cross-zona) → volver
    a `/conversations`.
  - Llegó desde la categoría (`/library/<cat>`) → volver a esa
    categoría.

## Decisión

Combinación de dos cambios complementarios:

### 1. Query param explícito `?from=<zone>` (Approach A)

Cards de listado y redirects de Server Action linkean al detalle con
un query param `?from=conversations|events`. La page composer SSR lo
lee, aplica la regla de mapping, y pasa un `backHref` determinista al
header bar.

- `shared/lib/back-origin.ts` define el enum (`OriginZone`),
  `parseOriginZone(raw)` defensivo, `ORIGIN_ZONE_HREF` con la URL
  canónica de cada zona, `originQuery(zone)` para construir el
  querystring.
- `BackButton` (`shared/ui/back-button.tsx`) acepta un nuevo prop
  `href?: string`. Cuando está presente: `router.push(href)` directo,
  sin inspeccionar history. Cuando no está presente: comportamiento
  legacy (history-aware con `router.back()` + fallback).
- `LibraryItemHeaderBar` ya usaba `<BackLink>` (server) por el loop de
  redirect 308 desde `/conversations/[slug]`; sólo agregamos `backHref?`
  para overridear el default `/library/[categorySlug]`.
- Page composers de thread y library item leen `searchParams.from`,
  computan `backHref`, lo pasan al header bar.

### 2. `router.replace` en formularios de creación

`post-composer-form.tsx` y `library-item-composer-form.tsx` ahora usan
`router.replace` (no `push`) para navegar al detalle recién creado.
Mismo fix que ya tenía `event-form.tsx` desde F.F. Esto saca el
`/new` del history stack — incluso si el back button decidiera usar
`router.back()`, no caería al form.

Esta segunda parte es **complementaria** a (1): aunque el `?from=…`
ya garantiza que el back va a la zona correcta, dejar el form en el
history es mala UX (un usuario que use el back nativo del browser
también caería al form vacío).

## Por qué Approach A y no B (`document.referrer` + sessionStorage) o C (history inspection)

- **B** depende de browser-only API. Se pierde con hard refresh, es
  ambiguo si el viewer vino de un link externo (email), y obliga al
  componente a ser cliente. CLAUDE.md pide "Server Components por
  default".
- **C** (inspeccionar `history` y filtrar zonas válidas) es frágil:
  hay que excluir manualmente `/new`, `/edit`, `/conversations/[slug]`
  (cuando viniste de otro thread vía mention), etc. El conjunto de
  paths a excluir crece sin límite a medida que aparecen flujos. Y
  no resuelve el caso "llegué desde mention en otra zona y quiero
  volver a esa zona" — `router.back()` llevaría al thread origen,
  no a su listado.
- **A** es deterministic, server-first, robusto a refresh. El precio
  es actualizar los call-sites de cards. Costo único, payoff
  permanente.

## Cambios concretos

### Archivos nuevos

- `src/shared/lib/back-origin.ts` (~50 LOC) — módulo de parseo +
  mapping de zonas.
- `src/shared/lib/__tests__/back-origin.test.ts` — unit tests del
  parser y del query builder.
- `docs/decisions/2026-05-09-back-navigation-origin.md` — este ADR.

### Archivos modificados

#### Shared UI

- `src/shared/ui/back-button.tsx` — nuevo prop `href?: string` con
  semántica determinista. Comportamiento legacy preservado cuando no
  se provee.
- `src/shared/ui/__tests__/back-button.test.tsx` — 2 casos nuevos
  (href determinista con/sin history).

#### Header bars

- `src/features/discussions/ui/thread-header-bar.tsx` y su duplicado
  `discussions/threads/ui/thread-header-bar.tsx` — accept `backHref?`,
  pass-through a `BackButton`.
- `src/features/library/ui/library-item-header-bar.tsx` y su duplicado
  `library/items/ui/library-item-header-bar.tsx` — accept `backHref?`
  que overridea el default `/library/[categorySlug]`.

#### Page composers

- `src/app/[placeSlug]/(gated)/conversations/[postSlug]/page.tsx` —
  lee `searchParams.from`, computa `backHref` (event-thread + `?from=
events` → `/events`; resto → `/conversations`).
- `src/app/[placeSlug]/(gated)/library/[categorySlug]/[itemSlug]/page.tsx` —
  lee `searchParams.from`, computa `backHref` (`?from=conversations`
  → `/conversations`; resto → undefined → header bar usa default
  `/library/[categorySlug]`).

#### Card link sources (agregar `?from=`)

- `src/features/discussions/threads/ui/thread-row.tsx`,
  `featured-thread-card.tsx` y duplicados `discussions/ui/...` →
  `?from=conversations`.
- `src/features/events/ui/event-list-item.tsx` y duplicado
  `events/calendar/ui/event-list-item.tsx` → `?from=events`.
- `src/app/[placeSlug]/(gated)/_mention-resolvers.ts` — mentions a
  events/library items desde un body renderizado en `/conversations`
  llevan `?from=conversations` (back vuelve a la conversación origen).

#### Action redirects

- `src/features/discussions/ui/post-composer-form.tsx` —
  `router.push` → `router.replace` + `?from=conversations`.
- `src/features/discussions/ui/library-item-composer-form.tsx` —
  `router.push` → `router.replace`. Sin `?from=` (back default a
  categoría es razonable post-publish).
- `src/features/events/ui/event-form.tsx` — agrega `?from=events` al
  redirect de create. El edit mantiene su lógica (history-aware via
  cancel button).
- `src/app/[placeSlug]/(gated)/events/[eventId]/page.tsx` (redirect 308) — agrega `?from=events`.

## Consecuencias

**Ganancias inmediatas**:

- El bug reportado desaparece: publicar una discusión + back ya no
  cae al form.
- Event-threads abiertos desde `/events` vuelven a `/events`; los
  abiertos desde `/conversations` vuelven a `/conversations`.
- Library items abiertos via mention desde un thread vuelven al
  thread origen (`/conversations`); abiertos desde la categoría
  vuelven a la categoría.

**Costo**:

- ~12 archivos modificados + 2 archivos nuevos. Cambios mecánicos
  por archivo.
- Las pages ahora son dynamic (leen `searchParams`). Ya lo eran por
  Prisma queries — no hay regresión.

**Riesgos descartados**:

- _Pages tienen barreras de boundary_: el page composer es la única
  capa que orquesta `back-origin` + slice. Slices no se enteran del
  query param — sólo aceptan `backHref?` como string opaco. Boundary
  preservado.
- _LOC caps_: `back-origin.ts` ≤60 LOC; cambios en headers ≤40 LOC
  cada uno; pages ≤80 LOC tras cambios.
- _Streaming agresivo del shell_: `searchParams` es top-level await
  cheap (no es query DB). Patrón canónico preservado.

## Alternativas descartadas

1. **`document.referrer` + `sessionStorage` (Approach B)**: no
   server-first, frágil ante refresh, ambiguo con links externos.
2. **History stack inspection (Approach C)**: lista de paths a
   excluir crece sin límite; no resuelve cross-zona por mention.
3. **Persistir el `from` en una cookie**: cookie es global, no
   navigation-scoped. Bug obvio: abrir 2 tabs = un tab pisa el `from`
   del otro.

## Verificación

- `pnpm typecheck`: verde.
- `pnpm lint`: verde.
- `pnpm test --run`: 1949 tests verde (8 nuevos: 6 en
  `back-origin.test.ts`, 2 nuevos en `back-button.test.tsx`).
- E2E specs sin cambio (regexps existentes toleran `?from=…` después
  del slug; el library composer no agrega `?from=` así que el regex
  estricto `/library/<cat>/[^/]+$` sigue matchiando).

### Manual QA pendiente

- `/conversations/new` → publicar → back en thread → debe ir a
  `/conversations` (no al form).
- `/events` → click card → back en event-thread → debe ir a
  `/events`.
- `/conversations` → click thread con event → back en event-thread →
  debe ir a `/conversations`.
- `/library/[cat]` → click item → back en item detail → debe ir a
  `/library/[cat]`.
- Thread con mention a library item → click mention → back en item
  detail → debe ir a `/conversations`.

## Casos edge no cubiertos automáticamente

- **Deep link sin `?from=`**: cae al default razonable de cada page
  (thread → `/conversations`, library item → categoría).
- **`?from=` con valor desconocido** (ej: `?from=foo`):
  `parseOriginZone` retorna null → comportamiento como deep link.
  Defensivo, sin throw.
- **Tab compartida entre flujos**: el `?from=` viaja como query del
  URL, no en cookie. Cada tab mantiene su propio origen.

## Referencias

- `CLAUDE.md` § "Server Components por default", "URLs públicas son
  subdominio".
- `docs/architecture.md` § "Streaming agresivo del shell".
- `docs/decisions/2026-04-26-events-as-thread-unified-url.md` —
  unificación que generó el caso event-thread.
- `docs/decisions/2026-05-08-sub-slice-cross-public.md` — boundary
  rules respetadas.
- `MEMORY.md § feedback_urls_subdomain.md`.
