# Roadmap del MVP

Orden de construcción priorizado para minimizar bloqueos y permitir iteración. Cada fase es aproximadamente una semana, ajustar al ritmo real.

## Fase 1 — Infraestructura ✅

- Next.js 15 + TypeScript strict + Tailwind
- eslint con `no-restricted-paths`
- Supabase proyecto creado, variables de entorno configuradas
- Prisma con schema inicial (User, Place, Membership, PlaceOwnership, Invitation)
- Supabase Auth configurado (magic link como primer método)
- Middleware de Next.js para routing multi-tenant por subdomain
- Wildcard DNS en Vercel (staging primero)
- Layout base + tema default con CSS variables

**Entregable**: `prueba.place.app` responde, hay login, se crea user en DB.

## Fase 2 — Places + Members ✅

- Feature `places`: crear, listar, archivar
- Feature `members`: invitar por email, aceptar invitación, salir del place
- Ownership: múltiples owners, transferir ownership (validación de que el target es miembro)
- Roles: MEMBER, ADMIN
- Invariante de 150 miembros max enforceado en el modelo
- Perfil contextual del miembro (sin bio, solo lo que hizo)
- **Invitaciones vía Resend + `generateLink` de Supabase** — el SMTP de Supabase queda solo como generador de URLs (bypass de sus rate limits). Fallback automático `invite → magiclink` para users que ya existen en `auth.users`. Botón "Reenviar" en `/settings/members`. Webhook `POST /api/webhooks/resend` actualiza `Invitation.deliveryStatus`. Ver `docs/decisions/2026-04-20-mailer-resend-primary.md`. ✅ (2026-04-20)

**Entregable**: podés crear un place, invitar a alguien, sumarse, multi-admin funciona.

## Fase 2.5 — Hours (horario de apertura del place) ✅ (2026-04-21)

Implementar según `docs/features/hours/spec.md`:

- Shape JSON en `Place.openingHours`: `unconfigured` | `always_open` | `scheduled { timezone, recurring, exceptions }`.
- Utility pura `isPlaceOpen(hours, now)` + `nextOpeningWindow` (IANA timezone-aware).
- Validación Zod en el borde: timezones allowlist, `start < end`, sin overlap, fechas únicas en excepciones.
- CRUD admin: `/settings/hours` con form de timezone + ventanas recurrentes + excepciones.
- **Hard gate** total al contenido fuera de horario vía route group `(gated)/` en `src/app/[placeSlug]/`. Admin/owner mantiene acceso SOLO a `/settings/*`; member queda fuera de todo.
- `<PlaceClosedView>` con variants `member` / `admin` (con CTA a `/settings/hours`).
- Helper `assertPlaceOpenOrThrow(placeId)` exportado para que conversaciones (Fase 5) y eventos (Fase 6) defiendan sus server actions.
- Corrección de ontología: fuera del horario **no hay acceso al contenido**, ni siquiera lectura.

**Entregable**: un place nace cerrado; el owner configura horario desde settings; el gate funciona para member y admin con las reglas correctas.

## Fase 3 — Billing

- Feature `billing` con los tres modos
- Stripe integrado: productos, customers, subscriptions
- Stripe Connect Express para modos 2 y 3
- Flow de crear place incluye selección de billing mode
- Webhooks de Stripe para sincronizar estado
- Estados del place: `trial`, `active`, `pending_billing`, `suspended`, `archived`

**Entregable**: creás un place con cualquiera de los tres modos y las suscripciones funcionan.

## Fase 4 — Feature flags (en paralelo con Fase 3)

- `features.config.ts` como registro central
- Settings del place con toggle por feature
- El producto (portada, zonas) lee el registro y renderiza según config

**Entregable**: un place puede encender/apagar features y la UI responde.

## Fase 5 — Discussions (foro) ✅ (2026-04-22, C.H cierra la red de tests; C.H.1 flows adicionales pendiente)

Implementar según `docs/features/discussions/spec.md` (spec canónico) y `docs/ontologia/conversaciones.md` (ontología).

- Vocabulario **Post** (título + body rich text opcional) y **Comment** (body obligatorio, con cita opcional).
- Editor **Lexical + JSON AST** en `body jsonb`. Renderer SSR con visitor pattern AST → JSX (sin runtime de Lexical en server). Allowlist estricta por surface (per-instance via `initialConfig.nodes`). Embeds (YouTube/Spotify/Apple Podcasts/Ivoox) toggleables por place vía `Place.editorPluginsConfig`. Migración desde TipTap registrada en `docs/decisions/2026-05-06-tiptap-to-lexical.md` y `docs/plans/2026-05-06-tiptap-to-lexical-migration.md`. Modelo canónico en `docs/features/rich-text/spec.md`.
- **Citas tipo WhatsApp** con snapshot congelado al momento de responder (borde ámbar). Profundidad máx 1.
- **Reacciones**: set cerrado de 6 emojis (👍❤️😂🙏🤔😢). UNIQUE `(target, user, emoji)`.
- **Ventana de edición autor 60s**; tras 60s solo admin (delete para Comment; edit O delete para Post — admin no reescribe contenido ajeno, solo hide/delete).
- **Moderación humana**: hide (soft reversible) + delete (soft irreversible UI) para Post; delete para Comment. Usuarios pueden flaggear con motivo; admin revisa cola en `/settings/flags`.
- **Lectores de la apertura actual**: dwell ≥ 5s en thread → `PostRead` idempotente `(postId, userId, placeOpeningId)`. Requiere tabla `PlaceOpening` y helper `currentOpeningWindow` exportado por `hours/public.ts` (agregado en C.A).
- **Vivo/dormido** (30 días) derivado, no columna. Cualquier Comment reactiva actualizando `Post.lastActivityAt` en la misma transacción.
- **Realtime** Supabase acotado según `docs/realtime.md`: canal `post:<id>` con presencia (burbuja borde verde) + broadcast de comments nuevos emitidos desde server action post-commit.
- **Dot indicator** client-side comparando `lastReadAt` del user con `Post.lastActivityAt`. Sin contador.
- **Paginación** cursor keyset `(createdAt DESC, id DESC)`, 50 comments por página. Sin infinite scroll.
- **RLS por tabla** (6 entidades: Post, Comment, Reaction, PlaceOpening, PostRead, Flag). Multi-tenant enforcement a nivel DB; service role bypass para jobs.
- **Optimistic locking** (`version int`) para update de Post/Comment.
- **Horario** ya gated por hours; server actions de escritura llaman `assertPlaceOpenOrThrow(placeId)` como defensa en profundidad.
- **Erasure 365d** vía `authorUserId` nullable + `authorSnapshot` congelado al `leftAt` (implementa la parte que toca a discussions; el job vive en `members/`).
- **Observabilidad** pino estructurado por action; eventos listos para `AuditLog` global cuando exista (gap agendado).
- **Errores estructurados** nuevos: `EditWindowExpired`, `PostHiddenError`, `PostDeletedError`, `InvalidQuoteTarget`, `FlagAlreadyExists`, `RichTextTooLarge`, `InvalidMention`.

**Entregable**: foro completo sin audio, con moderación humana activa, realtime acotado, RLS, audit-ready.

**Sub-milestones de Fase 5:**

- **C.A** — Schema Prisma + RLS policies (6 entidades). ✅
- **C.B** — Dominio + Zod del AST + invariantes puras. ✅
- **C.C** — Queries server-side (find/list) + mappers. ✅
- **C.D** — 13 server actions con revalidate, optimistic lock, audit. ✅
- **C.E** — UI camino feliz: lista, detalle, composer TipTap, citas, reacciones, delete propio <60s, slug + URL `/[placeSlug]/conversations/[postSlug]`. ✅ (2026-04-20)
- **C.F** — Realtime presencia (private channels + RLS sobre `realtime.messages`) + dwell tracker 5s + dot indicator unread + hook `findOrCreateCurrentOpening` en `(gated)/layout`. Broadcast de nuevos comments se descartó del MVP (registrado en `docs/features/discussions/spec.md § 13`). ✅ (2026-04-20)
- **C.F.1** — Fix dot indicator: `PostRead` upsert monótono (`DO NOTHING` → `DO UPDATE SET readAt = now(), dwellMs = GREATEST(...)`) + invariante 20 (`lastActivityAt` sólo lo bumpean creación de Post/Comment). Repro: user A lee → user B comenta → dot aparece → user A re-lee → dot no se apagaba dentro de la misma apertura. ADR: `docs/decisions/2026-04-20-post-read-upsert-semantics.md`. ✅ (2026-04-20)
- **C.F.2** — Request-scoped identity cache: `getCurrentAuthUser` y `loadPlaceById` en `shared/lib/`, más `findActiveMembership` / `findPlaceOwnership` / `findUserProfile` en `shared/lib/identity-cache.ts`, todos envueltos en `React.cache`. `findInviterPermissions` (members) y `resolveActorForPlace` (discussions) recompuestos sobre estos primitives; pages `/conversations` y `/conversations/[postSlug]` pasan `placeSlug` al resolver para compartir el cache de `loadPlaceBySlug` que ya hidratan los layouts. Un GET a `/conversations` baja de ~15 queries totales a 8 y evita el "Suspense boundary" abort por exceso de round-trips en pgbouncer. ADR: `docs/decisions/2026-04-20-request-scoped-identity-cache.md`. ✅ (2026-04-20)
- **C.G** — Moderación UI: `FlagButton` discreto en `PostDetail` + `CommentItem`, `FlagModal` con Radix Dialog (Zod + `useTransition` + Sonner), cola admin `/settings/flags` con `FlagQueueItem` (ignorar / ocultar / eliminar). `reviewFlagAction` ampliado con `sideEffect` transaccional (HIDE_TARGET / DELETE_TARGET) — aplica la review + update del target en la misma `prisma.$transaction`. Split del sub-slice `features/flags/` (backend migrado desde discussions; `public.ts` client-safe + `public.server.ts` server-only por el chain de `server-only` que Next traza al bundle cliente). ADR: `docs/decisions/2026-04-21-flags-subslice-split.md`. ✅ (2026-04-21)
- **C.G.1** — Moderación inline: `PostAdminMenu` (kebab en `PostDetail` con Editar / Ocultar / Eliminar) + `CommentAdminMenu` (kebab en `CommentItem` con Eliminar). Post delete pasó a **hard delete** (cascade de comments + postReads vía FK, cleanup polimórfico de reactions + flags en la misma tx) — desapareció la columna `Post.deletedAt` y el estado `DELETED`. `reviewFlagAction` con `sideEffect: DELETE_TARGET` sobre POST delega en `hardDeletePost` tras reclamar el flag. Edit/Delete bypasean la ventana de 60s para admin (`canEditPost` + `canDeleteContent` con admin-bypass existente). Cola `/settings/flags` con tabs Pendientes/Resueltos + paginación 20 (cursor keyset). Edit del post vive en `/conversations/new?edit=<postId>` — la misma página sirve crear y editar. `shared/ui/dropdown-menu.tsx` nuevo primitive Radix. ADR: `docs/decisions/2026-04-21-post-hard-delete.md`. ✅ (2026-04-21)
- **C.H** — E2E Playwright + RLS tests directos con JWT alterno. Infra production-ready sobre `my-place` Cloud: `/api/test/sign-in` con gate doble + 9 casos unit, seed E2E aditivo FK-safe con prefijos reservados (`usr_e2e_*`, `place_e2e_*`, `/^e2e-.*@e2e\.place\.local$/`), harness RLS `pg` + `SET LOCAL request.jwt.claims` sobre `DIRECT_URL` con **72 casos directos** cubriendo las 16 policies + 2 helpers (`is_active_member`, `is_place_admin`). Playwright `globalSetup` seedea + loguea los 6 roles a `storageState`. 24 tests E2E verdes × 2 browsers (chromium + mobile-safari): smokes (health, auth, middleware-routing, auth-storageState) + `flows/post-crud` MVP. CI job `e2e` rescripted con branches Supabase efímeras vía Management API (`scripts/ci/branch-helpers.sh`): `create → poll → fetch env → migrate → seed → rls → e2e → delete (always())`, `concurrency.cancel-in-progress` evita branches leaked. ADR: `docs/decisions/2026-04-22-e2e-rls-testing-cloud-branches.md`. ✅ (2026-04-22)
- **C.H.1** — Flows E2E adicionales sobre la infra de C.H. 6 spec files × 13 tests × chromium: `post-crud` (3 + test de ventana 60s vía `backdatePost` + post propio del spec), `hours-gate` (3 sobre Belgrano, `setPlaceClosedByKey` / `setPlaceAlwaysOpen`), `admin-inline` (2 — kebab admin + autor no-admin), `comment-reactions` (2 — comment seedeado + reaction persiste en DB), `moderation` (2 — owner reporta + admin ve en cola), `invite-accept` (1 — admin completa form + Invitation creada con token). Aislamiento real por spec: cada flow crea su propio post con slug dedicado (`*-spec-post`) + `deletePostBySlug` + `afterAll` con `deletePostById` cascade. Prisma singleton compartido entre helpers (`tests/helpers/prisma.ts`) evita saturar el pooler. `playwright.config.ts` excluye `flows/**` de mobile-safari vía `testIgnore` (WebKit + Next dev + Radix tiene fricciones conocidas; smokes siguen corriendo en ambos browsers). CI se beneficia del mismo setup. Decisión Mobile-safari coverage pendiente en C.H.2. ✅ (2026-04-22)
- **C.H.2** — Mobile-safari coverage de flows. Diagnóstico instrumentado descartó la hipótesis inicial (Next dev + Radix + WebKit streaming). Causa raíz real: race condition en `UNIQUE(placeId, slug)` cuando chromium y mobile-safari corrían `beforeAll` en paralelo sobre el mismo slug fijo. Fix: slugs per-project (`${spec}-${browserName}`) en `comment-reactions`, `admin-inline`, `moderation`. Removido `testIgnore: ['**/flows/**']`. Timeouts de modal close y poll bumpeados para variance WebKit emulado (más lento bajo paralelismo vs chromium). **48 tests verdes** ambos browsers. ADR `docs/decisions/2026-04-22-mobile-safari-webkit-flows.md`. ✅ (2026-04-22)
- **C.J** — Broadcast de `comment_created` en realtime. `src/shared/lib/realtime/` expone primitivos transport-agnostic (`BroadcastSender` / `BroadcastSubscriber`) con impls Supabase (HTTP REST `/realtime/v1/api/broadcast` en server + WS subscribe en cliente) y fakes para tests. Semantic layer `features/discussions/server/realtime.ts` (`broadcastNewComment`) + hook `useCommentRealtime` con dedupe por `commentId` y sync con `initialItems` del SSR. `revalidatePath` sigue como fuente autoritaria — broadcast es optimización best-effort (errores se tragan con `pino.warn`). Feature flag `DISCUSSIONS_BROADCAST_ENABLED` para rollback sin deploy. ADR `docs/decisions/2026-04-21-shared-realtime-module.md`. ✅ (2026-04-21)
- **C.K** — Bloque "Leyeron" en `PostDetail` — feature core de la ontología (`conversaciones.md § Tres`) hasta ahora faltante. Query `listReadersByPost({postId, placeId, placeOpeningId, excludeUserId?})` con filter de ex-miembros (`Membership.leftAt IS NULL`) y orden `readAt DESC`. Server Component `PostReadersBlock` renderiza hasta 8 avatares sin borde verde (distinto de `ThreadPresence`) clickeables a `/m/<userId>`; empty/unconfigured → `null`; overflow `+N más`. `markPostReadAction` ahora emite `revalidatePath` tras cada dwell (bloqueante: sin revalidate el bloque no actualiza). Cross-place isolation cubierto por RLS (nuevo caso 7 en `tests/rls/post-read.test.ts`). ✅ (2026-04-21)
- **C.L** — Erasure 365d (derecho al olvido estructurado). `Membership.erasureAppliedAt` + tabla `ErasureAuditLog` con `snapshotsBefore` para rollback manual. Job `runErasure` con advisory lock Postgres + tx all-or-nothing per-membership + safety threshold (`leftAt > now() - 10 años`) + skipeo de places archivados. Vercel Cron diario (`/api/cron/erasure` con `?dryRun=true` support, 03:00 UTC) + cron audit semanal (`/api/cron/erasure-audit`, domingo 04:00 UTC) que detecta fallas silenciosas del primario (Vercel no reintenta 5xx). **Interpretación funcional del contrato**: RLS + filters existentes ya invisibilizan al ex-miembro en `Reaction`/`PostRead`/`Flag` — no se borra físicamente; el job sólo nullifica `authorUserId` + renombra `authorSnapshot.displayName` a "ex-miembro" en Post/Comment. Gate del endpoint por header `CRON_SECRET` con timing-safe compare. ADR `docs/decisions/2026-04-24-erasure-365d.md`. ✅ (2026-04-24)

**Fuera de esta fase** (v2 o descartado): audio, temporadas, UI dedicada de dormidos, búsqueda full-text, DMs, push/email, analytics visibles, rich text con imágenes/tablas.

## Fase 6 — Eventos ✅ (2026-04-26, F.A → F.E completas)

Implementar según `docs/ontologia/eventos.md`. Spec canónico:
`docs/features/events/spec.md` (+ sub-specs `spec-rsvp.md`,
`spec-integrations.md`). Plan completo:
`~/.claude/plans/tidy-stargazing-summit.md`.

**Scope F1 (lo que se construye en esta fase)**:

- Schema `Event` + `EventRSVP` + enum `RSVPState` con CHECK constraint sobre `note`.
- RLS sobre Event y EventRSVP (7 policies, helpers `is_active_member` + `is_place_admin`).
- 4 estados RSVP texturados alineados con ontología: `GOING / GOING_CONDITIONAL / NOT_GOING_CONTRIBUTING / NOT_GOING` + textfield opcional para los 2 condicionales.
- Server Actions: createEventAction (con auto-thread tx atómica via discussions), updateEventAction, cancelEventAction (soft-cancel), rsvpEventAction (upsert).
- UI: listado próximos/pasados, detalle, crear, editar, RSVP button con 4 estados.
- Estado derivado calculado (no persistido): upcoming / happening / past / cancelled. Default 2h cuando endsAt null. Sin buffer pre-startsAt (sin urgencia artificial).
- Timezone strategy: `timestamptz` UTC + columna `timezone` IANA del evento (eventos = puntos en tiempo, distinto a hours = patterns recurrentes).
- Erasure 365d extendido para Event + EventRSVPs (per-place, no global).
- Eventos reportables vía `EVENT` agregado a `ContentTargetKind` (flags).
- Helper transaccional `createPostFromSystemHelper` agregado a discussions.
- Helper genérico `assertNever` agregado a `shared/lib/`.

**Sub-milestones de Fase 6**:

- **F.A** — Spec-first ✅ (2026-04-25). `docs/features/events/spec.md` (+ `spec-rsvp.md` + `spec-integrations.md`) + ADR excepción cap LOC (`docs/decisions/2026-04-25-events-size-exception.md`).
- **F.B** — Schema + 2 migrations (CREATE TABLE separada de `ALTER TYPE ContentTargetKind` por restricción Postgres) + 7 RLS policies + 9 tests RLS ✅ (2026-04-25).
- **F.C** — Domain + invariants + state-derivation + queries + 4 actions (create con auto-thread tx, update, cancel, rsvp) + extensiones cross-slice: PR-1 `createPostFromSystemHelper` en discussions con `resolveUniqueSlug` parametrizable, PR-2 `EVENT` en `ContentTargetKind` con switch exhaustivo + `mapEventSnapshot` + `assertNever` helper genérico en shared, PR-3 `runErasure` extendido para Event + DELETE EventRSVP per-place (no global) + smoke script extendido. 53 tests nuevos ✅ (2026-04-25).
- **F.D** — UI listado próximos/pasados + detalle + crear + editar + 4 estados RSVP texturado con textfield condicional + cancel inline + Playwright smoke. Refactor de `hours/public.ts` split client/server (mismo patrón flags/discussions) para que Client Components no arrastren `import 'server-only'` al bundle ✅ (2026-04-25).
- **F.E** — Relación bidireccional Event↔Post: `findPostBySlug`/`findPostById` incluyen `Post.event` (subset `{id,title,cancelledAt}`); `PostDetail` renderiza banner "Conversación del evento: …" + badge "Cancelado" inline cuando aplica. ADR `docs/decisions/2026-04-26-events-discussions-cotransaction.md` documenta el patrón de tx atómica cross-slice como precedente. 6 tests integration nuevos ✅ (2026-04-26).
- **F.F** — Refactor "el evento ES el thread" detectado durante prueba manual. URL canónica del evento pasa a ser `/conversations/[postSlug]`; `/events/[eventId]` queda como redirect 308 (backward-compat). NUEVO `EventMetadataHeader` (Server Component) montado arriba del `PostDetail` cuando `Post.event` poblado — agrupa fecha, RSVP, descripción, acciones admin/author en un solo lugar. `getEvent` extiende su return con `postSlug` para evitar round-trips. Banner inline antiguo en `PostDetail` removido (reemplazado por header completo). Listado y form de crear/editar redirigen al thread. ADR `docs/decisions/2026-04-26-events-as-thread-unified-url.md` documenta el reframing. Spec § 11 actualizado ✅ (2026-04-26).
- **F.G** — Design handoff rebrand global ✅ (2026-04-27). Aplica el design package en `handoff/events/` como source of truth: paleta warm-brown (`--accent: #b5633a`), oklch surfaces, Fraunces serif + Inter, member palette de 8. `ThemeConfig` extendido para preservar theming per-place via JSONB. `globals.css` con `@supports` fallbacks (Safari <16.4 / Chrome <111). Tailwind extend con tokens nuevos + `place-*` aliases backward-compat. Shared primitives nuevos (`Avatar` puro, `SectionHead`, `BentoGrid/Card`, `OverlineTag`) en `shared/ui/`. `MemberAvatar` wrapper en `members/public.ts` (boundary clean: shared no conoce "miembro"). Events list = bento grid con primer evento `hero`. Event metadata header rediseñado con calendar tile + attendee avatars overlap + "van N" sin bold + descripción serif. RSVPButton restyle compact (4 estados intactos, layout 2x2 mobile / 1x4 sm+, `motion-safe:transition-colors`). lucide-react instalado (política: nuevos íconos = lucide; SVG inline migra oportunísticamente). 25 tests nuevos (Avatar, helpers de date, EventDateTile, AttendeeAvatars). 8 commits atómicos (F.G-0 → F.G-7). ADR `docs/decisions/2026-04-27-design-handoff-rebrand.md` documenta el rebrand + decisiones de producto (RSVP 4 estados confirmado, F.F preservado, tokens como source of truth).

**Entregable**: feature de eventos F1 completa — CRUD + RSVP texturado + thread auto + listado + relación bidireccional + visual del handoff aplicado. Diferido en post-F1: recurrencia, UI 3 momentos contextual, memoria fresca, archive físico, exclusiones granulares, permisos por rol granulares, ICS export, realtime presence, notificaciones, recordatorios, cupo máximo, reacciones sobre Event, eventos all-day como tipo dedicado, cover visual, naturaleza presencial/virtual como discriminador, density variants (data-density), theme variants (data-theme), dark mode auto, WCAG contrast validation real, custom tooltip primitive, migración masiva SVG → lucide.

## Roadmap macro post-F.G — Replicar handoff/ en el producto

Documento de planificación maestra: `~/.claude/plans/tidy-stargazing-summit.md`. Define las fases R.1 → R.7 que llevan el producto del estado post-F.G al diseño completo del `handoff/`. R.5 (Library UI scaffold) cerrado 2026-04-30; R.7 (Library backend completo + admin CRUD + items editoriales con embeds) cerrado 2026-04-30 — uploads propios (Wasabi BYO storage) diferidos a R.7.X.

- **R.1 — Migración visual a tokens del rebrand F.G** ✅ (2026-04-26). Refactor mecánico de tokens `place-*` legacy → tokens canónicos (`bg`/`text`/`surface`/`muted`/`border`/`accent`/etc.) en todos los consumers del codebase (~50 archivos). Aliases `--place-*` se mantienen como compat layer en `globals.css` y `theme.ts`. Excepciones intencionales: `--place-presence` (verde fijo de presencia), `--place-unread` (naranja fijo de unread), `--place-danger` (con fallback hex), clase CSS `place-mention` (identifier semantic). Sub-fases:
  - **R.1.A** (commit `f17099b`): discussions/ui (20) + shared/ui (3 — dialog, dropdown-menu, toaster).
  - **R.1.B** (este commit): events/ui (3) + flags/ui (3) + hours/ui (1) + src/app/\* (17) + audit final + update docs/{theming,roadmap}.md.
- **R.2 — App shell común (`_shell`)** — R.2.0 → R.2.3 cerrados; R.2.5.0 → R.2.5.4(A) cerrados; R.2.5.4(B) manual QA mobile real pending (depende de deploy a Vercel).
  - **R.2.0 — Spec del shell** ✅ (2026-04-26). `docs/features/shell/spec.md` (15 secciones) + ADR `docs/decisions/2026-04-26-shell-introduction.md`. Decisiones (consultadas al user): subdomain preservado (vs path-based del handoff), dots como links a URLs existentes (swipe diferido a R.2.5), skip status bar iOS cosmético, mobile-first con `max-w-[420px] mx-auto` centrado en desktop. Mount strategy: `[placeSlug]/layout.tsx` (parent del gated, cubre `/settings/*`). Data: consume `listMyPlaces` ya disponible en `places/public.ts` — no requiere extender slice.
  - **R.2.1 → R.2.3** ✅ (commits `b5a5e53` / `f43a7c4` / `c96aefd`). Slice `src/features/shell/` con UI primitivos puros + mount en parent layout (Promise.all + `listMyPlaces`) + cleanup de headers locales redundantes en pages migradas en R.1.B.
  - **R.2.5 — Swipe horizontal entre zonas** — implementación cerrada; manual QA mobile real pending (depende de deploy).
    - **R.2.5.0 — Spec del swiper** ✅ (2026-04-26). `docs/features/shell/spec.md` § 16 (11 sub-secciones) + ADR `docs/decisions/2026-04-26-zone-swiper.md` (9 decisiones formalizadas + alternativas). Decisiones consultadas al user: `framer-motion@^11` (vs hand-rolled / @use-gesture), bounce elástico (vs hard-stop / cycle), freshness vía Next route cache + refresh condicional (recomendada por mí con cost analysis: Realtime per-zona DIFERIDO). Gap crítico descubierto en audit: Next 15 cambió route cache default a 0s — requiere `experimental.staleTimes.dynamic: 30` explícito.
    - **R.2.5.1 — Componentes** ✅ (commit `fa5af24`). `framer-motion@^11.18.2` instalado. `shell/domain/swiper-snap.ts` (pure logic + 21 tests). `shared/ui/top-progress-bar.tsx` (delayed indicator + 7 tests). `shell/ui/swiper-viewport.tsx` (framer-motion drag con dragConstraints dinámicos + useReducedMotion). `shell/ui/zone-swiper.tsx` (wrapper público con error boundary + scrollByZone Map + lastVisitedAt + prefetch on pan start). Bundle baseline +1KB shared.
    - **R.2.5.2 — Mount + staleTimes** ✅ (commit `ed83fec`). `experimental.staleTimes.dynamic: 30` en next.config. `<ZoneSwiper>` envuelve `{children}` en `(gated)/layout.tsx`. `loading.tsx` removido de zonas root (revertido en R.2.5.2-fix).
    - **R.2.5.2-fix — Pivote skeleton + dot sync** ✅ (commit `511d480`). En primera prueba real: dot activo no actualizaba al snap (`usePathname` queda viejo durante `startTransition`) + sin skeleton la pantalla quedaba frozen 4-12s en dev (pgbouncer high-latency). Fix coupled: `router.push` directo (sin `startTransition`) → `usePathname` actualiza inmediato → dot sync. Skeletons restaurados (`conversations/loading.tsx` + nuevo `events/loading.tsx`). `useEffect` → `useLayoutEffect` en SwiperViewport para reset x=0 sin flash. `<TopProgressBar>` deprecated para R.2.5 (componente persiste por si futuro caller lo usa). Spec § 16.4 + ADR Decisión 6 invertida con fecha + razón. Memory feedback nuevo: `loading_states_validate_with_real_data`. Lección: validar transitions UX con datos reales antes de eliminar loading states.
    - **R.2.5.3 — Prefetch on dot hover/focus** ✅ (commit `85edd09`). `<SectionDots>`: `useRouter().prefetch(zone.path)` en `onMouseEnter` + `onFocus` por dot inactivo (skip si activo o disabled). 4 tests nuevos. `lastVisitedAt` + `scrollByZone` + `router.refresh()` condicional ya estaban en R.2.5.1.
    - **R.2.5.4 part A — E2E Playwright** ✅ (commit `6a002c6`). `tests/e2e/flows/zone-swipe.spec.ts` con 6 tests (12 totales × 2 browsers): dot click navigation, dot sync post-nav, sub-page pass-through, settings sin dot activo, nav cíclica. Gesture real (drag/swipe touch) fuera de scope automatizado: flaky en CI por timing del spring de framer-motion; manual QA en device real es la fuente de verdad.
    - **R.2.5.4 part B — Manual QA mobile real** PENDING (depende de deploy a Vercel). Checklist en spec § 16.10: iOS Safari (touch-action pan-y, sin pull-to-refresh, sin browser back-gesture), Chrome Android (swipe no conflicta con scroll vertical), rotación, multi-touch, swipe interrumpido, edge bounce visible.
    - **R.2.5.5 — Cleanup + roadmap** ✅. Sub-fases marcadas; manual QA real es el único item pending.
  - **R.2.6 — FAB cross-zona con menú contextual** ✅ (2026-04-26) — implementación cerrada; manual QA del overlap toaster pending (depende de prueba en device real).
    - **R.2.6.0 — Spec del FAB** ✅ (commit `4bbe26a`). `docs/features/shell/spec.md` § 17 (11 sub-secciones) + ADR `docs/decisions/2026-04-26-zone-fab.md` (4 decisiones + alternativas). Decisiones consultadas al user: reemplaza CTAs (no coexisten), solo zonas root, ícono `Sparkles` (no `+` ni hamburger). Marca `docs/features/discussions/spec.md` § 21.8 follow-up FAB ✅.
    - **R.2.6.1 — Componentes** ✅ (commit `7823937`). `<FAB>` primitive en `shared/ui/` (Radix-based, 56×56 column-aware via `right: max(12px, calc(50vw - 198px))` Tailwind arbitrary, sombra dual sutil idéntica a `<PageIcon>`, asChild aplicado al button directo para ARIA correcto). `<ZoneFab>` orquestador en `shell/ui/` (visibilidad gated por `isZoneRootPath` reusado de R.2.5, items hardcoded MVP). `shell/public.ts` exporta `ZoneFab`. 19 tests unit nuevos.
    - **R.2.6.2 — Mount + remove CTAs + E2E** ✅ (commit `1eca7ce`). `<ZoneFab>` montado en `(gated)/layout.tsx` sibling al `<ZoneSwiper>`. Removidos CTAs inline ("Nueva" en `<ThreadsSectionHeader>`, "Proponer evento" en `events/page.tsx`). Skeletons actualizados sin placeholder del CTA. E2E: `post-crud.spec.ts` y `events-create-rsvp.spec.ts` actualizados (assert FAB en vez de Link); `hours-gate.spec.ts` extendido con asserts de FAB visible/invisible + catchup post-R.6.3 ("Conversaciones" → "Discusiones"); nuevo `zone-fab.spec.ts` con 11 tests (22 totales × 2 browsers).
    - **R.2.6.3 — Cleanup + roadmap** ✅. Sub-fases marcadas; manual QA del overlap con Sonner toaster bottom-right pending (depende de device real — opciones de mitigación documentadas en spec § 17.9: mover toaster a top-right o subir FAB a bottom-24).
- **R.3 — Home / portada (`home`)** — pendiente. Spec `docs/features/home/spec.md` antes de código.
- **R.4 — Search (overlay global)** — pendiente. Spec `docs/features/search/spec.md` antes de código + migration DB fulltext.
- **R.5 — Library UI scaffold (zona + categoría)** ✅ (2026-04-30). Slice nuevo `src/features/library/` UI-only (decisión user: solo UI hoy, backend cuando exista lo conectamos sin tocar componentes). 4ª zona "Biblioteca" sumada al shell — accesible por dot + swipe. Spec en `docs/features/library/spec.md` (9 secciones documentando scope, componentes, empty states, R.5.X follow-ups). Sub-fases:
  - **R.5.0 — Plan + decisiones del user** ✅ (2026-04-30). Plan `~/.claude/plans/tidy-stargazing-summit.md` (R.5). Decisiones consultadas al user: empty state sin CTA "Subir el primero" (no inducimos a accionar uploads que no existen), label "Biblioteca" (español alineado con resto del shell), sin stubs de queries (UI pura hasta que exista backend).
  - **R.5.1 — Spec + slice scaffolding** ✅. `docs/features/library/spec.md` NEW. Slice `src/features/library/` con `domain/types.ts` (`DocType`, `LibraryCategory`, `LibraryDoc`) + 11 componentes UI (Server Components salvo `<TypeFilterPills>` Client) + 5 tests unit + `public.ts`. Reuso de primitives existentes (`<PageIcon>`, `<BackButton>`, `<TimeAgo>`, divider patterns, URL state pattern de `<ThreadFilterPills>`).
  - **R.5.2 — Routes + 4ª zona** ✅. `ZONES` extendido a 4 con `{index:3, label:'Biblioteca', path:'/library'}`. `ZoneIndex` literal `0|1|2|3`. `deriveActiveZone` reconoce `/library*`. Routes nuevos: `/library/page.tsx` (estructura JSX completa con conditionals, hardcoded `categories: []` + `recents: []` → renderiza `<EmptyLibrary>` hoy) y `/library/[categorySlug]/page.tsx` (`notFound()` directo sin backend; spec documenta el shape completo para cuando exista). Tests del shell actualizados (`zones.test`, `swiper-snap.test`, `section-dots.test`). E2E `zone-swipe.spec` + `zone-fab.spec` cubren `/library`. ZoneFab automáticamente visible en la nueva zona (consume `ZONES.map(z=>z.path)`).
  - **R.5.3 — Cleanup + roadmap** ✅. Verificación final: typecheck + lint + 906 tests + boundaries + build prod limpios.
  - **R.5.X follow-ups → cerrados en R.7 (2026-04-30)**: Backend (schema + migrations + RLS + queries + actions), Item detail page, Admin CRUD de categorías, CTA "Crear el primero" condicional. Ver R.7 abajo para detalles + lo que sigue diferido (uploads propios → Wasabi BYO storage, search, bulk actions, stats internas).
- **R.6 — Rediseño layout threads (handoff threads + threads-detail)** ✅ (2026-04-26).
  - **R.6.0 — Spec del rediseño** ✅. `docs/features/discussions/spec.md` § 21 + ADR `docs/decisions/2026-04-26-threads-layout-redesign.md`. Decisiones consultadas al user: 6 emojis preservados (F.A) vs ♥ del handoff; featured heurístico (primer thread por `lastActivityAt`) sin admin pinning; filtros incrementales (solo "Todos" funcional); header detail dentro del shell. Cierra el gap del roadmap macro original (R.1 fue solo tokens, no layout).
  - **R.6.1 — Data shape extendida** ✅. `PostListView` agrega `snippet` (richTextExcerpt 140 chars), `commentCount` (excluye soft-deleted), `readerSample` (top 4 readers de la apertura), `isFeatured` (derivado, primer post por `lastActivityAt`). `listPostsByPlace` extendido con sub-queries paralelas vía `Promise.all`.
  - **R.6.2 — Componentes shared** ✅. `<BackButton>` en `shared/ui/` (client, `useRouter().back()` con fallback `<Link>`) + `<BackLink>` server variant. `<ReaderStack>` en `discussions/ui/` (vive en el slice porque consume `<MemberAvatar>` — boundary clean: shared no conoce "miembro").
  - **R.6.3 — Threads list rewrite** ✅. Nuevos: `<ThreadsSectionHeader>` (chip 56×56 + título Fraunces 38px + CTA), `<ThreadFilterPills>` (3 pills, solo "Todos" funcional), `<FeaturedThreadCard>` (primer post con bento card), `<ThreadRow>` (resto sin card chrome, hairline divider), `<EmptyThreads>` (emoji 🪶). Export `PostList` reescrito (nombre preservado). `<PostCard>` eliminado. Page `/conversations` reducida. `loading.tsx` actualizado. Split `members/public.ts` + `public.server.ts` (precedente flags) para que el chain Server Component → MemberAvatar no rompa bundle cliente.
  - **R.6.4 — Thread detail rewrite** ✅. `<ThreadHeaderBar>` (sticky 56px, BackButton + slot derecho con `<PostAdminMenu>`). Restyle de `<PostDetail>` (Fraunces 28px, body spacing), `<CommentThread>` (divider + label "{n} RESPUESTAS" caps), `<CommentItem>` (avatar 28×28 sin card chrome), `<QuotePreview>` (border-l-2 accent + italic muted), `<ReactionBar>` (chips planos, 6 emojis intactos), `<PostReadersBlock>` (reusa `<ReaderStack>`, max 5 + "{n} leyeron"). `<CommentComposer>` `fixed bottom-0` con `safe-area-inset-bottom` + send button round 40×40 con icono `Send` lucide. **Gap shell viewport resuelto**: `<main>` cambió de `overflow-hidden` → `overflow-x-hidden` (preserva clip horizontal previsto para swipe R.2.5, libera scroll vertical para fixed/sticky). Tests adaptados (`post-readers-block.test.tsx` reescrito para el nuevo shape de avatares).
  - **R.6.5 — Cleanup + verificación** ✅. Typecheck + lint + 788 unit tests + boundaries + build prod limpios. Spec § 21 actualizado con diff descubierto. Manual QA del thread detail confirmado por user.
  - **Follow-up post-R.6: FAB "+" cross-zona** — anotación de producto (no in-scope de R.6). Reemplazar las CTAs "Nueva" embebidas por SectionHeader (conversaciones, eventos, etc.) por un único botón flotante "+" en el shell, que al tocarlo abre un menú de acciones según zona y permisos ("Nueva discusión", "Proponer evento", "Subir documento", etc.). Vive en `shared/ui/` como primitivo `<FAB>` + slice `actions/` que registra opciones por zona. Requiere su propio mini-spec + ADR (posicionamiento safe-area iOS, focus trap, variantes por permiso). Anotado en `docs/features/discussions/spec.md` § 21.8.
  - **Follow-up post-R.6: avatar del viewer en `<CommentComposer>`** — la spec § 21.2 original incluye un `MemberAvatar` 36×36 a la izquierda del editor. Diferido en R.6.4 porque el composer hoy no recibe info del viewer. Evaluar si suma a la UX antes de implementar; requiere extender la signature del composer + pasar viewer desde la page.
- **R.7 — Library backend completo (categorías + items editoriales + embeds)** ✅ (2026-04-30). Convierte la Library de UI scaffold (R.5) a feature funcional end-to-end. Modelo central: el item ES un thread documento (Post enriquecido con cover + categoría) — reuse masivo de discussions (TipTap, comments, reactions, presence, erasure 365d, slugs). Embeds intercalados en el body como TipTap custom node, sin tabla aparte. Sin uploads propios — solo embeds externos (YouTube, Vimeo, Drive, Dropbox, Google Doc/Sheet, link genérico). Decisión user: storage propio diferido a R.7.X+ (BYO Wasabi). Sub-fases:
  - **R.7.0 — Spec extendido** ✅ (commit `452aa10`). `docs/features/library/spec.md` extendido con secciones 10-16 (modelo de datos, permisos, editor + embed custom node, cross-zona y URL canónica, sub-fases R.7.1 → R.7.11, excepción cap de tamaño). Tag `pre-R.7` marca el punto de retorno.
  - **R.7.1 — Schema + RLS de LibraryCategory** ✅ (commit `f08bfcd`). Migration `20260430000000` con `LibraryCategory` + `LibraryCategoryContributor` + enum `ContributionPolicy` (`ADMIN_ONLY` | `DESIGNATED` | `MEMBERS_OPEN`) + CHECK constraints (title 1..60, emoji 1..8, slug regex kebab) + 6 RLS policies usando helpers `is_active_member` / `is_place_admin`. 17 tests RLS verdes.
  - **R.7.2 — Backend de categorías** ✅ (commit `bf7bc8f`). Domain (`types`, `invariants` con cap 30, `errors`, `slug` con kebab + reserved, `permissions` puros), Zod schemas (4 inputs), queries server-only (`listLibraryCategories` + `findBySlug` + `findById` + `count` + `listContributors` + `listContributorUserIds`), 4 actions (create/update/archive/reorder). Public split `public.ts` + `public.server.ts`. 35 tests unit nuevos.
  - **R.7.3 — Admin UI: CRUD de categorías** ✅ (commit `02c54ff`). Page `/settings/library` con header + contador "N de 30" + CTA gateado por cap. Componentes admin (`<CategoryListAdmin>`, `<CategoryFormDialog>` Client crear/editar con react-hook-form + Dialog Radix, `<ArchiveCategoryButton>` con confirm). Mappers de policy labels + descripciones + `friendlyLibraryErrorMessage`. Reordering drag-and-drop diferido a R.7.3.X (sin `@dnd-kit` por ahora; action `reorderLibraryCategoriesAction` ya implementada).
  - **R.7.4 — Designated contributors UI** ✅ (commit `913707e`). Server actions `inviteContributorAction` (idempotente con manejo P2002) + `removeContributorAction`. Query batch `listContributorsByCategoryIds(ids[])` para precarga sin N+1. `<ContributorsDialog>` (Client) con autocomplete sobre miembros activos + optimistic update + rollback en error. Botón "Contribuidores" en row admin solo si policy=DESIGNATED. Cross-slice nuevo: library importa `MemberAvatar` (members/public) + `listActiveMembers` (members/public.server).
  - **R.7.5 — Schema + RLS de LibraryItem** ✅ (commit `7fd3c08`). Migration `20260430010000` con tabla `LibraryItem` (placeId + authorUserId denormalizados; postId UNIQUE; FKs CASCADE/RESTRICT/CASCADE). Sin XOR SQL contra Event — la exclusividad (Post no es Event Y Item) se valida en domain. **Decisión técnica clave**: `authorUserId` denormalizado para que las RLS policies de UPDATE sean sin sub-queries (Postgres tiene un edge case con sub-queries en WITH CHECK que rompía el flujo, probado empíricamente). RLS SELECT incluye `OR authorUserId = auth.uid()` para evitar "blind write violation" cuando el author archiva su propio item. 12 tests RLS.
  - **R.7.6 — Backend de items** ✅ (commit `6def3a1`). Tipos finales `LibraryItemListView` (JOIN con Post) + `LibraryItemDetailView`. Invariante `validateItemCoverUrl` (http(s) only, cap 2000). Schemas Zod (createItem/updateItem/archiveItem) usan `richTextDocumentSchema` reusado. 4 queries (`listItemsByCategory`, `listRecentItems`, `findItemBySlug`, `findItemForAction`). 3 actions con tx atómica `Post + LibraryItem` reusando `createPostFromSystemHelper` (extendido con `originSystem='library_item'`). `listLibraryCategories` ahora retorna `docCount` real vía `_count` aggregate.
  - **R.7.7 — TipTap embed custom node** ✅ (commit `da3867b`). Parser puro `parseEmbedUrl(url)` para 6 providers + fallback `generic`. Schema TipTap extendido en discussions (block genérico, no library-específico). TipTap extension con `'use client'` directiva + NodeView Client + EmbedToolbar + Dialog form. Persiste `parsed.canonicalUrl` en el AST para que el renderer SSR no necesite re-parsear. 24 tests unit nuevos.
  - **R.7.8 — Compositor de items** ✅ (commit `3b1c50b`). Page `/library/[cat]/new` (Server, gate `canCreateInCategory`) + `<LibraryItemForm>` con título + cover URL opcional + `<LibraryItemEditor>` (StarterKit + Link + EmbedNodeExtension + toolbar formato + EmbedToolbar). Constantes `ITEM_TITLE_MIN/MAX_LENGTH` locales en library/domain (mismo valor que `POST_TITLE_*`) para que el form Client no arrastre `discussions/public` (server-only).
  - **R.7.9 — Item detail + cross-zona redirect** ✅ (commit `b7a7405`). Page `/library/[cat]/[itemSlug]` Server con render full (ThreadHeaderBar + Header + RichTextRenderer + ReactionBar + Readers + Comments). Edit page con gate canEditItem. `<ItemAdminMenu>` Client (kebab Editar + Archivar). RichTextRenderer SSR de discussions extendido con embed render (provider switch, sin parser — usa `attrs.url` canonical). `Post` type suma `libraryItem: PostLibraryItemLink | null` y `findPostBySlug` lo joinea. La page `/conversations/[postSlug]` detecta `post.libraryItem` y dispara `permanentRedirect(308)` a la URL canónica `/library/[cat]/[slug]` (asimetría intencional con eventos: items pertenecen a sub-zona).
  - **R.7.10 — Conexión zona /library con backend** ✅ (commit `74e84e6`). Pages swap del hardcoded `[]` por queries reales. `EmptyLibrary` con CTA admin "Crear primera categoría → /settings/library" condicional. `EmptyItemList` con CTA "Crear el primero →" gateado por `canCreateInCategory`. Adaptación R.5 → R.7: `RecentDocRow` → `LibraryItemRow` (toma `LibraryItemListView`, link a URL canónica, categoryEmoji como icon, suma author + commentCount). Eliminados componentes/tipos R.5 sin consumers (`FileIcon`, `RecentDocRow`, `DocList`, `EmptyDocList`, `TypeFilterPills`, `LibraryDoc`, `DocType`).
  - **R.7.11 — Cleanup + roadmap ✅** ✅. Final verify: typecheck + lint + 950 unit + 113 RLS + boundaries + build prod limpios. Roadmap actualizado.
  - **R.7.X follow-ups (post-R.7, pendientes)**:
    - **Reordering drag-and-drop de categorías**: la action `reorderLibraryCategoriesAction` ya está implementada (R.7.2). Falta sumar `@dnd-kit/core` + `@dnd-kit/sortable` + UI `<DraggableCategoryList>` en `/settings/library`.
    - **Storage propio (uploads de archivos)**: integración Wasabi o BYO storage. Hoy todos los recursos son embeds externos (decisión user 2026-04-30: evita costos incrementales hasta validar producto).
    - **`<ZoneFab>` item "Crear recurso en biblioteca"**: el FAB hoy ofrece "Nueva discusión" + "Proponer evento". Sumar "Crear recurso" obliga a elegir categoría primero — UX requiere diseño. Hoy el flow arranca desde `/library/[cat]/new` o desde el botón "Crear el primero" del empty state.
    - **Search integration**: cuando R.4 search overlay esté activo, indexar title + body de items + título de embed nodes.
    - **Lección con progress gating**: variante futura del embed custom node (atributo `requiresPreviousCompletion: bool` + tracking per-user de qué nodes vio cada miembro).
    - **Versionado de body**: editar pisa el body actual sin historial. Si producto pide history, R.7.X+.
    - **Bulk actions admin**: mover items entre categorías, archivar bulk, restaurar archivadas (UI específico).
    - **Realtime presence en item detail**: hoy ya reusa `<ThreadPresence>` de discussions; presence-en-vivo en el thread mismo es la base.
    - **Cover desktop rendering**: `coverUrl` se guarda en DB pero mobile no renderiza. La UI desktop que use el cover llega cuando exista layout desktop específico.
    - **Stats internas (admin-only)**: items más leídos por mes para audit, NO para gamificación.
    - **Restore de archivadas**: hoy soft-delete sin un flow de restore en UI (action no existe). R.7.X+ puede sumar `restoreCategoryAction` + `restoreItemAction`.

## Fase 7 — Portada y zonas

- Swipe horizontal entre zonas (portada + zonas por feature activa)
- Widgets en portada (miembros, discusión relevante, próximo evento)
- Onboarding overlay primera vez
- Navegación entre threads con backstack posicional
- Tema aplicado dinámicamente según config del place

**Entregable**: la experiencia del mockup viva y funcional.

## Fase 8 — Landing + onboarding

- Landing pública en `place.app`
- Flow de crear primer place con selección de billing
- Flow de aceptar invitación
- Dashboard del usuario en `app.place.app` con sus places

**Entregable**: un usuario nuevo puede llegar, crear su place, invitar, y empezar a usarlo.

---

## Lo que NO construimos en el MVP

Explícito para proteger scope. Cada cosa acá es tentación que hay que resistir:

- **Biblioteca con uploads propios.** R.7 (2026-04-30) entregó backend completo + admin CRUD de categorías + items editoriales con embeds externos (YouTube, Vimeo, Drive, Dropbox, Google Doc/Sheet, link genérico). Storage propio para uploads de archivos diferido a R.7.X+ (BYO storage tipo Wasabi) — decisión user para evitar costos incrementales hasta validar producto.
- **DMs entre miembros.** Mencionado en la ontología pero no MVP.
- **Cursos o módulos educativos.**
- **Integración con calendario externo** (Google Calendar, Apple Calendar).
- **App móvil nativa.** Web-first. PWA opcional en v2.
- **Búsqueda full-text.** Para v2 cuando los places tengan contenido acumulado.
- **Notificaciones push.** Principio anti-FOMO. Ver `notifications.md`.
- **Temporadas/anuarios con PDF.** Feature grande, v2.
- **Moderación algorítmica.** Nunca. La moderación es humana y del admin.
- **Analytics/dashboards de uso.** El producto no mide engagement.
- **Onboarding wizard complejo.** Arranca simple: nombre, slug, billing.
- **Cambio de billing mode** después de crear el place. v2.

## Gaps técnicos agendados

Tareas conocidas que quedan pendientes durante el MVP y que no bloquean la entrega
de ninguna fase, pero hay que retomar antes de dar el producto por maduro.

### Horario (Fase 2.5)

- **Refresh automático al `closesAt`.** Hoy el viewer que está navegando cuando
  llega la hora de cierre ve el contenido hasta que haga una nueva request. Hacer
  un `setTimeout` client-side que dispare `router.refresh()` al instante de cierre
  (o un intervalo corto mientras la pestaña esté visible). Análogo para
  apertura: miembro esperando fuera del horario ve el gate hasta refresh manual.
- **Audit trail de cambios de horario.** Cuando exista la tabla `AuditLog`
  (gap agendado en Fase 2), incluir `placeHoursUpdated` con antes/después. Hoy
  solo se logea con pino — no queryable para compliance.
- **Rate limiting de `updatePlaceHoursAction`.** Extender el rate limit
  compartido (gap existente) a este action. Propuesta: max 10 updates por admin
  por hora. Previene floods accidentales de `revalidatePath` sobre el layout.
- **Habilitar `alwaysOpen` en UI.** El shape ya lo soporta y `isPlaceOpen` lo
  interpreta; falta toggle + confirmación de "esto desactiva el horario" en
  `settings/hours`. Decisión de producto pendiente.
- **Cross-midnight windows sin partir en dos.** Hoy una ventana que cruza
  medianoche se escribe como dos ventanas (SAT 22:00–23:59 + SUN 00:00–01:00).
  Aceptar `{start:'22:00', end:'01:00'}` implica cambiar el invariante y el
  render.
- **Feriados automáticos por país.** Integrar `date-holidays` o similar para
  pre-poblar excepciones según `timezone` / país detectado.
- **Multi-timezone por place.** Un place con una sede en Madrid y otra en BA
  hoy tiene que elegir una sola timezone. Fuera de scope MVP.

### Discusiones (post-C.F)

- **Wrap `listPostsByPlace` con `React.cache`.** Hoy lo llama solo el page
  `/conversations`. Cuando aparezca un segundo caller en la misma request (p.ej.
  widget de "novedades" en portada, panel admin de moderación), envolver con
  `cache()` — mismo patrón que `findOrCreateCurrentOpening`. Evita groupBy
  duplicado del `PostRead` por viewer.
- **Broadcast de `comment_edited` y `comment_deleted`.** `comment_created` ya
  viaja via broadcast (C.J, 2026-04-21). Extender el evento tipado en
  `shared/lib/realtime` no requiere cambios al layer. El hook
  `useCommentRealtime` ganaría un switch sobre `event` y un reducer que
  aplica `edited` (replace body + bump version) o `deleted` (flag placeholder).
- **Optimistic insert en `CommentComposer`.** Hoy el emisor ve su comment
  ~300ms tras submit via su propio broadcast. UX polish: insertar en state
  local al submit + reconciliar cuando llega el broadcast (dedupe por
  `commentId` del server response). Complejidad baja, valor marginal en MVP.
- **Migrar `thread-presence.tsx` a `SupabaseBroadcastSubscriber` del shared.**
  Hoy abre el canal inline — funciona pero duplica la lógica de lifecycle.
  Consolidar en el shared tras alguna iteración más de uso real.
- **Telemetría de emit/fail rate de broadcast.** Eventos pino
  `commentBroadcast{Emitted,Failed}` están estructurados para export a
  Grafana / Datadog cuando se decida observabilidad activa.
- **Retry policy en `broadcastNewComment`.** Hoy best-effort sin retry. Si
  las métricas muestran tail elevado de fail-rate, considerar 1 reintento
  con backoff corto (no bloqueante del action).
- **E2E Realtime con 2 browser contexts (C.I).** Playwright con dos `context`
  concurrentes para validar que el comment del emisor aparece en el viewer
  sin reload. Agendado a futuro por complejidad de timing + cleanup.
- **Cron de cierre de `PlaceOpening` sin tráfico.** Hoy el opening se cierra al
  próximo `findOrCreateCurrentOpening`; si el place no recibe tráfico durante
  muchos días, el opening queda abierto nominalmente. No afecta el funcionamiento
  (el gate se deriva del horario, no del opening). Valorar un job periódico.

### Global

- **Rate limiting compartido** para todos los server actions sensibles (invite,
  create-place, transfer-ownership, update-hours).
- **AuditLog general.** Tabla + helpers para registrar mutaciones críticas
  (archivado, transferencia, cambios de horario, expulsiones cuando existan).
- **Desarchivar place.** Hoy `archivedAt` es monótono.
- **Anti-squatting de slugs.** Cuando aparezca el requerimiento.
- **`QueryClientProvider` global cuando aparezca el primer cliente real de
  TanStack Query.** Hoy `docs/stack.md:20` lo nombra aspiracionalmente pero no
  hay un provider montado. `DwellTracker` usa `useTransition` (decisión
  registrada en `docs/decisions/2026-04-24-dwell-tracker-usetransition.md`);
  revisar esa decisión cuando se monte el provider.

## Cómo evaluar cuándo pasar de MVP a v2

Pasamos a v2 cuando:

- Hay al menos 5-10 places activos usándolo regularmente
- Los feedbacks convergen en features puntuales (no 50 pedidos distintos)
- El MVP es estable, sin bugs críticos pendientes
- Tengo claridad sobre qué agregar primero basado en uso real

No antes. Resistir la tentación de agregar features durante el MVP.
