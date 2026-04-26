# Co-transacción atómica events ↔ discussions (auto-thread)

**Fecha:** 2026-04-26
**Milestone:** Fase 6 / F.E (auto-thread bidireccional)
**Autor:** Max

## Contexto

La ontología de eventos (`docs/ontologia/eventos.md` § "Momento 1 — Preparación
colectiva") dice:

> El evento genera automáticamente un **thread en el foro** del place. Este
> thread es el espacio de preparación colectiva, y después se transforma en
> memoria del evento.

Esto requiere que al publicar un evento se creen dos rows correlacionados en
slices distintos:

1. `Event` (slice `events`).
2. `Post` (slice `discussions`) como thread asociado.
3. `Event.postId` apuntando al `Post.id`.

Si las operaciones no son atómicas, podemos quedar con:

- **Evento huérfano** sin thread → la conversación nunca arranca; el botón
  "Ver conversación del evento" rompe.
- **Thread huérfano** sin evento → el Post existe en `/conversations` con
  título "Conversación: …" pero el link al evento dice 404.
- **Ambos creados pero `postId = null`** → desincronización silenciosa entre
  los dos rows; la UI muestra el evento sin link y el thread sin badge.

Cualquiera de estos estados degrada la garantía ontológica de "thread vive
junto al evento" y obliga a cleanup manual via SQL admin.

## Decisión

**`createEventAction` ejecuta los 3 INSERTs/UPDATEs en una sola
`prisma.$transaction(async (tx) => …)`**. El cliente transaccional (`tx`)
viaja explícitamente al `createPostFromSystemHelper` del slice discussions:

```ts
const result = await prisma.$transaction(async (tx) => {
  const event = await tx.event.create({ data: { ..., postId: null } })

  const post = await createPostFromSystemHelper(tx, {
    placeId: actor.placeId,
    title: `Conversación: ${event.title}`,
    body: buildEventThreadIntroBody({ id: event.id, title: event.title }),
    authorUserId: actor.actorId,
    authorSnapshot,
    originSystem: 'event',
    originId: event.id,
  })

  await tx.event.update({
    where: { id: event.id },
    data: { postId: post.id },
  })

  return { eventId: event.id, postSlug: post.slug }
})
```

Cualquier excepción dentro del callback dispara rollback automático de
Postgres — ningún row queda persistido.

## Razones

1. **Atomicidad real, no eventual.** Una "tx eventual" (crear Event, luego
   crear Post fuera de tx, retry on failure) es propensa a estados huérfanos
   por timing/network/crash. Postgres tx es la garantía más fuerte y barata.

2. **Helper transaccional reutilizable.** `createPostFromSystemHelper` (PR-1
   en F.C) está diseñado para aceptar el `Prisma.TransactionClient` como
   primer parámetro. El `createPostAction` original (Server Action) usa el
   `prisma` singleton — no lo modificamos para no impactar consumers
   existentes; simplemente añadimos un helper paralelo. Discussions sigue
   exponiendo ambos vía `public.server.ts`.

3. **Boundary preservado.** Events NO toca el schema de Post directamente.
   Llama a `createPostFromSystemHelper` que encapsula:
   - Resolución de slug único (reusa `resolveUniqueSlug` parametrizado por
     client).
   - Construcción del Post con `authorSnapshot` congelado, `lastActivityAt`
     inicializado, body validado por `assertRichTextSize`.
   - Logging estructurado (`postCreatedFromSystem` con `originSystem` +
     `originId` para audit).
   - Retry una vez ante `P2002` por slug collision.

4. **Bypass del gate de `assertPlaceOpenOrThrow` adentro de la tx
   intencional.** El caller (`createEventAction`) ya gateó antes de abrir
   la tx. Re-gatear adentro sería defensa ridícula y ralentizaría la tx.

5. **`revalidatePath` fuera de la tx.** El cache busting de Next.js no debe
   dispararse antes del commit — sino el cliente ve el detail del evento
   antes de que el row exista. Llamamos `revalidatePath` después del
   `await prisma.$transaction(...)`.

## Decisiones derivadas (documentadas como invariantes en el thread)

### El Post NO se auto-actualiza cuando el Event cambia

Si el author edita `event.title` post-publicación, el `Post.title` queda
con el valor original ("Conversación: <título original>"). Razón:

- El Post ya tiene comentarios. Cambiar su título post-hoc rompe la
  conversación que la gente construyó alrededor del nombre original.
- La UI del Post muestra el banner "Conversación del evento: <event.title>"
  via la relación inversa (`Post.event`) — siempre refleja el título actual
  del evento sin tocar el Post.
- Es asimétrico al `quotedSnapshot.authorLabel` inmutable de citas (mismo
  principio: snapshot al momento de citar/crear, no se retro-edita).

`updateEventAction` documenta este comportamiento en su JSDoc.

### `quotedSnapshot` NO se afecta por cancelación del evento

Si alguien cita un comment del thread del evento y luego el evento se
cancela, la cita preserva el contenido tal cual estaba (mismo principio
que `quotedSnapshot.authorLabel` inmutable — ver `CLAUDE.md § Gotchas`).
La cita es snapshot histórico del momento, no se retro-edita.

### Soft-cancel preserva el Post

`cancelEventAction` setea `Event.cancelledAt = now()` exclusivamente. El
Post asociado **sigue vivo** — la conversación continúa ("lástima,
reprogramemos"). La UI del Post (vía `Post.event.cancelledAt`) muestra
badge "Cancelado" inline en el banner del thread.

### Relación bidireccional `Event.postId` ↔ `Post.event` (back-ref)

- `Event.postId String? @unique` con `Post @relation(...)`.
- `Post.event Event?` (back-reference inversa).
- Cuando el Post se elimina (hard delete), `onDelete: SetNull` en
  `Event.postId` asegura que el evento no se cae.
- `findPostBySlug`/`findPostById` incluyen `include: { event: { select:
{ id, title, cancelledAt } } }`. La UI tiene `post.event` en mano sin
  round-trips.

## Patrón aplicable a futuros pares de slices

Este patrón (slice A crea row, llama helper transaccional de slice B, hace
UPDATE para vincular) es replicable cuando dos slices necesitan
co-creación atómica. Casos hipotéticos a futuro:

- Eventos-ritual generan automáticamente un calendario recurrente (slice
  events ↔ slice calendar).
- Crear place autoseed un evento de "bienvenida" (slice places ↔ slice
  events).

Convenciones a respetar para nuevos helpers transaccionales:

1. Aceptar `Prisma.TransactionClient` como primer parámetro.
2. NO llamar gates de hours/membership (el caller gateó antes de abrir tx).
3. NO llamar `revalidatePath` (caller revalida tras commit).
4. Loggear con `originSystem` + `originId` para audit.
5. Exportar via `<slice>/public.server.ts` (server-only — el helper toca
   prisma).
6. Tests con mock `Prisma.TransactionClient` (ver
   `discussions/__tests__/create-from-system.test.ts`).

## Alternativas descartadas

1. **`createEventAction` llama `createPostAction` (Server Action) sin tx
   compartida.** Rechazado: el Post se commitea antes del UPDATE de
   `Event.postId`, abriendo ventana de inconsistencia.
2. **Outbox pattern: persistir un "job" que el cron ejecuta para crear el
   thread.** Overkill — la garantía de Postgres tx es más simple y más
   fuerte que cualquier worker eventual.
3. **`Event.postId` NOT NULL al crear, generar slug del Post antes del
   INSERT del Event.** Rechazado: requiere generar el slug desde events,
   duplicando la lógica de slug collision retry de discussions. Romper
   boundary innecesario.
4. **Webhook/event bus interno.** Overkill para co-creación atómica;
   eventos de dominio sirven para reacciones eventuales (notificaciones,
   etc.), no para garantías de consistencia inmediata.

## Verificación

- **Unit tests** (`events/__tests__/actions.test.ts`):
  - Test 10: happy path — la tx commitea ambos rows, `eventCreate` y
    `postCreate` son llamados, `eventUpdate` con `postId`.
  - Test 13: `createPostFromSystemHelper` throws → la tx propaga el
    error, `revalidatePath` no se llama, ningún row queda persistido.
  - Test 18: `cancelEventAction` setea `cancelledAt`, no toca Post ni
    RSVPs.

- **Unit tests del helper** (`discussions/__tests__/create-from-system.test.ts`):
  - Happy path bajo tx mock.
  - Slug collision retry.
  - Falla mid-tx propaga ConflictError.

- **Integration tests** (`discussions/__tests__/post-event-relation.test.ts`):
  - `findPostBySlug` incluye `event` poblado para Posts auto-creados.
  - `findPostBySlug` retorna `event: null` para Posts standalone.
  - `event.cancelledAt` se preserva como Date cuando el evento fue
    cancelado.
  - Regression guard sobre el shape del `include`.

- **E2E smoke** (`tests/e2e/flows/events-create-rsvp.spec.ts`):
  - Crear evento → redirect al detalle → link "Ver la conversación del
    evento" funciona → al hacer click navega al Post asociado.
  - Thread del evento muestra el banner "Conversación del evento: …".

## Referencias

- `docs/ontologia/eventos.md` § "Momento 1 — Preparación colectiva".
- `docs/features/events/spec.md` § 7 (flow create) + § 11 (UI rutas).
- `docs/features/events/spec-integrations.md` § 1 (auto-thread).
- `docs/decisions/2026-04-25-events-size-exception.md` (precedente del slice).
- `docs/decisions/2026-04-24-erasure-365d.md` § "Alternativas descartadas"
  (referencia a `quotedSnapshot.authorLabel` inmutable).
- `CLAUDE.md § Gotchas` ("`quotedSnapshot.authorLabel` inmutable —
  asimetría histórica intencional").
- Plan: `~/.claude/plans/tidy-stargazing-summit.md` § F.E.
