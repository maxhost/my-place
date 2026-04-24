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
- Editor **TipTap + JSON AST** en `body jsonb`. Renderer SSR con `@tiptap/html`. Allowlist estricta de extensions (paragraph, headings h2/h3, lists, blockquote, code, link, mention). Reutilizable en docs internos y descripción de eventos (Fase 6).
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

## Fase 6 — Eventos

Implementar según `docs/ontologia/eventos.md`:

- Crear evento (presencial, virtual, híbrido)
- Fecha/hora con timezone awareness
- Confirmación texturada: voy / voy si puedo / no voy pero aporto / no voy
- Thread del foro auto-generado al crear evento (integración con conversations)
- Tres momentos: antes, durante, después
- Rituales con recurrencia
- Acumulación cálida sin gamificación

**Entregable**: feature de eventos completa con los tres momentos.

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

- **Biblioteca de documentos.** Fuera del core, queda para v2.
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
