# Plan — Sesiones 4 y 5 de performance (pendientes)

**Fecha del plan:** 2026-05-06
**Estado:** ⏸ pausado a pedido del user (priorizar fixes de Lexical primero).

## Contexto

Las Sesiones 1, 2 y 3 ya cerraron:

- **Sesión 1** (commit `55a4de3`) — 14 quick wins de baseline TTFB + LCP + bundle.
- **Sesión 2** (commit `2ced957`) — paralelización layouts (Promise.all), `findMemberPermissions` cross-request cache, member detail Suspense streaming.
- **Sesión 3** (TipTap → Lexical, commits `fd83e70` → `590be02`) — bundle por surface ~80–110 kB menos en First Load JS.

**Meta original:** carga percibida en torno a 200ms en rutas de lectura.

**Cuello restante:** Vercel us-east-1 ↔ Supabase us-west-2 ≈ 70ms RTT, con `connection_limit=1` en prod (las queries se serializan dentro de cada lambda invocation). Hoy una page con 3 queries en serie cuesta ~210ms sólo en red.

## Sesión 4 — Consolidar `findPostBySlug` a una sola query

### Objetivo

Reducir el número de round-trips de la ruta más caliente (abrir un thread). Hoy `/conversations/[postSlug]` dispara, vía `Promise.all` y queries internas:

1. `loadPlaceBySlug(placeSlug)` → 1 RTT.
2. `findPostBySlug(placeId, slug)` con `include: { event, libraryItem }` → 1 RTT.
3. `resolveViewerForPlace` que internamente hace `getCurrentAuthUser` + `findActiveMembership` + `findIsPlaceAdmin` + `findPlaceOwnership` + `findUserProfile` → varios RTTs (algunos cacheados).
4. `findOrCreateCurrentOpening(placeId)` → 1 RTT (cached).
5. `aggregateReactions` (POST) → 2 RTTs (groupBy + findMany del viewer).

Plus el Suspense child (`CommentsSection`) dispara: comments + readers + reactions + quoteState.

### Trabajo

- **F.1** Inspeccionar `findPostBySlug` y los caller-sites. Decidir si conviene:
  - **Opción A:** un único `prisma.$queryRaw` que joinee `Post + Place + PlaceOpening + Membership(viewer) + GroupMembership(viewer) + Ownership(viewer) + reaction-counts del POST`. Trae todo lo del shell en 1 RTT.
  - **Opción B:** mantener queries separadas pero asegurar que **todas** vivan dentro del mismo `Promise.all` de la page. Hoy `loadPlaceBySlug` y `findPostBySlug` están en serie (la segunda necesita `place.id`). Para paralelizarlas hay que aceptar el slug en la query del post.
- **F.2** Si va Opción A, escribir el query raw + tipar el row. Aceptable que viva en `discussions/server/queries.ts` o en un nuevo `discussions/server/queries/post-shell.ts` si pasa de 80 LOC.
- **F.3** Tests: la query consolidada debe matchear el shape consumido por la page + `<PostDetail>`. Reusar fixtures existentes.
- **F.4** Medir antes/después con `scripts/measure-perf-remote` apuntado a `/conversations/[postSlug]` (post seedeado en cloud dev). Targets: TTFB ≤ 100ms, p95 page total ≤ 250ms desde Vercel.

### Riesgos

- `$queryRaw` pierde tipos automáticos de Prisma → tipar a mano + test que cubra el shape (sino se cae sólo cuando alguien rename de columna).
- El query consolidado puede ser frágil ante futuros campos del Post → balancear "consolidar todo lo del shell" vs mantener `findPostBySlug` puro.
- No tocar `aggregateReactions`: vive bajo Suspense del shell del POST, no es del path crítico inicial.

## Sesión 5 — `loadPlaceBySlug` con `unstable_cache` cross-request

### Objetivo

Convertir la query de Place en cero round-trips para usuarios que ya tocaron el place en la sesión.

Hoy `loadPlaceBySlug` (en `shared/lib/place-loader.ts`) usa `React.cache` — sólo cachea **dentro de un request**. La primera vez por sesión (o tras 5 min sin tráfico) cuesta el RTT completo (~70ms + query). El usuario que entra a `/conversations`, después abre un thread, después vuelve al listado, paga el RTT 3 veces.

### Trabajo

- **F.1** Identificar el shape canónico del Place que necesitan los layouts/pages. Hoy `loadPlaceBySlug` retorna el row completo — algunos campos (ej. `editorPluginsConfig`) los consumen pages diferentes. Decidir si:
  - cachear todo el row (más memoria pero menos cache misses), o
  - exponer dos funciones (`loadPlaceCoreBySlug` con campos hot + `loadPlaceFullBySlug` para settings).
- **F.2** Envolver la query en `unstable_cache` con `tags: ['place:slug:<slug>', 'place:id:<id>']`. TTL razonable: 60s en prod, `revalidate: false` con invalidación por tag.
- **F.3** Audit de mutations que pueden cambiar el Place: `places/server/actions/update.ts`, `archive`, `transfer-ownership`, `update-opening-hours`, `update-editor-config`. Cada una agrega `revalidateTag('place:id:<placeId>')` después del write.
- **F.4** Confirmar que `findMemberPermissions` (ya cacheado en Sesión 2) sigue invalidándose correctamente al cambiar grupos/membership — los tags no deben colisionar.
- **F.5** Test: simular dos requests consecutivos al mismo place + un mutation entre medio + verificar que el cache se invalida. Cubrir el caso "mutation falla, cache no se invalida indebidamente".

### Riesgos

- **Stale data**: si una mutation no llama `revalidateTag`, el cache sirve datos viejos hasta el TTL. El audit de F.3 es crítico — un solo write sin invalidación rompe la confianza.
- **`unstable_cache` no funciona con lambdas frías**: el cache vive en el runtime del worker; en serverless cada cold start arranca vacío. Beneficio real es para sesiones-warm con varios requests seguidos. OK como mitigación parcial — la primera carga sigue pagando el RTT.
- **Memoria**: cachear el row completo del Place × N places visitados puede crecer. Vercel limita por instancia, no debería ser issue con 150 miembros/place y un puñado de places por usuario, pero medirlo.

### Verificación combinada (post 4 + 5)

- `pnpm typecheck && pnpm lint && pnpm test --run && pnpm build` verde.
- E2E `tests/e2e/flows/discussions-create-read.spec.ts` (o similar) verde — captura regresiones funcionales.
- `scripts/measure-perf-remote https://place.community/conversations/<slug>`:
  - TTFB warm ≤ 90ms (dos hits seguidos al mismo place).
  - LCP percibido ≤ 250ms en desktop wifi.
  - First-byte cold (primera visita del usuario) sin regresión vs hoy (~150ms).

## Pendientes adicionales (no parte de Sesiones 4-5 pero relacionados)

- **Mention resolvers de event + libraryItem**: hoy `_mention-resolvers.ts` tiene stubs `event: async () => null` y `libraryItem: async () => null`. Cualquier mention a un evento o library-item renderiza placeholder `[EVENTO NO DISPONIBLE]` / `[RECURSO NO DISPONIBLE]`. Implementar lookup real (similar a `user`) cuando se cierre el bug-batch de Lexical.
- **Reaction index**: la migration `@@index([userId, targetType, targetId])` planeada en Sesión 1 quedó sin aplicar a cloud dev. Confirmar antes de medir Sesión 4 (afecta `aggregateReactions.findMany` del viewer).

## Cómo retomarlo

Cuando arranquemos:

1. Read este archivo + `docs/plans/2026-05-06-tiptap-to-lexical-migration.md` (cerrado, contexto histórico).
2. Decidir orden: probable Sesión 5 primero (más liviana, menos riesgo) y después Sesión 4.
3. Spawnar plan agent con el alcance de cada sesión.
