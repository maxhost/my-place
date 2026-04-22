# Places — Especificación

> **Alcance:** ciclo de vida del objeto `Place` — creación, listado "mis places" desde el inbox, archivado. No cubre membership (`members/spec.md`), billing real (Fase 3), ni feature flags (Fase 4), que se enchufan encima de este slice.

> **Referencias:** `docs/blueprint.md` (qué es un place), `docs/architecture.md` (slices, boundaries), `docs/data-model.md` (schema), `docs/multi-tenancy.md` (slug → subdomain), `docs/theming.md` (themeConfig), `docs/ontologia/miembros.md` (rol contextual), `CLAUDE.md` (principios no negociables), `docs/features/auth/spec.md` (sesión universal).

## Modelo mental

- Un **Place** es el lugar digital. Tiene identidad visual propia, ritmo propio, miembros propios. Máximo 150 personas.
- La **identidad del Place** es: `slug` (subdomain inmutable), `name`, `description?`, `themeConfig` (colores), `openingHours` (horario — `features/hours/spec.md`), `billingMode`, `enabledFeatures`.
- Un place recién creado **nace cerrado** (`openingHours = {}`, interpretado como `unconfigured`). El owner tiene acceso permanente a `/settings/*` (incluido `/settings/hours`) para poder configurarlo. El resto del contenido queda gated hasta que se configure un horario y éste incluya al momento actual.
- **Ownership y membership son ortogonales.** Crear un place te hace `PlaceOwnership` + `Membership(role=ADMIN)` en ese place, pero son dos filas distintas con significado distinto (ver `members/spec.md`).
- **No hay límite de places por usuario.** Un usuario puede ser owner de N places simultáneamente, miembro de M places, y las dos cosas no se interfieren.
- **Sin perfil público de place fuera de la app.** Un place no listado en el inbox de nadie es invisible. No existe un directorio global.

## Scope del slice

Este slice entrega:

1. **Crear** un place (`createPlaceAction`) desde `app.place.app/places/new`.
2. **Listar "mis places"** (`listMyPlaces`) en el inbox de `app.place.app` — membresías activas del usuario logueado, con flag `isOwner`.
3. **Archivar** un place (`archivePlaceAction`) — solo owner, no borra datos.

Fuera de este slice (se entregan en otros milestones):

- Invitar miembros, aceptar, salir, transferir ownership → `members/spec.md` (Fase 2.D–2.F).
- Editar `themeConfig` del place → Fase 7 (portada y zonas).
- Editar `openingHours` → `features/hours/spec.md` (slice Hours, intercalado entre Fase 2 y Fase 3).
- Configurar `enabledFeatures` desde UI → Fase 4.
- Conectar `stripeCustomerId`/`stripeConnectId` → Fase 3.
- Borrar (hard delete) un place — **no existe**. Solo archivar.

## Modelo de datos tocado

El schema ya existe en `prisma/schema.prisma`. Este slice **no modifica** el schema; sólo escribe contra:

- `Place` — una fila por place creado.
- `Membership` — una fila `(creator, place, role=ADMIN)` al crear.
- `PlaceOwnership` — una fila `(creator, place)` al crear.

Se apoya en la constraint `@@unique([userId, placeId])` de ambas tablas para garantizar idempotencia y no duplicar roles del mismo user en el mismo place.

## Slug

- Formato: `^[a-z0-9-]{3,30}$` — lowercase, dígitos, guiones. Sin underscore, sin mayúsculas, sin dots. Mín 3 / máx 30 chars.
- **Inmutable** post-creación. No hay action de "cambiar slug" en MVP. Editar el slug rompería URLs compartidas, notificaciones pendientes, referencias externas.
- **No reservado**: se valida contra `src/shared/config/reserved-slugs.ts` (`isReservedSlug`). Lista actual incluye `app`, `www`, `api`, `admin`, `staging`, `dev`, `test`, `docs`, `mail`, `status`, `blog`, `help`, `support`, `assets`, `static`, `cdn`. Intentar `app` como slug falla con `ReservedSlugError`.
- **Único global**: constraint `@unique` en DB. Si dos usuarios intentan crear el mismo slug simultáneamente, el segundo recibe `SlugTakenError` (mapeo de `P2002`).
- **No validado contra squatting** en MVP. Un user puede reservar "anthropic" sin ser Anthropic. Ver gap técnico: "Anti-squatting de slugs" (se agenda cuando aparezca el requerimiento).

## Crear un place

**Input** (validado con Zod en `schemas.ts`):

```
{
  slug:        string  // ^[a-z0-9-]{3,30}$ + !isReservedSlug
  name:        string  // trim, 1..80
  description: string? // trim, 0..280, null si vacío
  billingMode: "OWNER_PAYS" | "OWNER_PAYS_AND_CHARGES" | "SPLIT_AMONG_MEMBERS"
}
```

**Precondiciones:**

- Sesión activa (el middleware garantiza que `/places/new` es ruta protegida; ver `auth/spec.md`).
- `User` local existe (lo garantiza el callback de auth; ninguna acción de dominio crea `User`).

**Flow del server action `createPlaceAction`:**

1. Parse/validate input con Zod. Falla → `ValidationError`.
2. Invariantes de dominio (`domain/invariants.ts`):
   - `assertSlugFormat(slug)` → regex check.
   - `assertSlugNotReserved(slug)` → usa `isReservedSlug` de shared.
3. Pre-check (query): `findPlaceBySlug(slug)` — si existe, `SlugTakenError` (evita transacción fallida en el caso común). El race real se cubre por la constraint en DB.
4. **Transacción Prisma** (`prisma.$transaction`):
   - `INSERT Place` con `themeConfig = {}` (defaults del tema se aplican en UI), `openingHours = {}`, `enabledFeatures` default del schema (`["conversations","events","members"]`).
   - `INSERT PlaceOwnership(userId=actor, placeId=nuevo)`.
   - `INSERT Membership(userId=actor, placeId=nuevo, role=ADMIN)`.
   - Si cualquier step falla → rollback completo.
5. Si la transacción falla por `P2002` en `Place.slug` → `SlugTakenError`.
6. Log estructurado (`placeCreated`) con `{ requestId, placeId, slug, actorId, billingMode }`. Sin email en el log.
7. `revalidatePath('/inbox')` para que el nuevo place aparezca en el inbox inmediatamente.
8. Retorna `{ ok: true, place: { id, slug } }` — la UI redirige a `https://{slug}.place.app/`.

**Decisión:** el `billingMode` se **almacena** pero no se **valida** contra integraciones de Stripe en Fase 2. En Fase 3 se agregará el flujo de onboarding a Stripe y el place quedará en `pending_billing` hasta completarlo. En Fase 2 es un campo obligatorio con validación de enum — nada más.

**Decisión:** el `themeConfig` del place nace vacío (`{}`); la UI aplica defaults al renderizar. Evita acoplar Fase 2 con decisiones de Fase 7 sobre validación de contraste (WCAG AA).

## Listar "mis places"

**Query `listMyPlaces(userId)`:**

- JOIN `Place` + `Membership` donde `Membership.userId = :userId` y `Membership.leftAt IS NULL`.
- Excluye `Place.archivedAt IS NOT NULL` por default.
- Incluye un flag `isOwner: boolean` derivado de `EXISTS (SELECT 1 FROM PlaceOwnership WHERE userId = :userId AND placeId = Place.id)`.
- Retorna `Array<{ id, slug, name, description, themeConfig, role, isOwner, joinedAt }>`.

Opcional: parámetro `{ includeArchived: boolean }` para una vista futura "mis places archivados" (no se entrega UI en 2.C, pero el query lo soporta).

**UI (`ui/places-list.tsx`):**

- Server component. Recibe el array y renderiza cards.
- Diferencia visualmente places donde `isOwner === true` vs solo miembro. El contraste es sutil (principio "nada grita"): un badge minimalista "owner" o un borde distinto, no colores saturados.
- Si el array está vacío: estado "no pertenecés a ningún place todavía" + link "Crear uno".
- Cada card es un link a `https://{slug}.place.app/` (se construye con `buildPlaceUrl(slug, appDomain)` de shared).

**Renderiza en:** `src/app/inbox/page.tsx` — pasa a invocar el query y montar `<PlacesList>`.

**Multi-place observable:** el inbox muestra simultáneamente places donde el usuario es owner y places donde es solo miembro, sin segmentarlos en tabs. Son "mis places", punto.

## Archivar

**Server action `archivePlaceAction(placeId)`:**

1. Verifica sesión.
2. Query: `PlaceOwnership` existe para `(actorId, placeId)`. Si no → `AuthorizationError` (solo owner archiva; ADMIN sin ownership **no puede**).
3. `UPDATE Place SET archivedAt = NOW() WHERE id = :placeId AND archivedAt IS NULL`.
4. Si `archivedAt` ya estaba seteado (idempotente): retorna `{ ok: true, alreadyArchived: true }` sin error.
5. Log estructurado (`placeArchived`) con `{ requestId, placeId, actorId }`.
6. `revalidatePath('/inbox')`.
7. Retorna `{ ok: true }`.

**Efectos del archive:**

- El place deja de aparecer en `listMyPlaces` por default.
- El subdomain `{slug}.place.app/` **responde 404** (el middleware chequea `archivedAt` antes de habilitar el acceso — se agrega en 2.C junto con el query).
- Las invitaciones pendientes contra un place archivado se rechazan con `PlaceArchivedError` (se cubre cuando aparezca en 2.E).
- **No borra datos.** El place, sus memberships, su ownership, sus invitaciones quedan en DB. Desarchivar es futuro (gap técnico: "Unarchive de place").

**Decisión:** archivar **no** transfiere ownership ni expulsa miembros. Si un owner archiva un place del que también es miembro otro owner, ambos pierden acceso hasta desarchivar. Esto es intencional: archivar es una acción drástica y consciente.

## Multi-place — casuística explícita

Este slice debe preservar y tener cubierto en tests:

1. **User crea N places en secuencia.** Cada `createPlaceAction` genera un `Place` + `PlaceOwnership` + `Membership(ADMIN)` independiente. No hay límite por user.
2. **User es owner de place A + miembro simple de place B.** `listMyPlaces(user)` retorna ambos; A con `isOwner=true, role=ADMIN`, B con `isOwner=false, role=MEMBER`.
3. **User es miembro simple de A + ADMIN sin ownership de B.** `listMyPlaces` retorna ambos; A con `isOwner=false, role=MEMBER`, B con `isOwner=false, role=ADMIN`. (ADMIN-sin-ownership se da cuando la ownership se transfiere a otro owner pero el admin conserva su `Membership.role=ADMIN` — ver `members/spec.md` Fase 2.F.)
4. **User dejó place C (`leftAt != null`).** `listMyPlaces` lo excluye por default incluso si sigue teniendo `PlaceOwnership` (caso borde que 2.F impide, pero el query debe ser robusto).
5. **User archivó place D del que es único owner.** `listMyPlaces` lo excluye; `archivePlaceAction` sobre el mismo `placeId` retorna idempotencia.

Los tests de `__tests__/create-place.test.ts` y `__tests__/list-places.test.ts` ejercitan estos escenarios explícitamente (el plan 2.C lista los casos mínimos).

## Invariantes

- **Mínimo 1 `PlaceOwnership` por place, siempre.** El `createPlaceAction` la crea junto con el place; la eliminación o transferencia se cubre en `members/spec.md` Fase 2.F (nunca deja el place sin owners).
- **Mínimo 1 `Membership` activa del owner al crear.** Garantizado por la transacción.
- **Slug único global + inmutable.** Constraint DB + ausencia de action de update.
- **`archivedAt` es monótono**: una vez seteado, no se des-setea en Fase 2 (desarchivar es gap agendado).
- **No crear `User` en este slice.** Si `actorId` no existe en `User` (imposible si el middleware y el callback funcionan), el `INSERT Membership` falla por FK. Es un síntoma de bug upstream, no un caso a manejar en el dominio.

## Errores estructurados

| Error                | Código de `DomainError` | Cuándo                                              |
| -------------------- | ----------------------- | --------------------------------------------------- |
| `SlugFormatError`    | `VALIDATION`            | Slug no matchea `^[a-z0-9-]{3,30}$`                 |
| `ReservedSlugError`  | `VALIDATION`            | Slug está en `reserved-slugs.ts`                    |
| `SlugTakenError`     | `CONFLICT`              | Slug ya existe (pre-check o `P2002` en tx)          |
| `BillingModeError`   | `VALIDATION`            | `billingMode` no es un valor del enum               |
| `PlaceNotFoundError` | `NOT_FOUND`             | `archivePlaceAction` con `placeId` inexistente      |
| `AuthorizationError` | `AUTHORIZATION`         | `archivePlaceAction` sin `PlaceOwnership` del actor |

Cada error genera log estructurado con `requestId`. La UI traduce `errorCode` a mensajes en español. Nunca se expone `message` o `stack` crudos.

## Seguridad

- Todas las mutations son **server actions** — Next 15 + secure cookies valida origin automáticamente (`auth/spec.md`).
- El slug se valida tanto en cliente (Zod del form) como en server action (doble check). El primer check es UX; el segundo es la barrera real.
- `createPlaceAction` y `archivePlaceAction` leen `userId` del `auth.getUser()` del server client — **nunca** del input del form. El usuario no puede crear un place a nombre de otro.
- No se aceptan URLs externas en `themeConfig` en este slice (queda `{}`). Cuando se habilite la edición en Fase 7, se validará schema completo con Zod + allowlist de valores.
- Rate limiting: el plan incluye "Rate limiting compartido" como gap técnico. Cuando se agregue, `createPlaceAction` quedará bajo el límite "max 5 places / user / día" documentado en el plan.

## Timezone

El campo `openingHours` del place se inicializa como `{}` en el `createPlaceAction` (interpretado como `unconfigured` por el slice Hours — place cerrado hasta configurar).

El contrato completo del horario (shape, invariantes, gate por rol, utility `isPlaceOpen`, timezones IANA permitidos, DST, etc.) vive en `docs/features/hours/spec.md`. El slice `places` solo inicializa el campo y no interpreta su contenido.

## Fuera de scope

- Editar `name`, `description`, `themeConfig`, `enabledFeatures` — se entregan en sus fases correspondientes (4, 7).
- Editar `openingHours` — slice `hours` (ver `docs/features/hours/spec.md`).
- Desarchivar un place — gap técnico agendado.
- Transferir ownership al crear (crear en nombre de otro) — no se soporta.
- Borrar (hard delete) un place — no existe.
- Cambiar `billingMode` post-creación — explícitamente out-of-scope en `docs/roadmap.md`.
- Directorio público de places — viola "sin perfil público fuera de places".
- Importar/exportar place — futuro, no MVP.
- Slugs personalizados (nombres de dominio custom) — futuro; en MVP todos viven bajo `*.place.app`.

## Verificación

Al completar los sub-milestones 2.B y 2.C:

1. **Unit tests** (`pnpm test`):
   - `__tests__/create-place.test.ts` cubre slug reservado, slug duplicado, billing mode inválido, happy path (verifica filas en `Place` + `PlaceOwnership` + `Membership`), creador queda como ADMIN+owner.
   - `__tests__/list-places.test.ts` cubre: user sin places → `[]`; user con places mixtos (owner + miembro + admin-sin-ownership) retorna todos con flags correctos; excluye archivados; excluye memberships con `leftAt`.
   - `__tests__/archive-place.test.ts` cubre: no-owner falla, owner happy path, idempotencia, 404 en slug de place archivado.
2. **E2E** (`pnpm test:e2e`, `tests/e2e/places.spec.ts`): usuario logueado visita `/places/new`, crea place, es redirigido al subdomain, el inbox ahora lista el place.
3. **Manual con cloud dev** (MCP `execute_sql`):
   ```sql
   SELECT p.slug, p.name, m.role, o.user_id IS NOT NULL AS is_owner
   FROM "Place" p
   JOIN "Membership" m ON m.place_id = p.id
   LEFT JOIN "PlaceOwnership" o ON o.place_id = p.id AND o.user_id = m.user_id
   WHERE m.user_id = :me;
   ```
   Confirma que cada place tiene al menos 1 `PlaceOwnership` y que el creator tiene `role=ADMIN`.
4. **Multi-place manual**: crear place X, crear place Y (mismo user), verificar que inbox lista los 2, ambos con `isOwner=true`.
5. **Build** (`pnpm build`): verde. Sin warnings de tipos ni de server/client boundary.
