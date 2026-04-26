# Eventos unificados con su thread (URL canónica `/conversations/[postSlug]`)

**Fecha:** 2026-04-26
**Milestone:** Fase 6 / F.F (refactor evento-como-thread)
**Autor:** Max

## Contexto

La spec original aprobada en F.A modeló eventos y threads como **dos
páginas con URLs separadas, bidireccionalmente linkeadas**:

- `/[placeSlug]/events/[eventId]` — detalle del evento (fecha, RSVP,
  location, descripción, link al thread).
- `/[placeSlug]/conversations/[postSlug]` — el thread auto-creado (Post
  - comments) con un banner pequeño "Conversación del evento: …" arriba.

Al probar manualmente (F.D + F.E ya implementados), apareció una
fricción de UX: para participar de un evento el usuario hacía 2 saltos
("ver evento → click → ver conversación → comentar"). Y conceptualmente
había **dos cosas** donde el usuario veía **una** ("el evento del
viernes"). El click en el banner de cancelado del thread llevaba a otra
página, no era una acción inline.

El problema se manifestó como un bug puntual (link roto: usaba `postId`
cuid donde el route esperaba `postSlug`), pero la pregunta de fondo era
**ontológica**: ¿el evento es un objeto separado del thread, o es un
thread con metadata especial?

La ontología (`docs/ontologia/eventos.md` § "Momento 1") ya sugería la
segunda lectura:

> Desde el foro: el thread tiene header que dice "evento: [nombre],
> [fecha]" distinguiéndolo como thread de evento.

## Decisión

**Unificar la cara visible del evento con su thread asociado: el evento
ES el thread.** Una sola URL canónica por evento:

```
/[placeSlug]/conversations/[postSlug]
```

Cuando el `Post` consultado fue auto-creado por un `Event`
(`Post.event` poblado), la página de conversación renderiza arriba un
**`EventMetadataHeader`** (Server Component) con todo lo que antes vivía
en `/events/[eventId]`:

- Título del evento + tipografía distintiva.
- Fecha + rango horario en el TZ del evento + label IANA.
- Location.
- Descripción del evento (TipTap renderer).
- "Quién viene" (RsvpList).
- RSVP button (4 estados + textfield condicional).
- Acciones admin/author: Editar evento + Cancelar evento (inline).
- Badge "Pasando ahora" / "Cancelado" según estado derivado.

Abajo del header sigue el `PostDetail` normal (header del Post + body +
reactions + edit window) y los comments del thread. Toda la operación
del evento pasa en una sola página.

## Cambios concretos

### Schema (sin cambios)

`Event.postId` (FK 1:1) y `Post.event` (back-reference) ya existían
desde F.B+F.E. La unificación es de UI/queries, no de datos.

### Queries

- **`getEvent`** (events/server/queries.ts) incluye `post.slug` en el
  select y lo expone como `postSlug` en `EventDetailView`. Permite
  redirects + links sin round-trip extra.
- **`listEvents`** incluye `post.slug` en cada item; `EventListView`
  expone `postSlug`. La card del listado linkea a
  `/conversations/[postSlug]` en lugar de `/events/[id]`.
- **`findPostBySlug`** / **`findPostById`** (discussions/server/queries.ts)
  ya incluían `post.event` (subset `{id, title, cancelledAt}`) desde F.E.
  Esto sirve como discriminador en la page composer para decidir si
  fetch full `getEvent` y renderizar el header.

### Composer (page)

`/[placeSlug]/(gated)/conversations/[postSlug]/page.tsx` (Server
Component) hace, además del flujo normal:

```ts
const eventDetail = post.event
  ? await getEvent({ eventId: post.event.id, placeId: place.id, viewerUserId: viewer.actorId })
  : null
```

Y renderiza condicionalmente `<EventMetadataHeader event={eventDetail} ... />`
arriba del `<PostDetail ... />`. Posts standalone se comportan como
antes (sin header de evento).

### UI

- **NEW** `events/ui/event-metadata-header.tsx` — Server Component que
  encapsula toda la cara del evento + compone los Client Components
  `RSVPButton`, `CancelEventButton`, `EventCancelledBadge`, `RsvpList`.
- **DEL** `events/ui/event-detail.tsx` — reemplazado por
  `EventMetadataHeader`.
- **MOD** `events/ui/event-list-item.tsx` — link a
  `/conversations/[postSlug]`. Si el evento no tiene `postSlug` (caso
  defensivo), la card es no-clickeable.
- **MOD** `events/ui/event-form.tsx` — redirect tras
  create/edit/cancelar va a `/conversations/[postSlug]`. `EditMode` del
  form acepta `postSlug` como prop.
- **MOD** `discussions/ui/post-detail.tsx` — quita el banner inline
  pequeño que F.E había agregado. La razón ahora vive en
  `EventMetadataHeader` con info completa, no como teaser.

### Backward-compat

`/[placeSlug]/(gated)/events/[eventId]/page.tsx` se mantiene como
**redirect server-side 308** a `/conversations/[postSlug]`. Razón:

- Links externos / bookmarks pre-F.F siguen funcionando.
- Redirect transparente para el usuario.
- Si el evento no existe → 404 normal.
- Si el evento existe pero no tiene Post (caso defensivo) → redirect al
  listado `/events`.

`/[placeSlug]/(gated)/events/new` y `/[placeSlug]/(gated)/events/[eventId]/edit`
**se mantienen** como pages dedicadas — el form de crear/editar es
suficientemente complejo (datetime-local + timezone select + 7 campos)
como para tener su propia page. Tras guardar, redirect al thread.

## Razones

1. **Alinea con la ontología**: "el thread tiene header que dice 'evento:
   [nombre], [fecha]'" se interpreta literalmente — el thread ES el
   contenedor.
2. **UX más simple**: una página por evento. RSVP + comentar pasan en el
   mismo lugar. Sin "saltar al detalle, click, saltar al thread".
3. **Schema sin cambios**: las dos entidades + relación 1:1 siguen
   existiendo. Solo cambia la cara visible.
4. **Boundaries preservados**:
   - `events` consume `discussions/public.server` para `resolveViewerForPlace`
     - `findPostBySlug` (ya estaba).
   - `discussions` consume `events/public` (`EventMetadataHeader`,
     `EventCancelledBadge`) sólo en pages, NO desde dentro del slice
     (sin circular dep).
   - El page composer (`app/[placeSlug]/(gated)/conversations/[postSlug]/page.tsx`)
     orquesta ambos slices — patrón estándar.
5. **`getEvent` ya devolvía `EventDetailView` completo** — sólo agregamos
   `postSlug` (un select más). Reusable directo.

## Decisiones derivadas

### Edit form se mantiene como page dedicada

El form de crear/editar tiene 7 inputs (título, descripción, startsAt,
endsAt, timezone, location, descripción TipTap). Embeberlo inline en el
thread sería ruido visual + complica el manejo de estado. La cara
visible del evento (visualizar) está unificada; la edición (acción
intensiva) tiene su propio lugar.

### Backward-compat con redirect 308

Old links a `/events/[id]` no rompen. El redirect es server-side y
gratis (un round-trip a `getEvent`, ya cacheado). Si en post-F1 el slug
del Post cambia (no debería, pero defensivo), el redirect sigue
resolviendo via `Event.postId` actualizado.

### `Post.event` sigue existiendo en el type pero el banner inline en `PostDetail` se quita

El campo `event` en `Post` sigue siendo útil para que **otros consumers**
(que no sean la conversation page) sepan si el Post es de evento — por
ejemplo, una futura "lista de threads" en la home podría marcarlos
visualmente. El **banner inline** que F.E había agregado en `PostDetail`
se quita porque duplicaba info del nuevo `EventMetadataHeader`.

### El listado `/events` se mantiene

Aunque la URL canónica del evento es `/conversations/[postSlug]`, tener
un listado dedicado de eventos sigue siendo valioso (vista temporal:
próximos vs pasados, ordenado por fecha). Sin esta vista, los eventos se
mezclarían con los threads standalone en `/conversations` —
ontológicamente distintos.

## Alternativas descartadas

1. **Mantener 2 URLs (modelo F.A)**: el bug del link roto era trivial de
   arreglar (cambiar `event.postId` por `event.post.slug`), pero
   resolvía el síntoma sin atacar la fricción de UX. El usuario lo
   detectó al probar y pidió el reframing.

2. **Inline edit form en el thread**: combinar visualización + edición
   en una misma page satura la UI cuando el form crece (datetime
   pickers, descripción TipTap, etc.). Mantener la edición como page
   dedicada respeta el principio "nada grita".

3. **Mover toda la lógica de evento al slice `discussions`**: rompería
   el modelo vertical-slice. Eventos tiene sus propios invariantes
   (RSVP, fechas, timezone, cancel) que merecen un slice propio. La
   unificación es de **cara visible** (page composition), no de
   responsabilidades.

4. **Render condicional de la lista en `/conversations`**: en lugar de
   listado separado en `/events`, mostrar todos los threads (incluyendo
   eventos) en `/conversations` con marcas visuales. Considerado, pero:
   - Pierde la vista temporal "próximos vs pasados".
   - Mezcla ordenación por `lastActivityAt` (discussions) con `startsAt`
     (eventos) que son criterios distintos.
   - Podría sumarse en post-F1 como "vista mixta opcional".

## Verificación

### Tests automatizados

- **Unit tests** (sin cambios): los tests de `createEventAction`,
  `updateEventAction`, `cancelEventAction`, `rsvpEventAction` siguen
  verdes — la lógica de actions no cambió, sólo la UI.
- **post-event-relation tests** (sin cambios): la relación `Post.event`
  - el shape devuelto por `findPostBySlug` no cambian. Siguen verdes.
- **E2E smoke** actualizado: navega a `/conversations/[slug]` tras crear
  evento y verifica que `EventMetadataHeader` se renderiza (`<h2>` con
  título + aria-label "Metadata del evento" + RSVP buttons).

### Manual QA

- Crear evento → redirect al thread con header completo arriba.
- RSVP "Voy" / "Voy si…" / "No voy, pero aporto…" / "No voy" → todos
  funcionan inline en el thread.
- Cancelar evento → badge "Cancelado" aparece en el header del thread,
  RSVPs read-only, conversación sigue viva.
- Editar evento → form dedicado (`/events/[id]/edit`) → tras guardar,
  redirect al thread con cambios reflejados.
- URL vieja `/events/[id]` → redirect 308 al thread.
- Listado `/events` → cards linkean al thread directo.

## Referencias

- `docs/ontologia/eventos.md` § "Momento 1 — Preparación colectiva".
- `docs/features/events/spec.md` § 11 (URLs — actualizado en F.F).
- `docs/decisions/2026-04-26-events-discussions-cotransaction.md` (F.E:
  patrón tx atómica que sigue vigente).
- `docs/decisions/2026-04-25-events-size-exception.md` (F.A: cap LOC).
- Plan: `~/.claude/plans/tidy-stargazing-summit.md` § F.F (refactor
  decidido durante prueba manual).
