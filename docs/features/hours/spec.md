# Hours — Especificación

> **Alcance:** horario de apertura del place. Modelo de datos (ventanas recurrentes + excepciones + timezone), utility pura `isPlaceOpen`, CRUD administrativo, hard gate de acceso al contenido fuera de horario, helper `assertPlaceOpenOrThrow` para que conversaciones (Fase 5) y eventos (Fase 6) defiendan sus server actions de escritura.

> **Referencias:** `blueprint.md` (horario como primitivo estructural), `docs/ontologia/conversaciones.md` (integración), `docs/ontologia/eventos.md` (reglas de evento dentro/fuera del horario regular), `docs/features/places/spec.md` (ciclo de vida del place), `docs/multi-tenancy.md` (rutas `{slug}.place.app/*`), `CLAUDE.md` (principios no negociables).

## Modelo mental

Un place es un pub con horario. **Cerrado = no se entra.** Admin/owner puede abrir la cerradura (acceder a `/settings/*`) para configurar o administrar, pero ni siquiera admin ve el contenido del place cuando está cerrado.

El horario **no es una feature opcional**. Un place sin horario configurado está **cerrado**, no "siempre abierto". Esto implementa literalmente el principio del blueprint: _"el horario es el alma del lugar, no una feature"_.

## Estados del place respecto al horario

Tres estados, representados como `OpeningHours` discriminated union en `Place.openingHours` (JSONB):

1. **`unconfigured`** (default al crear). Equivale a "cerrado indefinidamente". La UI de `<PlaceClosedView>` muestra "Horario aún no configurado. Contactá al admin".
2. **`always_open`** — 24/7. Soportado técnicamente en el shape y en `isPlaceOpen`, pero **sin UI en MVP** para evitar que se active por error. Admin puede cambiarlo vía SQL hasta que se habilite el toggle en settings.
3. **`scheduled`** — ventanas recurrentes por día de semana + excepciones por fecha. El 99% de los places productivos usan este estado.

## Comportamiento por rol (hard gate)

Ver también `Arquitectura del gate` abajo.

- **Member** (no admin, no owner): cuando el place está cerrado, cualquier ruta bajo `{slug}.place.app/*` renderiza `<PlaceClosedView variant="member">`. No puede ver foro, eventos, miembros, threads ni portada. Sí puede ver el inbox universal (`app.place.app`), que vive fuera del subdomain del place.
- **Admin / owner**: cuando el place está cerrado, SOLO las rutas bajo `/settings/*` son accesibles. Cualquier otra ruta también muestra `<PlaceClosedView variant="admin">`, con un CTA "Ir a configuración" que lleva a `/settings/hours`. Esta excepción existe para evitar deadlock: un place recién creado nace `unconfigured` y el owner debe poder configurarlo.
- **No-miembro autenticado**: gate de membership previo (404 en el layout padre). El horario es irrelevante — nunca llega a verse.
- **Visitante anónimo**: gate de sesión previo (redirect a login). Igual — el horario no cambia nada.

Invariante: **un admin/owner nunca ve el contenido del place cuando está cerrado**, no solo el member. Esta es la corrección del bug que tenía la ontología anterior (`docs/ontologia/conversaciones.md` decía "lectura disponible fuera de horario"; ese contrato se corrige a "sin acceso al contenido fuera de horario").

## Arquitectura del gate

Se implementa con **route groups de Next 15**. Árbol relevante en `src/app/[placeSlug]/`:

```
[placeSlug]/
├── layout.tsx                 # auth + place + membership gate (NO gate de horario)
├── (gated)/                   # route group — aplica el hard gate por horario
│   ├── layout.tsx             # evalúa isPlaceOpen; si cerrado → <PlaceClosedView>
│   ├── page.tsx               # portada
│   ├── m/[userId]/page.tsx    # perfil de miembro
│   └── thread/[id]/page.tsx   # thread
└── settings/                  # NO está dentro de (gated) — accesible cuando cerrado
    ├── layout.tsx             # gate admin/owner consolidado
    ├── members/page.tsx
    └── hours/page.tsx
```

Los route groups `(gated)` **no alteran las URLs** (el paréntesis es invisible en la URL final). Son una herramienta de Next para compartir layout entre rutas hermanas sin agrupar en el path.

Responsabilidades por capa:

| Layout                            | Chequea                                       | Si falla                                               |
| --------------------------------- | --------------------------------------------- | ------------------------------------------------------ |
| `[placeSlug]/layout.tsx`          | sesión, place existe/no archivado, membership | redirect login / `notFound()` / `notFound()`           |
| `[placeSlug]/(gated)/layout.tsx`  | `isPlaceOpen(hours, now)`                     | renderiza `<PlaceClosedView>` en lugar de `{children}` |
| `[placeSlug]/settings/layout.tsx` | `isOwner \|\| role === 'ADMIN'`               | `notFound()`                                           |

## Shape de datos

Persistido en `Place.openingHours` (JSONB, ya existe en `prisma/schema.prisma:33`). No requiere migración.

```ts
type DayOfWeek = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN'
type TimeOfDay = `${number}${number}:${number}${number}` // "HH:MM" 24h
type RecurringWindow = { day: DayOfWeek; start: TimeOfDay; end: TimeOfDay }
type DateException =
  | { date: string; closed: true } // cierre forzado (feriado)
  | { date: string; windows: Array<{ start: TimeOfDay; end: TimeOfDay }> } // apertura extraordinaria

type OpeningHours =
  | { kind: 'unconfigured' }
  | { kind: 'always_open'; timezone: string }
  | {
      kind: 'scheduled'
      timezone: string
      recurring: RecurringWindow[]
      exceptions: DateException[]
    }
```

`date` formato `YYYY-MM-DD` **interpretado en el `timezone` del place** (no UTC). Un feriado `2026-12-25` en un place con timezone `Europe/Madrid` se activa durante el 25 de diciembre hora Madrid.

## Invariantes

- **Ventana válida:** `start < end` (string compare funciona para `HH:MM`).
- **Sin overlap:** ventanas del mismo día no se superponen; las ventanas de una misma excepción tampoco.
- **Timezone IANA válido** y pertenece a `ALLOWED_TIMEZONES` (lista controlada en `domain/timezones.ts`; ~20 timezones comunes).
- **Fechas de excepción únicas:** no se permite dos excepciones con la misma `date`.
- **Cross-midnight NO soportado:** una ventana `{start:'22:00', end:'01:00'}` es inválida. Para abrir hasta las 01 del día siguiente se definen dos ventanas: `{day:'SAT', start:'22:00', end:'23:59'}` + `{day:'SUN', start:'00:00', end:'01:00'}`. Documentado en UI.
- **HH:MM:** `00:00 ≤ start < end ≤ 23:59`. El punto superior excluye `24:00` (no es hora válida).

## Contrato de horario y timezone

- `start`/`end` se guardan en el timezone del place (no se convierten a UTC). Un place con timezone `America/Argentina/Buenos_Aires` y ventana `{day:'THU', start:'19:00', end:'23:00'}` está abierto los jueves de 19 a 23 hora BA, sin depender de DST ni del horario del viewer.
- El cálculo de `isPlaceOpen(hours, now)` convierte `now` (UTC en server) → hora local del place usando librería IANA-aware (`@js-temporal/polyfill` o `date-fns-tz`, decidido en H.B según deps actuales).
- **DST:** si el timezone del place observa cambio de hora, la ventana `02:00-03:00` durante la noche del cambio puede no existir o existir dos veces. La librería IANA resuelve. Tests explícitos de `Europe/Madrid` último domingo de marzo/octubre.
- **Multi-timezone en un mismo place:** fuera de scope MVP. Un place tiene un único timezone.

## Fallback ante datos corruptos

`parseOpeningHours(raw)` (en `schemas.ts`) hace safe parse con Zod. Si el JSON persistido no matchea ningún discriminador → retorna `{ kind: 'unconfigured' }` + log `warn` estructurado con el JSON inválido y el `placeId`. El place queda cerrado hasta que se arregle manualmente en DB. **No crashea la request**.

## Transición abierto → cerrado mid-session

MVP no hace polling. Si el viewer está navegando cuando llega el `closesAt`, la UI queda como estaba hasta la próxima request; en ese momento el layout recalcula `isPlaceOpen` y muestra `<PlaceClosedView>`. Aceptado como UX trade-off del MVP.

Agendado como gap técnico en `docs/roadmap.md`: "refresh automático al `closesAt`" — polling o `setTimeout` client-side que dispare `router.refresh()` al instante de cierre.

## Flows principales

### Configurar horario (admin/owner)

1. Admin entra a `{slug}.place.app/settings/hours`.
2. El layout de `settings/` verifica `isOwner || role === 'ADMIN'` → `notFound()` si no.
3. Server component carga `findPlaceHours(place.id)` y pasa defaults al `<HoursForm>` (client).
4. Admin edita: timezone, ventanas recurrentes por día, excepciones.
5. Submit → `updatePlaceHoursAction`:
   - Valida con Zod (`ValidationError` si falla).
   - Rechequea membership (`AuthorizationError`).
   - `prisma.place.update({ openingHours: serialized })`.
   - Log estructurado (`placeHoursUpdated` con `actorId`, `placeId`, hash del config).
   - `revalidatePath('/<slug>', 'layout')` para que el layout recalcule.
6. UI queda en la misma pantalla con el nuevo estado aplicado.

### Miembro intenta entrar fuera de horario

1. Request a `{slug}.place.app/thread/abc`.
2. Middleware hace auth gate → sesión OK.
3. `[placeSlug]/layout.tsx` valida place + membership → OK.
4. `[placeSlug]/(gated)/layout.tsx` lee hours (cache de request), evalúa `isPlaceOpen(hours, new Date())`.
5. Cerrado → renderiza `<PlaceClosedView variant="member" opensAt={...}>` en lugar de `{children}`.
6. Al llegar el `opensAt`, miembro hace refresh manual → layout recalcula → ve el contenido.

### Admin intenta entrar fuera de horario

Mismo flow que miembro hasta paso 4. En paso 5, variant `"admin"` incluye CTA "Ir a configuración" → click lleva a `/settings/hours` → el layout de `settings/` no tiene gate de horario → admin puede configurar.

### Fase 5+ — server action de escritura en conversaciones

Cuando se implemente `createThreadAction`, al tope:

```ts
await assertPlaceOpenOrThrow(placeId) // throws OutOfHoursError si cerrado
```

`OutOfHoursError` propagado al cliente → UI muestra "El place está cerrado, abrimos X". Defensa en profundidad: la UI ya no debería mostrar el composer cuando el place está cerrado (gate de `(gated)/layout.tsx`), pero el assert protege contra llamadas directas a la action.

## Integración con slices futuros

- **Fase 5 (conversaciones):** `src/features/conversations/server/actions.ts` (cuando exista) importa `assertPlaceOpenOrThrow` desde `features/hours/public.ts` y lo llama al tope de `createThreadAction`, `sendMessageAction`, `uploadAudioAction`, etc. El mounting de widgets de conversaciones en la portada NO necesita el assert — ya están detrás de `(gated)/layout.tsx`.
- **Fase 6 (eventos):** mismo patrón. Además, según `docs/ontologia/eventos.md:95-100`, un evento virtual fuera del horario regular del place "abre" el place solo para ese evento — esa lógica se resuelve en `events/` pisando el estado de hours para los invitados al evento. Se especifica en la spec de eventos cuando toque.
- **Portada (Fase 7):** renderiza widgets de conversaciones/eventos según `enabledFeatures`. Ya está gated por horario; la lógica de portada no necesita saber de hours directamente.

## Casos de uso cubiertos

- **Pub de amigos** (`{day:'THU', start:'19:00', end:'23:00'}`, timezone BA).
- **Taller profesional** (`{day:'SAT', start:'09:00', end:'13:00'}`, timezone BA o Madrid).
- **Empresa pequeña en horario laboral** (L-V, 09:00-18:00, timezone local).
- **Iglesia 24/7** (`{kind:'always_open', timezone:'America/Buenos_Aires'}`; seteado por SQL hasta habilitar en UI).
- **Apertura extraordinaria** (ejemplo: place `L-V 07-15`, excepción `{date:'2026-04-29', windows:[{start:'10:00', end:'17:00'}]}` abre el sábado 29 de abril).
- **Cierre por feriado** (ejemplo: place `L-V 09-18`, excepción `{date:'2026-12-25', closed:true}` lo mantiene cerrado aunque el día 25 sea viernes).
- **Múltiples ventanas por día** (ejemplo: `L-V 07:00-11:00` + `L-V 15:00-20:00`, dos ventanas independientes por día).

## Errores estructurados

| Error                | Código `DomainError` | Cuándo                                                                   |
| -------------------- | -------------------- | ------------------------------------------------------------------------ |
| `ValidationError`    | `VALIDATION`         | Input del form inválido (overlap, `end<=start`, timezone fuera de lista) |
| `AuthorizationError` | `AUTHORIZATION`      | `updatePlaceHoursAction` sin ser admin/owner                             |
| `NotFoundError`      | `NOT_FOUND`          | Place no existe o está archivado                                         |
| `OutOfHoursError`    | `OUT_OF_HOURS`       | `assertPlaceOpenOrThrow` cuando el place está cerrado                    |

`OutOfHoursError` expone `{ placeId, opensAt: Date \| null }` para que la UI pueda renderizar "abrimos X" o "sin horario configurado".

## Seguridad

- `updatePlaceHoursAction` lee `actorId` del `auth.getUser()` del server client — nunca del input del form.
- Validación doble (client Zod + server Zod) con el **mismo schema** importado desde `features/hours/schemas.ts`.
- `findPlaceHours` y `assertPlaceOpenOrThrow` están marcados `'server-only'` — no se ejecutan en cliente.
- **Rate limiting** de `updatePlaceHoursAction`: agendado como gap técnico (extender el rate limit compartido, máx 10 updates/admin/hora).
- **Audit trail**: `placeHoursUpdated` se logea con pino hoy; cuando exista `AuditLog` (gap agendado en Fase 2), se escribe también ahí.

## Fuera de scope MVP

- Toggle de `always_open` en UI.
- Cross-midnight windows sin partir en dos.
- Recurrencia compleja (cada 2 semanas, último día del mes, n-ésimo día de la semana).
- Múltiples timezones por place.
- Feriados automáticos por país (integrar con `date-holidays`).
- Refresh automático al `closesAt` (polling client-side).
- UI de "historial de cambios de horario" (cubierto parcialmente por audit trail futuro).
- Sincronización con Google Calendar / ICS del admin.

## Verificación

Al completar H.G:

1. **Unit tests** (`pnpm test`):
   - `__tests__/is-place-open.test.ts`: unconfigured / always_open / scheduled (dentro/fuera ventana) / excepción closed / excepción con windows / múltiples ventanas mismo día / timezone BA+Madrid / DST / cross-midnight rechazado por schema.
   - `__tests__/schemas.test.ts`: rechaza timezone no en lista, overlap, `end<=start`, `date`/`time` mal formados.
   - `__tests__/update-hours.test.ts`: sin sesión, member no-admin, input inválido, place archivado, happy path admin, happy path owner.
   - `__tests__/assert-place-open.test.ts`: abierto / cerrado / always_open / unconfigured.
2. **E2E** (`tests/e2e/hours.spec.ts`, opcional pero recomendado):
   - Owner recién creado → gate cerrado → settings/hours → configurar → gate desaparece.
   - Member con place cerrado → gate visible en `/`, `/thread/x`, `/m/y`.
   - Member con place abierto → contenido visible.
3. **MCP `execute_sql`** (manual con cloud dev):
   ```sql
   SELECT slug, "openingHours" FROM "Place" WHERE slug = 'mi-place';
   ```
   Confirma que el JSON persistido matchea el schema (kind, timezone, recurring, exceptions).
4. **Build** (`pnpm build`): verde. Sin errores de route group ni rename de archivos.
5. **Manual end-to-end**:
   - Crear place → entrar como owner → ver `<PlaceClosedView variant=admin>` → ir a settings → configurar timezone + ventana que incluya ahora → volver → ver contenido.
   - Invitar member → member entra fuera de horario → ve `<PlaceClosedView variant=member>` sin CTA de settings.
   - Como admin fuera de horario → `/thread/x` → ve `<PlaceClosedView variant=admin>`; `/settings/hours` → pasa.
