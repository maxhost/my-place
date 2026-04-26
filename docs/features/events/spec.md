# Events — Especificación

> **Alcance:** tercera entidad del core tras discussions y members. Eventos como propuestas concretas con fecha y momento claro, no compromisos rígidos. RSVP texturado con 4 estados, thread del foro auto-creado al publicar el evento, soft-cancel preservando RSVPs, derecho al olvido al 365d.

> **Referencias:** `docs/ontologia/eventos.md` (canónico), `docs/features/events/spec-rsvp.md` (estados RSVP detallados + copy + visibility), `docs/features/events/spec-integrations.md` (discussions tx, hours, members erasure, flags), `docs/features/discussions/spec.md` (patrón Post + autor snapshot + RLS), `docs/features/hours/spec.md` (gate + helpers IANA), `docs/features/members/spec.md` (membership lifecycle + erasure 365d), `docs/decisions/2026-04-25-events-size-exception.md` (excepción cap LOC), `CLAUDE.md` (principios no negociables).

## 1. Modelo mental

Un evento es una **propuesta concreta** lanzada al place: alguien dice "el viernes 9 a las 20:00 nos juntamos" y los miembros responden con cuánto pueden. No es ticketing, no es calendario corporativo, no es invitación con escasez artificial. Es una invitación texturada — el RSVP refleja el matiz real ("voy", "voy si X", "no voy pero aporto Y", "no voy") en vez del binario sí/no.

Tres propiedades estructurales lo separan de un evento de plataforma típica:

- **Vive dentro del horario del place.** Como discussions, está gated por `(gated)/layout.tsx`. Si el place está cerrado, los miembros no ven `/events` ni el thread del evento.
- **Genera conversación, no recuerdo aislado.** Al publicar un evento se crea automáticamente un thread del foro (Post) en una transacción atómica. El thread es donde la preparación colectiva sucede — quién trae qué, logística, intenciones — y queda como memoria viva post-evento.
- **El RSVP no es compromiso vinculante.** Los 4 estados explicitan grados de presencia. Quién confirma se ve; quién decline no se expone (la ontología dice "quién no, no se presiona").

## 2. Vocabulario y convenciones

- **Event**: objeto raíz del slice. Tiene `title` (3–120 chars), `description?` (TipTap AST, opcional en F1), `startsAt` (UTC), `endsAt?` (UTC), `timezone` (IANA), `location?` (free-text), `postId?` (FK al thread auto-creado), `cancelledAt?` (soft-cancel).
- **EventRSVP**: respuesta de un miembro a un evento. Tiene `state` (4 valores texturados) y `note?` (texto opcional sólo válido en estados condicionales).
- **RSVPState**: enum cerrado `GOING | GOING_CONDITIONAL | NOT_GOING_CONTRIBUTING | NOT_GOING`. Detalle ontológico en `spec-rsvp.md`.
- **Estado derivado del evento**: `upcoming | happening | past | cancelled`. Calculado, no persistido. Ver § 5.

**Slice se llama `events`.** Vocabulario en UI: "Evento", "Próximo", "Pasando ahora", "Pasó", "Cancelado", "Voy", "Tal vez", "No voy". Idioma `es-AR`. Código en inglés.

### URLs

**Decisión F.F (2026-04-26)**: el evento ES el thread. La URL canónica de
"ver el evento" es la del thread auto-creado, no una page separada. Ver
`docs/decisions/2026-04-26-events-as-thread-unified-url.md`.

- **Lista:** `/[placeSlug]/events` — próximos arriba, pasados collapsed bajo disclosure. Cards linkean al thread.
- **Detalle (canónico):** `/[placeSlug]/conversations/[postSlug]` — el thread renderiza `EventMetadataHeader` arriba (fecha, RSVP, location, descripción, acciones admin) cuando `Post.event` está poblado. La página de conversation hace fetch de `getEvent` si detecta evento asociado.
- **Detalle (legacy redirect):** `/[placeSlug]/events/[eventId]` — redirect 308 server-side a `/conversations/[postSlug]`. Mantenido para no romper links externos / bookmarks pre-F.F.
- **Crear:** `/[placeSlug]/events/new`. Tras guardar, redirect al thread.
- **Editar:** `/[placeSlug]/events/[eventId]/edit` (author/admin) — page dedicada porque el form es complejo (datetime + timezone + 7 campos). Tras guardar, redirect al thread.

## 3. Arquitectura del slice

```
src/features/events/
├── public.ts                      # client-safe: tipos, schemas, actions, client components
├── public.server.ts               # server-only: queries Prisma
├── domain/
│   ├── types.ts                   # Event, EventRSVP, RSVPState, EventState
│   ├── invariants.ts              # validate{Title,Times,Note,...}
│   └── state-derivation.ts        # deriveEventState(event, now)
├── schemas.ts                     # Zod inputs (createEvent, updateEvent, rsvpEvent, cancelEvent)
├── server/
│   ├── queries.ts                 # listEvents, getEvent, listEventRsvps
│   └── actions/
│       ├── create.ts              # createEventAction (con auto-thread tx)
│       ├── update.ts              # updateEventAction
│       ├── cancel.ts              # cancelEventAction (soft-cancel)
│       └── rsvp.ts                # rsvpEventAction (upsert + delete)
├── ui/
│   ├── event-list.tsx             # SC: lista próximos + collapsed pasados
│   ├── event-list-item.tsx        # SC: card individual
│   ├── event-detail.tsx           # SC: full info + RSVPButton + RsvpList
│   ├── event-form.tsx             # CC: create + edit (Zod + react-hook-form)
│   ├── rsvp-button.tsx            # CC: 4 estados + textfield condicional
│   ├── rsvp-list.tsx              # SC: "quién viene" (sólo GOING + GOING_CONDITIONAL)
│   └── event-cancelled-badge.tsx  # SC: badge en detail + en thread asociado
└── __tests__/                     # ver § 12
```

`public.ts` exporta tipos del dominio + Zod schemas + Server Actions + Client Components. `public.server.ts` exporta queries server-only. Split obligatorio porque la UI tiene Client Components que importan tipos del slice — sin split, Next traza `server-only` al bundle cliente y rompe build (mismo patrón que `flags/`, ver `docs/decisions/2026-04-21-flags-subslice-split.md`).

## 4. Modelo de datos

```prisma
model Event {
  id             String      @id @default(cuid())
  placeId        String
  place          Place       @relation(fields: [placeId], references: [id], onDelete: Restrict)
  authorUserId   String?
  author         User?       @relation("EventAuthor", fields: [authorUserId], references: [id], onDelete: SetNull)
  authorSnapshot Json
  title          String      @db.VarChar(120)
  description    Json?
  startsAt       DateTime    @db.Timestamptz(3)
  endsAt         DateTime?   @db.Timestamptz(3)
  timezone       String
  location       String?     @db.VarChar(200)
  postId         String?     @unique
  post           Post?       @relation(fields: [postId], references: [id], onDelete: SetNull)
  createdAt      DateTime    @default(now())
  updatedAt      DateTime    @updatedAt
  cancelledAt    DateTime?

  rsvps          EventRSVP[]

  @@index([placeId, startsAt])
  @@index([placeId, cancelledAt, startsAt])
}

model EventRSVP {
  id        String    @id @default(cuid())
  eventId   String
  event     Event     @relation(fields: [eventId], references: [id], onDelete: Cascade)
  userId    String
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  state     RSVPState
  note      String?   @db.VarChar(280)
  updatedAt DateTime  @updatedAt

  @@unique([eventId, userId])
  @@index([eventId, state])
}

enum RSVPState {
  GOING
  GOING_CONDITIONAL
  NOT_GOING_CONTRIBUTING
  NOT_GOING
}
```

**`User` agrega back-references** (en F.B):

```prisma
model User {
  // existing
  eventsAuthored Event[]     @relation("EventAuthor")
  eventRsvps     EventRSVP[]
}
```

**Post agrega back-reference inversa** (`Post.event Event?`) — el thread sabe si pertenece a un evento para renderizar header + badge cancelado.

**CHECK constraint sobre `note`** (en migration SQL F.B):

```sql
ALTER TABLE "EventRSVP" ADD CONSTRAINT rsvp_note_only_when_textured
  CHECK (note IS NULL OR state IN ('GOING_CONDITIONAL', 'NOT_GOING_CONTRIBUTING'));
```

Razón: `note` debe poder existir sólo en los 2 estados condicionales (donde la ontología pide explicar el "si" o el "aporto"). Texto en `GOING` o `NOT_GOING` es ruido — los estados son auto-explicativos. El CHECK enforcea la invariante a nivel DB; los invariants del dominio lo refuerzan.

### Por qué cada decisión del schema

- **`authorUserId` nullable + `authorSnapshot Json`** — patrón idéntico a Post/Comment para soportar erasure 365d. Cuando el author deja el place y cumple 365d, `authorUserId` queda NULL y `authorSnapshot.displayName` se renombra a "ex-miembro" sin perder el evento como contenido del place.
- **`postId` nullable + `@unique`** — el FK al thread es 1:1 cuando existe pero puede ser null en dos escenarios: (a) chicken-and-egg al crear (Event se crea antes del Post dentro de la misma tx, pero Prisma no permite circular FK en una sola insert; resolvemos con UPDATE Event SET postId = … tras crear Post — ver § 6); (b) defensivo a futuro si discussions queda deshabilitado para un place específico. `onDelete: SetNull` permite que el Post sea eliminado sin arrastrar el evento.
- **`cancelledAt` en lugar de DELETE** — preserva RSVPs como señal histórica + auditoría + permite que el thread asociado siga vivo ("lástima, reprogramemos"). DELETE físico via RLS prohibido para `authenticated`; sólo `service_role` bypassea (usado por erasure).
- **`startsAt`/`endsAt` como `timestamptz` + `timezone TEXT`** — eventos son **puntos en el tiempo** (instante absoluto). `timestamptz` guarda UTC; el `timezone` IANA es el "intencional" del evento ("este evento es a las 20hs Buenos Aires"). Render: convertir UTC → IANA del evento ("hora del evento") + opcionalmente UTC → IANA del viewer si difiere ("hora local: …"). Esto es **distinto a `hours/`**, que persiste time-of-day patterns recurrentes en local-place. Eventos y hours son shapes diferentes con representaciones naturales diferentes.
- **`description Json?` (TipTap AST)** — opcional en F1. Reusa el editor + renderer SSR de discussions. Validación con `assertRichTextSize` (límite 20 KB serializado, mismo que Post.body).

### Invariantes globales

- `title.length >= 3 && title.length <= 120`
- `description` (si presente) reusa `assertRichTextSize` de discussions.
- `startsAt > now()` al crear (excepción admin diferida a post-F1).
- `endsAt > startsAt` cuando `endsAt` presente.
- `endsAt - startsAt <= 7 días` (sanity check; eventos largos son sospechosos en F1).
- `timezone ∈ AllowedTimezone` (whitelist 18 IANA en `hours/public.ts`).
- `location?.length <= 200`.
- `note` sólo presente si `state ∈ {GOING_CONDITIONAL, NOT_GOING_CONTRIBUTING}` — invariant de dominio + CHECK constraint.
- `cancelledAt` solo setable por `cancelEventAction` (no por update general).
- `Event.placeId` inmutable post-create (asserted en `updateEventAction`).

## 5. Algoritmo de momentos (estado derivado)

Función pura, no persistida en DB:

```ts
export function deriveEventState(
  event: { startsAt: Date; endsAt: Date | null; cancelledAt: Date | null },
  now: Date,
): 'upcoming' | 'happening' | 'past' | 'cancelled' {
  if (event.cancelledAt) return 'cancelled'
  if (now < event.startsAt) return 'upcoming'
  const effectiveEnd = event.endsAt ?? new Date(event.startsAt.getTime() + DEFAULT_DURATION_MS)
  if (now < effectiveEnd) return 'happening'
  return 'past'
}

const DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000 // 2h cuando endsAt es null
```

**Decisiones**:

- **Sin buffer pre-startsAt.** La ontología dice "Sin urgencia artificial". Un evento programado para 20:00 es "próximo" hasta 19:59:59, "happening" desde 20:00:00 exacto. No "EN 5 MIN", no "FALTA POCO".
- **Default 2h cuando `endsAt` null.** Evita que eventos sin fin queden "happening" para siempre. 2h es un default razonable; el usuario puede setear `endsAt` explícito si necesita más/menos.
- **`cancelled` es estado terminal.** Prevalece sobre upcoming/happening/past — un evento cancelado que ya pasó sigue mostrándose como `cancelled`, no como `past`. UI muestra badge dedicado.
- **Memoria fresca / archivo permanente.** NO modelado en F1. La ontología habla de "memoria fresca ~2-4 semanas" — esto es UI emergente que se agrega en post-F1 cuando aparezca la home rehecha. F1 sólo distingue 4 estados.

**Edge cases del default 2h**:

- **Eventos all-day**: NO modelados en F1. Si se necesitan, la ontología no los menciona como prioridad. F1: el usuario que quiera "todo el día" setea `startsAt = 00:00` + `endsAt = 23:59` explícitos.
- **Eventos < 1h con `endsAt` explícito**: válidos sin restricción (standup 09:00–09:15 funciona). El invariant `endsAt > startsAt` cubre el caso degenerado.
- **Eventos sin `endsAt` y de duración esperada > 2h**: el usuario debe setear `endsAt` explícito; si no lo hace, el evento aparece como "pasó" después de 2h. UI del form sugiere setear `endsAt` con placeholder cuando el usuario solo completa `startsAt`.
- **Drift de reloj cliente vs server**: `deriveEventState` usa la `now` del Server Component (servidor). El cliente puede mostrar cache desincronizado por minutos; aceptable para MVP, no merece sync.

## 6. RLS — Row-Level Security

7 policies obligatorias. Patrón idéntico a discussions (reusa helpers `is_active_member` + `is_place_admin`).

```sql
ALTER TABLE "Event" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "events_select_members" ON "Event" FOR SELECT
  USING (is_active_member("placeId"));

CREATE POLICY "events_insert_members" ON "Event" FOR INSERT
  WITH CHECK (is_active_member("placeId")
              AND "authorUserId"::text = auth.uid()::text);

CREATE POLICY "events_update_author_or_admin" ON "Event" FOR UPDATE
  USING (is_active_member("placeId")
         AND ("authorUserId"::text = auth.uid()::text
              OR is_place_admin("placeId")));

-- DELETE prohibido para authenticated; service_role bypassea para erasure

ALTER TABLE "EventRSVP" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rsvp_select_members" ON "EventRSVP" FOR SELECT
  USING (is_active_member(
    (SELECT "placeId" FROM "Event" WHERE id = "eventId")));

CREATE POLICY "rsvp_insert_self" ON "EventRSVP" FOR INSERT
  WITH CHECK (
    is_active_member((SELECT "placeId" FROM "Event" WHERE id = "eventId"))
    AND "userId"::text = auth.uid()::text
    AND (SELECT "cancelledAt" FROM "Event" WHERE id = "eventId") IS NULL
  );

CREATE POLICY "rsvp_update_self" ON "EventRSVP" FOR UPDATE
  USING ("userId"::text = auth.uid()::text);

CREATE POLICY "rsvp_delete_self" ON "EventRSVP" FOR DELETE
  USING ("userId"::text = auth.uid()::text);
```

**Visibilidad de ex-miembros sobre eventos del place que dejaron**: `is_active_member` requiere `leftAt IS NULL`. Un ex-miembro NO puede leer eventos futuros ni pasados del place que dejó. Coherente con el principio "Place cerrado invisibiliza todo" extendido a "Place que dejé ya no me incluye". Ontológicamente: la memoria del evento vive en el place; el ex-miembro deja de ser parte y por tanto deja de acceder. Si quiere reconectar, debe rejoin (membership nueva).

**Tests RLS obligatorios** (F.B implementa, 9 casos):

1. No-miembro → SELECT Event devuelve 0 filas.
2. Miembro activo → SELECT ve eventos del place.
3. Miembro de otro place → no puede crear evento (WITH CHECK falla).
4. Miembro → no puede crear evento con `authorUserId` ≠ propio.
5. Miembro → no puede RSVPear en nombre de otro user.
6. Miembro → no puede insertar RSVP en evento cancelado.
7. Author → puede UPDATE propio evento.
8. Admin → puede UPDATE cualquier evento del place.
9. Ex-miembro (`leftAt IS NOT NULL`) → invisibilizado en SELECT (incluye eventos pasados).

## 7. Flows principales

### Crear evento (con auto-thread tx)

Flujo detallado en `spec-integrations.md § Discussions`. Resumen:

1. Usuario llena form → `createEventAction(input)`.
2. Zod parse + `assertPlaceOpenOrThrow` (defensa en profundidad — gate ya filtró).
3. `prisma.$transaction`:
   - INSERT Event con `postId: null`.
   - `createPostFromSystemHelper(tx, ...)` crea Post (thread) bajo la misma tx.
   - UPDATE Event SET `postId = post.id`.
4. Commit → `revalidatePath` para `/events`, `/events/<id>`, `/conversations/<slug>`.
5. Redirect al detalle del evento.

Si Post falla (RLS, slug collision tras retry, validation) → tx rollbackea Event también. Usuario recibe `ConflictError` o `ValidationError` y nada queda persistido.

### RSVPear

Flujo detallado en `spec-rsvp.md`. Resumen:

1. Usuario click "Voy" / "Voy si…" / "No voy, pero aporto…" / "No voy".
2. Si estado condicional → expone textfield para `note` (max 280 chars).
3. Server Action `rsvpEventAction({ eventId, state, note? })`.
4. Validación: `note` sólo permitido en condicionales (invariant + CHECK).
5. Validación: evento no cancelado (RLS bloquea, server lo verifica para mensaje claro).
6. Upsert por `(eventId, userId)` único.
7. `revalidatePath` → UI refleja el cambio. F1 NO usa optimistic update (decisión explícita § 11 — out of scope realtime).

### Editar evento

1. Author o admin entra a `/events/<id>/edit`.
2. Form pre-poblado con valores actuales.
3. `updateEventAction`: valida ownership/admin, valida invariants, UPDATE Event.
4. `revalidatePath` → UI refleja.
5. **El Post asociado NO se auto-actualiza** (decisión explícita; ver `spec-integrations.md`).

### Cancelar evento

1. Author o admin click "Cancelar evento" en detail.
2. Confirmación modal con copy "Esto marca el evento como cancelado. La conversación sigue disponible. Las RSVPs se preservan pero ya no se pueden cambiar."
3. `cancelEventAction({ eventId })`: valida ownership/admin, UPDATE `cancelledAt = now()`.
4. `revalidatePath`.
5. UI muestra badge "Cancelado" en detail + en list + en el Post asociado (via relación inversa).
6. `RsvpButton` deshabilitado (RLS bloquea INSERT por `cancelledAt IS NULL` check).

## 8. Listado de eventos

Página `/[placeSlug]/events`:

- **Próximos** (estado `upcoming` + `happening`): sección abierta arriba, ordenado por `startsAt ASC`.
- **Pasados** (estado `past`): collapsed bajo disclosure, ordenado por `startsAt DESC`.
- **Cancelados**: aparecen en su sección original (próximo o pasado) con badge.

Sin scroll infinito. Paginación cursor `(startsAt, id)` cuando se supere 20 items por sección (mismo patrón discussions).

Filtros F1: ninguno. Búsqueda por título: post-F1.

## 9. Errores estructurados

| Error                | Código `DomainError` | Cuándo                                                             |
| -------------------- | -------------------- | ------------------------------------------------------------------ |
| `ValidationError`    | `VALIDATION`         | Input form inválido (timezone, fechas, note en estado sin textura) |
| `AuthorizationError` | `AUTHORIZATION`      | Update/cancel sin ser author ni admin                              |
| `NotFoundError`      | `NOT_FOUND`          | Event no existe o pertenece a otro place                           |
| `ConflictError`      | `CONFLICT`           | RSVP a evento cancelado, slug collision al crear Post asociado     |
| `OutOfHoursError`    | `OUT_OF_HOURS`       | `assertPlaceOpenOrThrow` cuando el place está cerrado              |

Reusan `shared/errors/domain-error.ts` existente. Sin clases nuevas en F1.

## 10. Copy F1

**Estados RSVP** (mapping enum → label visible):

- `GOING` → "Voy"
- `GOING_CONDITIONAL` → "Voy si…" (textfield: "¿Qué necesitarías?")
- `NOT_GOING_CONTRIBUTING` → "No voy, pero aporto…" (textfield: "¿Cómo aportás?")
- `NOT_GOING` → "No voy"

**Estados de evento**:

- `upcoming` → "Próximo"
- `happening` → "Pasando ahora"
- `past` → "Pasó"
- `cancelled` → "Cancelado"

**Mensaje de cancelación en thread del evento**: "Este evento fue cancelado. La conversación sigue disponible."

**Botón crear en list**: "Proponer evento" (no "Crear"; refuerza "es una invitación").

Detalle completo del copy RSVP + razones ontológicas en `spec-rsvp.md`.

## 11. Out of scope explícito (proteger scope F1)

| Item                                                      | Razón diferimiento                                           | Roadmap                            |
| --------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------- |
| Recurrencia (rituales, RRULE)                             | Complejidad alta + timezone DST                              | Post-F1                            |
| UI 3 momentos (antes/durante/después) con copy contextual | Requiere realtime + design pass                              | Post-F1                            |
| Memoria fresca (vista agregada último mes)                | Depende de home rehecha                                      | Fase 7                             |
| Archive físico tras N días                                | Sin requerimiento concreto                                   | TBD                                |
| Exclusiones/invitations granulares                        | "Default todos" cubre F1                                     | Post-F1                            |
| Permisos por rol granulares (creación)                    | "Todos los miembros" cubre F1                                | Post-F1                            |
| ICS export (calendario externo)                           | Sin requerimiento                                            | TBD                                |
| Realtime presence en detalle                              | Requiere UI 3 momentos primero                               | Post-F1                            |
| Notificaciones (email/push/in-app)                        | Principio "sin push agresivas" — requiere decisión producto  | TBD con producto                   |
| Recordatorios 24h antes                                   | Mismo bucket que notificaciones                              | TBD                                |
| Cambios de fecha con notificación a confirmados           | Mismo bucket                                                 | TBD                                |
| Cupo máximo de asistentes (waitlist)                      | Ontología explícita: "no waitlist"                           | Permanente                         |
| Auto-edición de Post si Event cambia título               | Rompe conversación; UI muestra link al evento                | Permanente                         |
| Reacciones sobre Event (emoji)                            | Enum admite, F1 no implementa UI                             | Sub-fase post-F.E si producto pide |
| Eventos all-day como tipo dedicado                        | Workaround: 00:00–23:59 explícitos                           | Post-F1                            |
| Tipo "ritual" diferenciado en datos                       | F1: todos son `EventoOcasion`. Ritual emerge con recurrencia | Post-F1                            |
| Cover visual / color del evento                           | Vibe-first ontológico, requiere design + asset infra         | Post-F1                            |
| Naturaleza presencial/virtual/híbrido como discriminador  | F1: `location` libre lo cubre informalmente                  | Post-F1                            |
| Memoria post-evento "solo asistentes"                     | Default todos cubre F1                                       | Post-F1                            |

## 12. Tests obligatorios (TDD test-first)

Orden estricto en F.C: escribir test, verificar que falla, implementar, verificar que pasa, refactor.

**F.B (RLS, `tests/rls/events.test.ts`)** — 9 casos § 6.

**F.C (domain + actions)**:

`invariants.test.ts` (4 casos):

1. `validateEventTitle` rechaza < 3 / > 120 chars.
2. `validateEventTimes` rechaza `endsAt < startsAt`.
3. `validateEventTimes` rechaza duración > 7 días.
4. `validateRsvpNote` rechaza `note` en estados sin textura.

`state-derivation.test.ts` (5 casos):

5. `deriveEventState` retorna `cancelled` si `cancelledAt`.
6. `deriveEventState` retorna `upcoming` si `now < startsAt`.
7. `deriveEventState` retorna `happening` si dentro del rango.
8. `deriveEventState` aplica default 2h cuando `endsAt` null.
9. `deriveEventState` retorna `past` post `endsAt`.

`actions/create.test.ts` (4 casos):

10. `createEventAction` happy path crea Event + Post en tx.
11. `createEventAction` con timezone inválido → `ValidationError`.
12. `createEventAction` con `startsAt` en pasado → `ValidationError`.
13. `createEventAction` rollback de Post rollbackea Event (mock failure).

`actions/update.test.ts` (4 casos):

14. `updateEventAction` por author → OK.
15. `updateEventAction` por no-author no-admin → `AuthorizationError`.
16. `updateEventAction` no permite cambiar `placeId`.
17. `updateEventAction` no actualiza Post asociado.

`actions/cancel.test.ts` (2 casos):

18. `cancelEventAction` setea `cancelledAt`, preserva Post + RSVPs.
19. `cancelEventAction` por no-author no-admin → `AuthorizationError`.

`actions/rsvp.test.ts` (5 casos):

20. `rsvpEventAction` crea RSVP nuevo (4 estados).
21. `rsvpEventAction` upsert existente cambia `state` y `note`.
22. `rsvpEventAction` con `note` en estado sin textura → `ValidationError`.
23. `rsvpEventAction` en evento cancelado → `ConflictError`.
24. `rsvpEventAction` doble call no duplica filas (unique constraint).

`run-erasure.test.ts` (extender existente, 3 casos nuevos):

25. Erasure anonimiza Event del ex-miembro (`authorUserId = NULL`, `displayName = "ex-miembro"`).
26. Erasure DELETEa EventRSVP del ex-miembro **en el place que dejó**.
27. Erasure preserva EventRSVP del ex-miembro **en otros places** donde sigue activo.

`create-from-system.test.ts` (PR-1, 3 casos):

28. `createPostFromSystemHelper` crea Post bajo tx, retorna `{id, slug}`.
29. Slug collision tras retry → `ConflictError`.
30. Falla mid-tx → no queda Post huérfano.

**F.D (UI, `tests/e2e/events-create-rsvp.spec.ts`)** — Playwright smoke:

- Member entra a `/events`, ve listado.
- Crea evento → redirect al detalle → thread auto-creado linkeado.
- Click "Voy" → optimistic + server confirma.
- Cambia a "Voy si…" + escribe note → guarda.
- No-miembro intenta acceder → 404.

**F.E (integration)**:

31. `createEventAction` end-to-end: tx commitea ambos rows.
32. Mock `createPostFromSystemHelper` throws → Event no queda persistido.
33. `cancelEventAction` no afecta Post asociado.

## 13. Verificación

Al completar F.E:

1. **Unit tests** (`pnpm test`): baseline + 27 nuevos verdes.
2. **RLS tests** (`pnpm test:rls`): 9 casos events verdes.
3. **E2E** (`pnpm test:e2e`): smoke `events-create-rsvp` verde, ambos browsers.
4. **Build** (`pnpm build`): verde, sin errores `server-only` traceando al bundle cliente.
5. **Manual end-to-end** en cloud dev:
   - Crear evento → ver thread asociado → comentar en thread → ver evento en `/events`.
   - RSVPear con cada uno de los 4 estados → confirmar persistencia + UI consistente.
   - Cancelar evento → confirmar badge en detail + en thread + RSVP button deshabilitado.
   - Editar título del evento → confirmar Post NO se renombra.

## 14. Sub-specs

- `spec-rsvp.md` — RSVP detallado: 4 estados, mapping copy, CHECK constraint, visibility de RSVPs en lista, transiciones entre estados.
- `spec-integrations.md` — Integración con discussions (auto-thread tx + PR-1), hours (gate hereda + edge case fuera horario), members (erasure 365d + PR-3), flags (EVENT en `ContentTargetKind` + PR-2 + `mapEventSnapshot`), realtime (out of scope F1 + razón).
