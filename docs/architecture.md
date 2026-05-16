# Arquitectura de Place

Paradigma: **Modular Monolith con Vertical Slices**. Priorizamos calma, estabilidad y mantenibilidad por una sola persona.

Este documento es el índice de las decisiones arquitectónicas. El detalle de cada área vive en `docs/`.

> _Última actualización: 2026-05-16._ Documento vivo: si un cambio de código afecta una decisión de esta página, se actualiza **en la misma sesión** y se ajusta la fecha. Un doc viejo desinforma al agente — los specs stale causan fallos silenciosos.

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

Canónico en `CLAUDE.md` › Límites de tamaño. Superar un límite = dividir antes de continuar.

## Sesión y SSO

Auth provider: **Neon Auth** (sobre Better Auth) — ver `docs/stack.md`. Place actúa como **su propio OIDC Identity Provider** (plugin OIDC Provider de Better Auth): el modelo "Sign in with Google", pero el IdP somos nosotros.

**Dos mundos de sesión:**

- **`*.place.community` (subdomains + inbox):** una sola sesión compartida vía **cookie cross-subdomain** `Domain=place.community`. El inbox (`app.place.community`) y `{slug}.place.community` comparten esa cookie — **no son RPs OIDC**. El IdP central vive acá (`auth.place.community`).
- **Custom domains (`community.empresa.com`):** registrable domain distinto, no puede compartir la cookie apex. Cada custom domain es un **Relying Party OIDC** con su propio client confidencial (`client_id`/`secret` propios, `redirect_uri` exacta), **provisionado por el backend en el flujo de verificación del dominio** (ver `docs/multi-tenancy.md`). Un client por dominio: aislamiento por tenant, revocación quirúrgica, sin blast radius, exact redirect-URI match.

**Flujo de SSO (solo custom domains):** custom domain sin sesión local → redirect al IdP → si el IdP ya tiene sesión, emite auth code **silencioso** (sin re-prompt) → callback en el custom domain → setea su **propia sesión local** scopeada a su host. Un solo login en el IdP → SSO silencioso a todos los places del miembro, con o sin dominio propio.

**Por qué no rompe "inbox universal" ni el aislamiento:** el SSO cross-domain ocurre vía el flujo OIDC (auth code → tokens), **no compartiendo cookies cross-domain**. Cada custom domain mantiene su sesión local aislada; lo único compartido es la sesión del IdP. El inbox universal (ontología en `docs/ontologia/miembros.md`) vive en `app.place.community` → se alcanza con la cookie compartida del apex, o vía SSO silencioso desde un custom domain.

**Cookie del IdP:** la sesión del IdP/apex DEBE setear `Domain=place.community` explícito (sin `Domain` en dev local; resuelto desde `NEXT_PUBLIC_APP_DOMAIN`). Test guard que falle el build si se emite sin `Domain`: una cookie host-only (sin `Domain`) en un subdomain sobrescribe la del apex (RFC 6265 §5.3, host-only tienen precedencia y van primero en el header `Cookie`).

**Identidad:** `app_user` (identidad de producto) tiene relación 1:1 con la identidad de login de Better Auth — ver `docs/data-model.md` § "Auth y OIDC". Invariante: un humano = un `app_user`, sin importar por qué dominio entró.

**TBD acotado (se decide al implementar auth):** firma de ID tokens (JWT plugin, RS256 vs EdDSA) — detalle de implementación, no afecta la topología.

## Gate de horario del place

Fuera del horario, **el miembro** no accede al place: cualquier ruta no-settings devuelve `<PlaceClosedView>`. **El owner es la excepción: accede al place completo fuera de horario** (discusiones, eventos, miembros, settings) — lo ve como si estuviera abierto. No hay rol "admin"; la administración delegada será una feature futura de grupos.

**Regla técnica:** el gate vive a nivel del place en `[placeSlug]/(gated)/layout.tsx`, **no por feature**. Cada feature confía en que el layout ya validó el acceso; no reimplementa la verificación de horario. El comportamiento de producto (qué ve cada rol fuera de horario) es canónico en `docs/ontologia/conversaciones.md`.

## Presupuesto de performance

Objetivo: una page con sus queries a la DB renderiza y carga en **≤200ms**. Es el NFR que motiva dos decisiones de abajo: el patrón de streaming agresivo del shell (FCP inmediato sin esperar queries) y la co-location de Neon en la misma región que las Functions (ver `docs/stack.md` § Región). Toda page nueva se mide contra este presupuesto.

## Streaming agresivo del shell

Patrón **obligatorio** para pages de detalle (discusión, item de biblioteca, detalle de miembro, etc.). El objetivo es que el browser pinte skeletons inmediato (~150-300ms FCP) en vez de esperar a que todas las queries del page resuelvan antes de ver algo.

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
- `_<entity>-content.tsx` — Server Component async con el body principal. Resuelve viewer + data específica. Throws `notFound()` si la lógica adicional rechaza (ej: post oculto + viewer sin permiso de moderación).
- `_<entity>-header-actions.tsx` — Server Component async para el `rightSlot` del header bar (kebab de moderación del owner, action menus). Suspense fallback es `null` (slot vacío durante loading).
- `_skeletons.tsx` — exporta skeletons matched-dimension. Un export por sección streamed. Sin shimmer agresivo (cozytech: nada parpadea).
- `_comments-section.tsx` (cuando aplica) — Suspense child con la sección de comments + reactions + readers. Firma de props mínima `{ placeId, placeSlug, entityId }`; resuelve internamente viewer + opening (deduped via `React.cache`).
- `loading.tsx` — **eliminar**. Los skeletons de Suspense lo reemplazan limpio. Mantener `loading.tsx` causa doble transición visual.

### Cómo dedupean queries entre Suspense children

Los 3 Suspense children del page suelen compartir queries (ej: `resolveViewerForPlace`). `React.cache` per-request dedupea: aunque cada child llame `resolveViewerForPlace({ placeSlug })`, **una sola query física** ocurre por request. Dejar que cada child fetchee lo que necesita; no obsesionarse con pasar todo desde el page.

### Manejo de `notFound` y `permanentRedirect`

- **Top-level (síncrono después del await)**: 99% de los casos van acá (entity no existe, redirect cross-zona). UX limpio: el browser nunca ve skeletons antes del 404/308.
- **Desde Suspense child**: aceptable para casos raros (post oculto + viewer sin permiso, item archivado + viewer non-author). Hay flicker (skeleton → 404) pero el caso es marginal.

### Implementaciones de referencia

Aún no existen (reset a scaffold limpio). La primera page de detalle que se construya con este patrón queda como implementación canónica y se referencia acá.

## Checklist de validación por feature

Antes de dar por terminada una feature, verificar:

- [ ] Todos los archivos viven dentro de `src/features/<feature>/`
- [ ] No hay imports cruzados hacia archivos internos de otras features
- [ ] Respeta los límites de tamaño (ver `CLAUDE.md`)
- [ ] Dependencias externas son solo `db/`, `shared/` y otras features vía `public.ts`
- [ ] Existe spec en `docs/features/<feature>/`
- [ ] Respeta los principios no negociables de experiencia (ver `docs/producto.md`)
- [ ] `pnpm test` y `pnpm typecheck` pasan en verde
