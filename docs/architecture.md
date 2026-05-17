# Arquitectura de Place

Paradigma: **Modular Monolith con Vertical Slices**. Priorizamos calma, estabilidad y mantenibilidad por una sola persona.

Este documento es el índice de las decisiones arquitectónicas. El detalle de cada área vive en `docs/`.

> _Última actualización: 2026-05-17._ Documento vivo: si un cambio de código afecta una decisión de esta página, se actualiza **en la misma sesión** y se ajusta la fecha. Un doc viejo desinforma al agente — los specs stale causan fallos silenciosos.

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

**Mecanismo VERIFICADO EMPÍRICAMENTE (2026-05-16, probe sobre branch Neon de prueba).** El SDK server de Next.js (`@neondatabase/auth@0.4.x`) instala un route handler **first-party** (`app/api/auth/[...path]/route.ts` = `auth.handler()`) que emite la cookie **en nuestro dominio**. `createNeonAuth({ cookies: { domain: ".place.community", secret } })` setea el `Domain`. Observado real: **con** `cookies.domain` → `Set-Cookie: __Secure-neon-auth.session_token=…; Domain=.lvh.me; HttpOnly; Secure; SameSite=Strict` (y `__Secure-neon-auth.local.session_data` JWT, `Max-Age=299`); **sin** `cookies.domain` → mismas cookies **sin** `Domain=` (host-only). El dominio vive **solo en código** (no en Console/MCP). ADR-0001 §1 confirmado y verificado, sin replanteo. El test-guard de build es necesario: la doble cookie host-only es el modo por default y rompería el apex (RFC 6265 §5.3).

**Corrección (2026-05-16): `trusted_origins` SÍ acepta wildcard.** El reporte previo de "sin wildcard" era **incorrecto**. El validador de `configure_neon_auth` es autoritativo: acepta `https://*.example.com` (wildcard de subdominios), `http://localhost`/`127.0.0.1`/`[::1]`, y deeplinks de esquema custom; rechaza `http://` no-localhost, host-only/TLD-only wildcards y esquemas peligrosos. Por lo tanto **`https://*.place.community` es un único trusted origin válido** → no hay que enumerar subdominios y no hay gap. La topología "dos mundos de sesión" se mantiene; mantener el login/redirect concentrado en `auth.place.community` sigue siendo una buena práctica defensiva, pero **no es una mitigación obligatoria** (ya no hay gap que mitigar). Los custom domains se allowlistan con su origin `https://` al verificar el dominio (ya previsto).

**Gotcha (cookies `__Secure-`).** Neon Auth prefija las cookies con `__Secure-`; los browsers **rechazan** cookies `__Secure-` sobre `http://` plano. En dev local hay que servir por **HTTPS** (mkcert o equivalente) o las sesiones no persisten en el browser. Canónico: `docs/gotchas/neon-auth-secure-cookie-https.md`.

**Identidad:** `app_user` (identidad de producto) tiene relación 1:1 con la identidad de login de Better Auth — ver `docs/data-model.md` § "Auth y OIDC". Invariante: un humano = un `app_user`, sin importar por qué dominio entró.

**TBD acotado (se decide al implementar auth):** firma de ID tokens (JWT plugin, RS256 vs EdDSA) — detalle de implementación, no afecta la topología.

## Onboarding del owner y saga de signup

Canónico en **ADR-0005** + **ADR-0008** (dos vías de entrada). En el apex `place.community`, i18n bajo `[locale]`, wizard 100% client-side hasta el submit.

**La creación NO es una transacción única, y NO hay "hook" de Neon Auth.** Neon Auth es un servicio **gestionado** sin webhooks ni hooks server-side (verificado, ADR-0006); el dueño de la identidad de login es Neon Auth (schema `neon_auth`), el core vive en `public`. La provisión de `app_user` la **orquestamos nosotros** en nuestro Server Action de signup. Orden canónico de la saga:

1. Nuestro Server Action llama `auth.signUp.email()` (Neon Auth) → devuelve la identidad sincrónicamente.
2. En la misma request, tx de app (`public`): **upsert idempotente** de `app_user` 1:1 (`auth_user_id` → `neon_auth.user.id`, ref. lógica cross-schema) + handle random (ADR-0002).
3. Tx de app (`public`): `place` + `place_ownership` + `membership`, con invariantes (reserved-slugs, slug único, máx 150, mínimo 1 owner).

**Guard JIT `ensureAppUser(authUserId)`** (primitivo de `shared/lib`, idempotente, dedupeable vía `React.cache`): se invoca en **toda entrada autenticada** (signup, login posterior, invitación, "join", reintentos) antes de cualquier op de dominio. Invariante: *ninguna operación de dominio corre sin `app_user`*. Falla parcial: si falla el paso 3, la cuenta queda creada (estado "creá tu place", no error fatal); si falla el 1, nada se persiste. Idempotente por `email` único (Neon Auth) y `auth_user_id UNIQUE`. Email verification **no bloquea el alta**: gatea solo las mutaciones de `/settings` (chequeo `neon_auth.user.emailVerified`), vía Resend. Asistencia LLM del onboarding = **propose-only** (paleta + borrador de descripción; **no** horario — ADR-0007), confirmada por el humano (reconciliación del principio en `producto.md` / ADR-0005 §6). `opening_hours` se setea por default 09:00–20:00 en el tz del owner al crear el place (ADR-0007), editable luego en `/settings`. Detalle canónico del mecanismo de provisión: **ADR-0006**.

**Dos modos de saga (ADR-0008).** Hay dos vías de entrada y la saga corre distinto:

- **Modo place-first (CTAs de la landing):** usuario no autenticado → wizard place-first → al submit único corre la saga completa (pasos 1-3: `signUp` → `app_user` → place+ownership+membership). La cuenta se crea al final.
- **Modo authed (item "Acceso" → login form → signup account-first → "Crear mi place"):** la identidad y `app_user` ya existen (vía `ensureAppUser`). La saga se **reduce al paso 3** (tx de place+ownership+membership); no se re-pide cuenta. La rama "Unirme" = solo directorio (futuro), deshabilitada; las invitaciones se entran por su token-link, no desde "Acceso" (ADR-0010 §3).

`ensureAppUser` hace ambos modos seguros (idempotente). Detalle de vías y RLS: ADR-0008/0010, `docs/features/onboarding/`.

## Routing multi-tenant (en alcance de la tanda de registro)

ADR-0005 mete el routing host-based en el alcance: estructura `(marketing)` / `(app)`, middleware host-based (apex → marketing/onboarding; `{slug}.place.community` → place; `app.` → inbox), wildcard DNS/Vercel. El middleware i18n actual (solo landing) se integra con el host-based. Detalle de URLs y estructura de rutas: `docs/multi-tenancy.md`.

## RLS y modelo rol/JWT (fundamento de auth)

Canónico en **ADR-0006**; spec operativa en `docs/multi-tenancy.md`. Reglas que toda feature respeta:

- **RLS incremental, base owner desde S1.** Base: `app_user` solo accesible por su dueño (`auth.user_id() = app_user.auth_user_id`); tablas con `place_id` solo accesibles por el owner de ese place (predicado vía `place_ownership`). El acceso de **miembros** se agrega por-feature **encima**; la base no concede nada a miembros.
- **Rol Postgres custom no-admin** para queries de dominio (sin `BYPASSRLS`). `neondb_owner` solo para migraciones. El backend verifica el JWT con **JWKS** e inyecta los claims en la transacción; las policies leen `auth.user_id()`.
- **Sin Data API y sin rol `anon`.** Todo acceso de dominio es autenticado y verificado server-side. `anon` no recibe grants → no es superficie de riesgo.
- Las queries a la DB se hacen desde `queries.ts`/`actions.ts` del feature (regla de aislamiento), nunca con el rol admin, siempre tras `ensureAppUser`.

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
