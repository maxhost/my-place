# Request-scoped identity cache: primitives cacheados con `React.cache`

**Fecha:** 2026-04-20
**Milestone:** Fase 5 / C.F.2 (fix del Suspense boundary error en navegación)
**Autor:** Max
**Estado:** Implementada (2026-04-20)

## Contexto

Tras cerrar C.F.1 (upsert monótono de `PostRead`), la navegación de un post de
vuelta al listado `/[placeSlug]/conversations` empezó a mostrar:

```
The server could not finish this Suspense boundary, likely due to an error
during server rendering. Switched to client rendering.
```

El log de Prisma del dev server confirmó que **no había error real** — el GET
200 OK tardaba 20–30 segundos. Next aborta el streaming del Suspense si el
render del RSC excede el presupuesto y cae a CSR.

### Raíz del problema

Dos factores se multiplicaban.

**1. Duplicación de queries de identidad.**

Por render de `/conversations`, el árbol `/[placeSlug]/layout.tsx` → `(gated)/layout.tsx` → `page.tsx`
disparaba la misma resolución de identidad tres veces sin compartir resultado:

- `layout.tsx`: `auth.getUser()` + `loadPlaceBySlug()` + `findMemberPermissions(userId, placeId)`
  (que internamente hace `membership.findFirst` + `placeOwnership.findUnique`).
- `(gated)/layout.tsx`: `auth.getUser()` (otra vez) + `loadPlace()` (cached) + `findMemberPermissions(...)` (otra vez).
- `conversations/page.tsx` → `resolveViewerForPlace({ placeSlug })` → `auth.getUser()` (otra vez) + `place.findUnique` + `membership.findFirst` + `placeOwnership.findUnique` + `user.findUnique`.

Log real (contado del Prisma query log):

| Entidad                     | Hits | Esperado |
| --------------------------- | ---- | -------- |
| `auth.getUser`              | 3    | 1        |
| `Place.findUnique`          | 3    | 1        |
| `Membership.findFirst`      | 6    | 1        |
| `PlaceOwnership.findUnique` | 3    | 1        |
| `User.findUnique`           | 1    | 1        |

El comentario JSDoc en `(gated)/layout.tsx` ya indicaba la intención —
"podemos resolver el rol reusando los mismos queries (React.cache los memoiza
por request)" — pero la implementación real no envolvía los helpers en
`cache()`. Divergencia silenciosa entre intent y código.

**2. Overhead de pgbouncer en transaction mode.**

Supabase expone el pooler en port 6543 con transaction mode. Cada query de
Prisma se traduce a 4 round-trips:

```
BEGIN → DEALLOCATE ALL → <query> → COMMIT
```

Con ~200 ms de latencia a la región remota → ~800 ms por query. 15 queries ×
800 ms = 12 s sólo en round-trips. Next aborta mucho antes de que terminen.

## Alternativas consideradas

- **A — Cachear `resolveActorForPlace` directo con `React.cache`.**
  `cache()` usa referencia para args no-primitivos; el objeto `{ placeSlug }`
  genera un nuevo shape cada call y no dedupea. Descartada: resolverlo con
  overloads primitive-keyed (`resolveActorBySlug(slug)` / `resolveActorById(id)`)
  duplicaba superficie pública sin ganancia sobre la opción elegida.

- **B — Envolver `findInviterPermissions` con `cache()` y dejar el resto.**
  Ataca sólo la duplicación entre layouts pero no entre layouts ↔ actor
  resolver. El actor seguiría re-queryeando membership y ownership en la page.
  Descartada: no cierra el gap.

- **C — Cambiar el pool connection string a DIRECT_URL (port 5432, session mode).**
  Elimina el overhead de `DEALLOCATE ALL` por query. Descartada como **fix**:
  es una decisión de infraestructura, no resuelve la causa raíz (queries
  duplicadas). En dev local puede usarse como aceleración complementaria, pero
  prod mantiene el pooler por límite de conexiones de Postgres.

- **D — Cachear `auth.getUser()` sin tocar Prisma.**
  Elimina 2/3 round-trips a Supabase Auth. Mejora marginal. Descartada como
  solución única — se **incluye** como parte del fix elegido.

- **E — Refactor a una única función monolítica "loadPageContext".**
  Un helper que carga todo (auth + place + perms + user) en un solo call.
  Descartada: rompe los límites de slice (discussions importaría internals
  de members), y pierde flexibilidad si una page necesita sólo un subset.

## Decisión

**Primitives cacheados por clave primitiva**, componibles. Tres capas:

### Capa 1 — Auth primitive en `shared/lib/`

`src/shared/lib/auth-user.ts` expone `getCurrentAuthUser()` envuelto en
`React.cache`. Cualquier layout/page/action obtiene el mismo `AuthUser | null`
por request sin re-llamar al endpoint de Supabase Auth.

### Capa 2 — Identity primitives en `shared/lib/`

`src/shared/lib/identity-cache.ts` expone:

- `findActiveMembership(userId, placeId)` → `{ id, role } | null`
- `findPlaceOwnership(userId, placeId)` → `boolean`
- `findUserProfile(userId)` → `{ displayName, avatarUrl } | null`

Los tres cacheados por clave primitiva. **Viven en `shared/` por precedente**:
`place-loader.ts` ya establece que helpers genéricos consumidos por dos o más
features se ubican en `shared/lib/`. CLAUDE.md prohíbe `shared/ → features/`,
no el reverso.

**Por qué no en `members/server/queries.ts`:** `@/features/members/public`
re-exporta `./server/actions`, que transitivamente carga
`@/shared/lib/supabase/admin` → `clientEnv` (estricto). Importar cualquier
cosa del public de members desde `discussions/server/actor.ts` activaba el
validation de env en los tests y rompía 4 suites que antes andaban. Mover los
primitives a `shared/` rompe esa cadena y también respeta mejor el principio
"shared es para helpers cross-slice".

### Capa 3 — Composición en `members/server/queries.ts`

`findInviterPermissions(userId, placeId)` (alias público `findMemberPermissions`)
se queda en members porque su shape `{ role, isOwner }` es members-dominio.
Ahora **compone** los primitives de shared y se envuelve a sí misma con
`cache()` para dedupear la llamada compuesta cuando varios callsites piden
los mismos args.

### Consumidores

- `resolveActorForPlace` en `features/discussions/server/actor.ts` ahora
  importa `getCurrentAuthUser`, `loadPlaceBy{Id,Slug}`, `findActiveMembership`,
  `findPlaceOwnership`, `findUserProfile` desde `@/shared/lib/*`. Cero imports
  a otras features; respeta la regla "feature no importa directamente de
  otra feature".
- Layouts y pages bajo `/[placeSlug]/` que llamaban `createSupabaseServer().auth.getUser()`
  directo pasaron a `getCurrentAuthUser()`: root layout, gated layout,
  settings layout, settings members page, member profile page.

## Consecuencias

**Positivas:**

- Un request de `/[placeSlug]/conversations` baja de ~15 queries de identidad
  a 5 (auth + place + membership + ownership + user). Con pgbouncer 800 ms/query,
  baja ~8 segundos de wall-time de round-trips.
- Se elimina el Suspense boundary abort: el render termina dentro del budget.
- `findInviterPermissions` usado en settings/hours/m-page también se beneficia
  del cache — efecto positivo en toda la app.
- El patrón `React.cache` en `shared/lib/` queda establecido (4 helpers ahora:
  `loadPlaceBySlug`, `loadPlaceById`, `getCurrentAuthUser`, y los 3 de
  `identity-cache.ts`).

**Negativas / costos:**

- Uno de los tests existentes (`actor.test.ts`, etc.) no existía con cobertura
  del cache behavior — `React.cache` es inerte fuera del render tree, así
  que un test unitario tendría que simular un render RSC para verificar
  dedupe. La verificación real es manual (query log del dev server) y
  el query-count observable en prod via Supabase Dashboard.
- Los tests del slice discussions ahora dependen transitivamente de
  `@/shared/lib/identity-cache` (vía actor.ts). Los mocks de `prisma` siguen
  funcionando sin ajuste porque cache() es pass-through en node.

**Sin deuda nueva.** La decisión se basa en patrones existentes del repo.

## Verificación

- `pnpm typecheck`: verde.
- `pnpm lint`: verde.
- `pnpm test`: 50 archivos / 448 tests verdes.
- Manual post-deploy: reiniciar dev server, GET `/palermo/conversations`,
  confirmar en Prisma log que `Membership.findFirst` aparece 1 vez,
  `PlaceOwnership.findUnique` 1 vez, `Place.findUnique` 1 vez.

## Referencias

- `src/shared/lib/auth-user.ts` (nuevo)
- `src/shared/lib/identity-cache.ts` (nuevo)
- `src/shared/lib/place-loader.ts` (modificado: `loadPlaceById`)
- `src/features/members/server/queries.ts` (refactor de `findInviterPermissions`
  - `findActiveMembership` re-export)
- `src/features/discussions/server/actor.ts` (refactor de
  `resolveActorForPlace`)
- Layouts/pages bajo `src/app/[placeSlug]/` (migrados a
  `getCurrentAuthUser` + `loadPlaceBySlug`)
- ADR hermano: `docs/decisions/2026-04-20-post-read-upsert-semantics.md`
  (C.F.1 — completó el fix de lectura del dot)

## Seguimiento

- `docs/decisions/2026-04-21-unified-place-cache.md` (2026-04-21) extiende el patrón:
  `loadPlaceBySlug` y `loadPlaceById` ya no son dos memos independientes de
  `React.cache` sino un único map request-scoped con cross-population slug↔id.
  Elimina la segunda `Place.findUnique` que hacía `findPlaceHours` cuando el
  layout padre ya había cargado el Place por slug.
