# Unified Place cache: dedupe cross-key (slug ↔ id) en un solo request

**Fecha:** 2026-04-21
**Milestone:** Performance dev — fase de diagnóstico pre-deploy
**Autor:** Max
**Estado:** Implementada (2026-04-21)

## Contexto

El ADR `2026-04-20-request-scoped-identity-cache.md` resolvió la duplicación de queries de identidad en el árbol layout → page. Cacheó `auth.getUser`, `Membership.findFirst`, `PlaceOwnership.findUnique`, `User.findUnique`, y `Place.findUnique` (por slug) con `React.cache`. Bajó una página de `/conversations` de ~15 queries a 8.

Dentro de esas 8 queedaba una redundancia visible en el Prisma log:

```
model: "Place"  action: "findUnique"  durationMs: 2166   ← loadPlaceBySlug
model: "Place"  action: "findUnique"  durationMs: 1575   ← findPlaceHours  (MISMO PLACE)
```

El segundo `findUnique` venía de `findPlaceHours(placeId)` dentro de `findOrCreateCurrentOpening(place.id)` (fire-and-forget del gated layout). Con pgbouncer en Supabase remoto (~800 ms/query) desde dev local, esa query redundante costaba ~800 ms de wall-time.

### Raíz del problema

`React.cache` memoiza por identidad de función + args. `loadPlaceBySlug` y `loadPlaceById` son **dos memos independientes**, aunque ambos apunten a la misma fila de `Place`:

```ts
export const loadPlaceBySlug = cache(async (slug) => prisma.place.findUnique({ where: { slug } }))
export const loadPlaceById = cache(async (id) => prisma.place.findUnique({ where: { id } }))
```

Un render que llame `loadPlaceBySlug('palermo')` y luego `loadPlaceById('cmo6...')` dispara dos queries aunque traen la misma fila. Análogo en `findPlaceHours(placeId)` — que internamente queryeaba `Place` otra vez por id — y en cualquier action que salga "fría" con solo `placeId`.

Sin fix, cada callsite futuro que quiera cargar el Place por una clave distinta a la que cacheó el layout padre paga un query más.

## Alternativas consideradas

- **A — Pasar `hours` como param opcional a `findOrCreateCurrentOpening`.**
  Táctico. Cubre este callsite pero no `markPostReadAction` ni futuros. Rechazada: la deuda reaparece con cada nueva feature que necesite Place.

- **B — Renombrar todo a un único `loadPlace(key)` con key polimórfica.**
  Forzar una firma `{ slug } | { id }` y cachear por key normalizada. Rechazada: `cache()` usa referencia para objetos, no shape — dos llamadas con `{ slug: 'x' }` construidos en lugares distintos no dedupean.

- **C — Map request-scoped con cross-population (ELEGIDA).**
  Un único `PlaceCache` por request con dos Maps (`bySlug`, `byId`). Cuando un lookup por slug termina, siembra el slot `byId` con el mismo promise; idem al revés. Dos callers del mismo Place desde cualquier ángulo → 1 query.

- **D — Deshabilitar el pooler en dev.**
  Reduce el costo por query pero no elimina la redundancia. Ortogonal al problema. Descartada como solución; puede acompañar como optimización separada de infra.

## Decisión

**`src/shared/lib/place-loader.ts` reescrito** alrededor de un cache compartido cross-key. Superficie pública inalterada; detalle interno reemplazado.

### API pública (sin cambios)

```ts
export async function loadPlaceBySlug(slug: string): Promise<LoadedPlace | null>
export async function loadPlaceById(id: string): Promise<LoadedPlace | null>
```

Mismo return shape (`LoadedPlace`), misma nulabilidad, mismo comportamiento de error.

### Internals

```ts
type PlacePromise = Promise<LoadedPlace | null>
export type PlaceCache = {
  bySlug: Map<string, PlacePromise>
  byId:   Map<string, PlacePromise>
}

export function createPlaceCache(): PlaceCache { ... }  // exportada SOLO para tests
const getPlaceCache = cache((): PlaceCache => createPlaceCache())

export async function loadPlaceBySlugWithCache(cache, slug) {
  const hit = cache.bySlug.get(slug)
  if (hit) return hit
  const pending = (async () => {
    const row = await prisma.place.findUnique({ where: { slug }, select: PLACE_SELECT })
    if (row) cache.byId.set(row.id, Promise.resolve(row))
    return row
  })()
  cache.bySlug.set(slug, pending)
  return pending
}
```

`loadPlaceBySlug` y `loadPlaceById` públicos delegan en los `WithCache` pasando `getPlaceCache()`. En tests, se usan los `WithCache` con un `createPlaceCache()` fresco — sin dependencia de render RSC.

### `findPlaceHours` delega

`src/features/hours/server/queries.ts`:

```ts
export async function findPlaceHours(placeId): Promise<OpeningHours> {
  const place = await loadPlaceById(placeId) // hit del cache compartido
  if (!place) return { kind: 'unconfigured' }
  return parseOpeningHours(place.openingHours)
}
```

Antes hacía su propio `prisma.place.findUnique({ select: { openingHours: true } })`. Ahora reusa el cache. Con el layout padre habiendo cargado el Place por slug, este lookup cuesta cero queries.

## Consecuencias

**Positivas:**

- Request de `/[placeSlug]/conversations` pierde el segundo `Place.findUnique` (~800 ms en dev remoto, ~10 ms en prod).
- Cualquier action frío con `placeId` que pida hours (ej: `assertPlaceOpenOrThrow`, `markPostReadAction`) hace **una** query de Place y la comparte con el resto del render.
- El patrón queda disponible para repetir si en el futuro otra entidad tiene dos claves de acceso (ej: `loadUserByHandle` + `loadUserById`).

**Sin regresiones:**

- API pública de `loadPlaceBy{Slug,Id}` sin cambios → 18 callsites intactos.
- `findPlaceHours` mantiene firma y contrato → test `place-opening.test.ts` (que lo mockea) sigue verde.
- Tests existentes (mocks sobre `prisma.place.findUnique`) siguen pasando porque el refactor no cambia el driver subyacente.

**Costos / limitaciones conocidas:**

1. **Cross-population se dispara al resolver.** Si una llamada `loadPlaceById(id)` ocurre concurrente a `loadPlaceBySlug(slug)` _antes_ de que la segunda resuelva, el caller del id no sabe que es el mismo Place y dispara su propia query. En la práctica imposible — un caller que tiene el `id` lo obtuvo de un lookup previo (el `slug` lookup ya resolvió). No hay callsites concurrentes con keys cruzadas conocidas. Documentado acá para quien agregue uno.

2. **`findPlaceHours` ahora carga 6 columnas** (`PLACE_SELECT` completo) en lugar de solo `openingHours`. Delta en wire ~50 bytes por fila, irrelevante. Cuando el cache está caliente, cero bytes.

3. **`React.cache` es inerte en tests unit.** Los tests de `place-loader.test.ts` usan los helpers `*WithCache(cache, key)` directamente con `createPlaceCache()` fresco por cada caso. Mismo problema que señaló el ADR hermano del 2026-04-20; el fix es estructural (exportar los helpers internos), no por test util.

## Verificación

- `pnpm typecheck`: verde.
- `pnpm lint`: verde.
- `pnpm test`: 58 files, 537 tests (530 previos + 7 nuevos en `place-loader.test.ts`).
- Tests nuevos cubren: dedupe por slug, dedupe por id, slug→id cross-key, id→slug cross-key, null no poluciona el map cruzado, rejections cacheadas, concurrencia in-flight compartida.
- Manual pendiente al reiniciar dev server: confirmar en Prisma log que `GET /[placeSlug]/conversations` dispara **1 sola** `Place.findUnique` (antes: 2).

## Referencias

- `src/shared/lib/place-loader.ts` (reescrito)
- `src/shared/lib/__tests__/place-loader.test.ts` (nuevo)
- `src/features/hours/server/queries.ts` (`findPlaceHours` delega)
- ADR hermano: `docs/decisions/2026-04-20-request-scoped-identity-cache.md` (C.F.2) — establece el patrón request-scoped, este ADR lo extiende al caso cross-key.
- Gotcha relacionado en `CLAUDE.md`: pgbouncer transaction mode, por qué cada query cuesta ~RTT completa.
