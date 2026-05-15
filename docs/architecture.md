# Arquitectura de Place

Paradigma: **Modular Monolith con Vertical Slices**. Priorizamos calma, estabilidad y mantenibilidad por una sola persona.

Este documento es el índice de las decisiones arquitectónicas. El detalle de cada área vive en `docs/`.

## Principios de organización

- **Vertical slices sobre capas horizontales**: cada feature agrupa toda su lógica —UI, server actions, queries, schemas, tests— en un único directorio.
- **Cajitas ordenadas, puertitas pequeñas**: los slices son autocontenidos y solo exponen una API mínima vía `public.ts`.
- **Server-first**: la lógica vive en el servidor; el cliente recibe HTML y pequeñas islas interactivas.
- **Colocation**: lo que cambia junto, vive junto.
- **Simplicidad antes que novedad**: preferimos piezas pocas y confiables sobre arquitecturas distribuidas.

## Reglas de aislamiento entre módulos

Inviolables. Enforzadas por eslint con `no-restricted-paths`.

- Una feature nunca importa archivos internos de otra. Solo consume lo que la otra exporta en su `public.ts`.
- `shared/` nunca importa de `features/`.
- El acceso a la DB se hace desde `queries.ts` y `actions.ts` del propio feature. Nunca desde componentes ni otras features.
- Las rutas en `src/app/` son delgadas: importan desde features y renderizan.
- Dependencias entre features son unidireccionales. Si aparece un ciclo, extraer la parte común a `shared/`.

## Estructura de directorios

```
src/
├── app/          Next.js App Router (delgado, delega a features)
├── features/     Un directorio por vertical slice
├── shared/       Primitivos agnósticos al dominio (ui, lib, hooks, config)
└── db/           Esquema Neon (Postgres), migraciones, cliente (acceso TBD)
```

## Límites de tamaño

- Archivo: máximo 300 líneas
- Función: máximo 60 líneas
- Feature completa: máximo 1500 líneas
- Servicio/módulo en `shared/`: máximo 800 líneas

Superar un límite es señal de que hay que dividir.

## Cookies de sesión cross-subdomain (regla a reinstaurar)

> El proveedor de auth es **TBD**. Cuando se elija, esta regla se reescribe con los detalles concretos. Se conserva el principio porque la arquitectura multi-tenant por subdomain lo va a requerir igual.

**Principio:** cualquier cookie de sesión compartida entre el apex y los subdomains de place DEBE setear `Domain=<apex>` explícito (resuelto desde `NEXT_PUBLIC_APP_DOMAIN`; `place.community` en prod, sin domain en dev local).

**Por qué:** cookies host-only (sin `Domain`) en un subdomain place sobrescriben las del apex. Por **RFC 6265 § 5.3 step 6** las host-only tienen precedencia y aparecen primero en el `Cookie` header, así que el código de sesión puede leer una cookie host-only (potencialmente inválida) en vez de la apex correcta. Cuando se reimplemente auth, agregar un test guard estático que falle el build si se emite una cookie de sesión sin `Domain`.

## Streaming agresivo del shell

Patrón **obligatorio** para pages de detalle (thread, library item, member detail, etc.). El objetivo es que el browser pinte skeletons inmediato (~150-300ms FCP) en vez de esperar a que todas las queries del page resuelvan antes de ver algo.

### La regla

Las pages de detalle tienen **un único `await` top-level**: la validación de existencia (typically `loadPlaceBySlug` + `findXBySlug`). Todo el resto vive en componentes async bajo `<Suspense fallback={<Skeleton />}>`.

```tsx
// ✅ correcto — patrón canónico
export default async function DetailPage({ params }: Props) {
  const { placeSlug, slug } = await params
  const place = await loadPlaceBySlug(placeSlug) // cached cross-request
  if (!place) notFound()

  const entity = await findEntityBySlug(place.id, slug) // cached
  if (!entity) notFound()
  if (entity.shouldRedirect) permanentRedirect(entity.canonicalUrl)

  return (
    <Layout>
      <HeaderBar
        rightSlot={
          <Suspense fallback={null}>
            <EntityHeaderActions entity={entity} placeSlug={placeSlug} />
          </Suspense>
        }
      />
      <Suspense fallback={<EntityContentSkeleton />}>
        <EntityContent entity={entity} place={place} placeSlug={placeSlug} />
      </Suspense>
      <Suspense fallback={<CommentsSkeleton />}>
        <CommentsSection placeId={place.id} placeSlug={placeSlug} entityId={entity.id} />
      </Suspense>
    </Layout>
  )
}
```

```tsx
// ❌ anti-patrón — todo el shell bloquea
export default async function DetailPage({ params }: Props) {
  const { placeSlug, slug } = await params
  const place = await loadPlaceBySlug(placeSlug)
  const [entity, viewer, opening, related] = await Promise.all([   // ← bloquea
    findEntityBySlug(place.id, slug),
    resolveViewerForPlace({ placeSlug }),
    findOrCreateCurrentOpening(place.id),
    fetchRelatedData(...),
  ])
  // 700-1500ms aquí antes de pintar nada
  return <Layout>...</Layout>
}
```

### Convenciones de archivos

- `page.tsx` — sólo composición. Top-level await mínimo (validación + redirect). Idealmente ≤80 LOC.
- `_<entity>-content.tsx` — Server Component async con el body principal. Resuelve viewer + data específica. Throws `notFound()` si la lógica adicional rechaza (ej: post oculto + non-admin).
- `_<entity>-header-actions.tsx` — Server Component async para el `rightSlot` del header bar (kebab admin, action menus). Suspense fallback es `null` (slot vacío durante loading).
- `_skeletons.tsx` — exporta skeletons matched-dimension. Un export por sección streamed. Sin shimmer agresivo (cozytech: nada parpadea).
- `_comments-section.tsx` (cuando aplica) — Suspense child con la sección de comments + reactions + readers. Firma de props mínima `{ placeId, placeSlug, entityId }`; resuelve internamente viewer + opening (deduped via `React.cache`).
- `loading.tsx` — **eliminar**. Los skeletons de Suspense lo reemplazan limpio. Mantener `loading.tsx` causa doble transición visual.

### Cómo dedupean queries entre Suspense children

Los 3 Suspense children del page suelen compartir queries (ej: `resolveViewerForPlace`). `React.cache` per-request dedupea: aunque cada child llame `resolveViewerForPlace({ placeSlug })`, **una sola query física** ocurre por request. Dejar que cada child fetchee lo que necesita; no obsesionarse con pasar todo desde el page.

### Manejo de `notFound` y `permanentRedirect`

- **Top-level (síncrono después del await)**: 99% de los casos van acá (entity no existe, redirect cross-zona). UX limpio: el browser nunca ve skeletons antes del 404/308.
- **Desde Suspense child**: aceptable para casos raros (post oculto + viewer non-admin, item archivado + viewer non-author). Hay flicker (skeleton → 404) pero el caso es marginal.

### Implementaciones de referencia

Aún no existen (reset a scaffold limpio). La primera page de detalle que se construya con este patrón queda como implementación canónica y se referencia acá.

## Regla de sesiones

- Una sesión = una cosa. Nunca mezclar capas (UI + lógica, DB + API, migración + feature).
- Si un cambio toca más de 5 archivos o cruza backend/frontend, partir en múltiples sesiones.
- Si una funcionalidad no cabe cómodamente en el 70% de la ventana de contexto, dividir.
- Al terminar, auto-verificar: `pnpm test`, `pnpm typecheck`, y reportar líneas de archivos tocados.

## Documentos de detalle

Cada área técnica tiene su propio documento. Leer el relevante antes de implementar.

- [`docs/stack.md`](stack.md) — stack técnico completo y variables de entorno
- [`docs/multi-tenancy.md`](multi-tenancy.md) — routing por subdomain, DNS, middleware
- [`docs/data-model.md`](data-model.md) — schema SQL del core e invariantes del dominio
- [`docs/ontologia/`](ontologia/) — documentos canónicos de cada objeto (conversaciones, eventos, miembros)
- [`docs/landingpage/`](landingpage/) — arquitectura y contenido de la landing pública

Otros docs (feature-flags, billing, realtime, notifications, theming, roadmap) se eliminaron en el reset y se reescriben cuando la feature correspondiente se reconstruya.

## Checklist de validación por feature

Antes de dar por terminada una feature, verificar:

- [ ] Todos los archivos viven dentro de `src/features/<feature>/`
- [ ] No hay imports cruzados hacia archivos internos de otras features
- [ ] Ningún archivo supera 300 líneas ni función 60
- [ ] Feature completa ≤ 1500 líneas
- [ ] Dependencias externas son solo `db/`, `shared/` y otras features vía `public.ts`
- [ ] Existe spec en `docs/features/<feature>/`
- [ ] Respeta los principios no negociables (ver `CLAUDE.md`)
- [ ] `pnpm test` y `pnpm typecheck` pasan en verde
