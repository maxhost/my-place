# Members — Especificación

> **Alcance:** ciclo de vida de la `Membership` de un usuario en un place — invitación, aceptación, salida, transferencia de ownership, perfil contextual mínimo. Es el objeto que hace posible el multi-tenancy desde la perspectiva de la persona.

> **Referencias:** `docs/ontologia/miembros.md` (canónico), `docs/data-model.md` (invariantes, 365d), `docs/blueprint.md` (150 máx), `docs/features/auth/spec.md` (sesión universal), `docs/features/places/spec.md` (ownership+membership ortogonales), `CLAUDE.md` (identidad se construye por contribución).

## Modelo mental

- **Membership es la identidad contextual.** La identidad universal (`User`) es la misma en todo el ecosistema; la identidad contextual vive en `Membership` — antigüedad, rol, contribuciones acumuladas por place.
- **Ownership y membership son ortogonales.** Toda ownership implica membership activa, pero no al revés. Un ADMIN puede existir sin `PlaceOwnership`.
- **Multi-place sin interferencia.** Cualquier operación sobre la membresía en place A no altera ninguna membresía en place B.
- **El place nace, no se vacía.** Máximo 150 miembros activos, mínimo 1 owner. Siempre. El invariante está en el dominio + DB (Fase 2.G).
- **Derecho al olvido, no borrado.** Salir setea `leftAt`; el contenido creado queda atribuido 365 días; pasado ese umbral se anonimiza (cron futuro). El borrado físico no existe en MVP.

## Scope del slice

Este slice entrega (2.E–2.F–2.G–2.H):

1. **Invitar** a un email (`inviteMemberAction`) — owner/admin genera `Invitation`, Supabase envía el email.
2. **Aceptar** una invitación (`acceptInvitationAction`) — usuario logueado canjea el token y pasa a ser `Membership(MEMBER|ADMIN)` del place.
3. **Salir** del place (`leaveMembershipAction`) — setea `leftAt`; bloquea si es único owner.
4. **Transferir ownership** (`transferOwnershipAction`) — owner cede su `PlaceOwnership` a otro miembro del place.
5. **Ver perfil contextual** del miembro — `/{placeSlug}/m/{userId}` — con antigüedad y placeholders para contribuciones.
6. **Enforcer DB** del límite 150 (trigger SQL en 2.G).

Fuera del slice (difieren a otras fases o gaps técnicos):

- Roles granulares más allá de `MEMBER | ADMIN` → futuro.
- Cron de anonimización a los 365 días → **implementado en C.L** (ver ADR `docs/decisions/2026-04-24-erasure-365d.md`).
- DMs entre miembros (ver `docs/ontologia/miembros.md` § DMs) → post-MVP.
- UI de "settings > miembros" con lista completa → Fase 2.F (parcial) y Fase 7 (completo).
- Búsqueda/filtro de miembros → post-MVP.
- Onboarding post-registro (editar `displayName`, `handle`, `avatarUrl`) → Fase 8.

## Modelo de datos

Se apoya en el schema existente y agrega **un único campo** en `Invitation`:

```prisma
model Invitation {
  id         String    @id @default(cuid())
  placeId    String
  email      String
  invitedBy  String
  asAdmin    Boolean   @default(false)  // NUEVO
  acceptedAt DateTime?
  expiresAt  DateTime
  token      String    @unique

  place Place @relation(fields: [placeId], references: [id])

  @@index([placeId])
  @@index([email])
  @@unique([placeId, email, acceptedAt])  // evita múltiples invitaciones abiertas al mismo email
}
```

**Decisiones:**

- `asAdmin` es un flag de **rol al aceptar**. No otorga `PlaceOwnership`. Owner se transfiere vía `transferOwnershipAction`, nunca via invitación.
- `@@unique([placeId, email, acceptedAt])` es parcial: Postgres trata dos `NULL` como distintos en unique, así que **no evita duplicados de invitaciones abiertas** (acceptedAt = NULL). Se aplica un **unique index parcial** vía migración SQL:
  ```sql
  CREATE UNIQUE INDEX invitation_open_unique
    ON "Invitation" ("placeId", lower("email"))
    WHERE "acceptedAt" IS NULL;
  ```
  Así se evita spam de invitaciones abiertas al mismo email mientras permite reinvitar después de aceptar/expirar.
- `email` se normaliza a lowercase antes de persistir (ver "Invitar").
- **Migración**: `prisma/migrations/<ts>_invitation_as_admin_and_unique_open/` agrega columna + índice parcial.

## Flows

### Invitar (`inviteMemberAction`)

**Input** (Zod):

```
{
  placeSlug:  string       // resuelve placeId internamente
  email:      string       // email, se lowercasea y trimea
  asAdmin:    boolean      // default false
}
```

**Precondiciones:**

- Sesión activa.
- Actor es `MembershipRole.ADMIN` **o** tiene `PlaceOwnership` en el place (el check es `role=ADMIN` OR `owner`).
- Place no archivado (`archivedAt IS NULL`).

**Flow (tx corta + delivery fuera de tx):**

1. Parse input → `ValidationError` si falla.
2. Resolver `placeId` por `placeSlug`. Si place archivado → `ConflictError`. Si no existe → `NotFoundError` (en ambos casos la UI responde 404 — no se filtra diferencia).
3. `assertInviterHasRole(actorId, placeId)` — consulta `PlaceOwnership` + `Membership.role`. Si no cumple → `AuthorizationError`.
4. `countActiveMemberships(placeId)` ≥ 150 → `InvariantViolation` **pre-envío**. (Trigger DB 2.G es la red de seguridad; este check ahorra trabajo del mailer.)
5. **Tx corta** — `INSERT Invitation` con:
   - `token = base64url(crypto.getRandomValues(32 bytes))` (Edge-safe; no `node:crypto`).
   - `expiresAt = now() + 7 días`.
   - `deliveryStatus = PENDING`.
   - El unique parcial protege contra duplicados con `acceptedAt IS NULL`: si ya hay una invitación abierta a ese `(placeId, email)`, el insert falla con `P2002` → se mapea a `ConflictError { reason: 'already_open' }`. El admin reenvía con el botón de la row existente, no duplica.
6. **Fuera de tx** — `generateInviteMagicLink({ email, redirectTo })`:
   - 1er intento: `admin.auth.admin.generateLink({ type: 'invite', ... })`. Crea `auth.users` si no existe y retorna la URL.
   - Si el SDK devuelve **422 `email_exists`** (el destinatario ya tenía cuenta Supabase) → fallback `generateLink({ type: 'magiclink' })`, que no crea nada pero devuelve una URL de login que respeta el `redirectTo`.
   - `generateLink` **no envía email** en ningún modo — retorna solo la URL, saltando completamente el SMTP interno de Supabase y sus rate limits.
7. **Fuera de tx** — `mailer.sendInvitation({ to, placeName, inviterDisplayName, inviteUrl, expiresAt })` via Resend (dominio `ogas.ar` verificado). Ver ADR `2026-04-20-mailer-resend-primary.md`.
8. **Delivery tracking:**
   - Éxito → `UPDATE Invitation SET deliveryStatus=SENT, providerMessageId=<resend id>, lastSentAt=now()`.
   - Fallo en step 6 → `deliveryStatus=FAILED, lastDeliveryError='link: ...'` + `InvitationLinkGenerationError` al cliente. La row queda visible en "Invitaciones pendientes" con el botón "Reenviar".
   - Fallo en step 7 → `deliveryStatus=FAILED, lastDeliveryError='mailer: ...'` + `InvitationEmailFailedError`. Idem reintento manual.
9. **Webhook de Resend** (`POST /api/webhooks/resend`): cierra el loop de estados vía svix. `email.sent → SENT`, `email.delivered → DELIVERED`, `email.bounced → BOUNCED` + `lastDeliveryError`, `email.complained → COMPLAINED`. Idempotente y con máquina de estados monótona (ver `delivery-transitions.ts`: `BOUNCED`/`COMPLAINED` son terminales).
10. Log estructurado (`invitationSent`) con `{ placeId, invitationId, invitedBy, asAdmin }`. **Sin email crudo** en el log — se redacta (ver `logger.ts`).
11. `revalidatePath('/[placeSlug]/settings/members')`.
12. Retorna `{ ok: true, invitationId }`.

**Reenvío (`resendInvitationAction`):** el admin (owner o ADMIN del place) puede reenviar desde la sección "Invitaciones pendientes" de `/settings/members`. La acción toma el `invitationId`, valida que no esté aceptada ni vencida, regenera el magic link (el token de `Invitation` sigue igual — los tokens de Supabase que van dentro de la URL son lo que rota) y vuelve a disparar el mailer. `providerMessageId` y `lastSentAt` se actualizan a los del último envío. **Solo reenvía el email**: no duplica rows, no crea nuevas invitaciones.

### Aceptar (`acceptInvitationAction`)

**Input:** `{ token: string }` (del path param).

**Flow:**

1. Si el usuario no tiene sesión, la ruta `/invite/accept/[token]` redirige a `/login?next=/invite/accept/{token}`. Después del callback, el `resolveSafeNext` del callback reenvía al accept. **El token se preserva en el path**, no en query — más difícil de filtrar por referrer.
2. Con sesión, server action `acceptInvitationAction`:
   - `findInvitationByToken(token)` → si no existe, `InvitationNotFoundError`.
   - Si `expiresAt < now()`, `InvitationExpiredError`.
   - Si `acceptedAt != null`:
     - Si la membresía del user actor ya existe activa en ese place, retorna `{ ok: true, alreadyMember: true }` (idempotente).
     - Si no existe y el invitee original era otro email, `InvitationAlreadyUsedError`.
   - Si el place está archivado, `PlaceArchivedError`.
3. Resolver identidad del invitee: si el `user.email` no matchea `invitation.email`, igualmente **se acepta** si el user está logueado (Supabase creó la cuenta con el email de la invitación; pero un user podría haber iniciado sesión con otro email antes de clickear el link). **Regla MVP**: el `userId` de la sesión es quien queda como miembro, no se verifica match de email. Esto simplifica el flow y acepta que el admin confía en el destinatario. Se documenta aquí para que quede explícito.
4. **Transacción Prisma:**
   - `countActiveMemberships(placeId)` ≥ 150 → `PlaceCapacityExceededError` (el trigger DB de 2.G también lo cubre como red de seguridad — ambas capas son intencionales).
   - `findActiveMembership(userId, placeId)`:
     - Si existe (idempotencia dura) → marca `Invitation.acceptedAt = now()` si nula y retorna `{ ok: true, alreadyMember: true }`.
     - Si no existe → `INSERT Membership(userId, placeId, role = invitation.asAdmin ? ADMIN : MEMBER, joinedAt = now())`.
   - `UPDATE Invitation SET acceptedAt = now() WHERE id = :id AND acceptedAt IS NULL` (condición evita race).
5. Log estructurado (`invitationAccepted`) con `{ requestId, placeId, invitationId, userId, role }`.
6. `revalidatePath('/inbox')` + `revalidatePath('/[placeSlug]')`.
7. Retorna `{ ok: true, placeSlug, alreadyMember: false }` — la UI redirige a `https://{placeSlug}.place.app/`.

**Multi-place explícito:** el usuario puede estar logueado con membresías activas en places A y B, y aceptar una invitación a C. La transacción **sólo inserta** en C; no toca ninguna fila de A ni B. La sesión universal sigue siendo la misma.

### Salir (`leaveMembershipAction`)

**Input:** `{ placeSlug: string }`.

**Flow:**

1. Sesión obligatoria.
2. Resolver `placeId`, `place.archivedAt`. Si archivado → `PlaceArchivedError` (no tiene sentido salir de algo ya cerrado; además `leftAt` se contaría como parte del content).
3. `findActiveMembership(userId, placeId)`. Si no existe → `NotFoundError` (no sos miembro activo).
4. **Transacción con lock pesimista** sobre `PlaceOwnership` del place:
   ```sql
   SELECT * FROM "PlaceOwnership" WHERE "placeId" = :id FOR UPDATE;
   ```
   En Prisma se usa `$queryRawUnsafe` o `$transaction` con isolation `Serializable`. Se elige `FOR UPDATE` por claridad y para prevenir el caso "dos owners hacen leave concurrentemente".
5. Si el actor tiene `PlaceOwnership`:
   - `countOwnerships(placeId) === 1` → `LastOwnerCannotLeaveError`. Debe transferir primero.
   - Caso contrario: `DELETE PlaceOwnership(userId=actor, placeId)`.
6. `UPDATE Membership SET leftAt = now() WHERE userId = :actor AND placeId = :id AND leftAt IS NULL`.
7. Log estructurado (`memberLeft`).
8. `revalidatePath('/inbox')`.
9. Retorna `{ ok: true }`.

**Borrado de presencia al salir:** el principio ontológico dice que la presencia/actividad se borra inmediato. En MVP esto se aplicará cuando Fase 5 implemente `Presence`/`Reads`. Se documenta acá para que no se olvide: el slice members **no** escribe presencia, pero el cron/hook de borrado de presencia debe leer `Membership.leftAt` como señal.

### Transferir ownership (`transferOwnershipAction`)

**Input:**

```
{
  placeSlug:    string
  toUserId:     string
  removeActor:  boolean   // si true, el actor cede y sale de owner
}
```

**Flow (transaccional):**

1. Sesión + actor tiene `PlaceOwnership` en el place → si no, `AuthorizationError`.
2. Place no archivado.
3. `assertTargetIsMember(toUserId, placeId)` — target debe tener `Membership` **activa** en ESTE place. Si no, `TargetNotMemberError`. (Su estatus en otros places es irrelevante por principio de multi-place.)
4. Si `toUserId === actorId` → `ValidationError` (no tiene sentido transferirse a uno mismo).
5. Lock `FOR UPDATE` sobre `PlaceOwnership` del place.
6. `UPSERT PlaceOwnership(userId=toUserId, placeId)` — idempotente (si ya era owner, no duplica; constraint @@unique lo protege).
7. Si `removeActor === true`: `DELETE PlaceOwnership(userId=actor, placeId)`. Debe quedar ≥ 1 ownership tras la operación — se chequea explícitamente antes del delete.
8. El `Membership.role` del actor **no cambia automáticamente**. Si era ADMIN sigue siendo ADMIN. Si se quiere degradar, se hace en una acción aparte (futuro).
9. Log estructurado (`ownershipTransferred`) con `{ fromUserId, toUserId, placeId, removeActor }`.
10. `revalidatePath('/[placeSlug]/settings/members')`.
11. Retorna `{ ok: true }`.

### Perfil contextual del miembro (2.H)

**Ruta:** `src/app/[placeSlug]/m/[userId]/page.tsx` (server component).

**Acceso:**

- Visitor debe estar logueado (el middleware ya lo garantiza para `{slug}.place.app`).
- Visitor debe ser miembro activo del mismo place (chequeo server-side). Si no → 404 (principio "sin perfil público fuera de places"; un no-miembro no puede confirmar que ese userId existe).
- Si el `userId` objetivo no es miembro del place → 404 (mismo principio).

**Contenido (MVP):**

- Nombre + avatar + handle del `User`.
- Antigüedad: "miembro desde hace X meses" calculado desde `Membership.joinedAt` en UTC, formateado en cliente (`Intl.RelativeTimeFormat` en español).
- Rol visible: "miembro" / "admin" / "owner" (derivado de `Membership.role` + presencia de `PlaceOwnership`).
- Placeholder "contribuciones" deshabilitado con texto "Disponible cuando existan conversaciones y eventos" — se llena en Fase 5/6.
- Sin botón "DM" (DMs son post-MVP). Sin bio. Sin stats.

**Lo que NO hay** (principios ontológicos):

- Bio editable.
- Last-seen / online status.
- Lista de otros places del user.
- Métricas vanidosas.

## Invariantes

| Invariante                                      | Nivel        | Implementación                                                  |
| ----------------------------------------------- | ------------ | --------------------------------------------------------------- |
| Max 150 memberships activas por place           | Dominio + DB | `assertPlaceHasCapacity` en action + trigger SQL (2.G)          |
| Min 1 `PlaceOwnership` por place activo         | Dominio      | `assertMinOneOwner` en leave + transfer (lock `FOR UPDATE`)     |
| `Membership` única `(userId, placeId)`          | DB           | `@@unique([userId, placeId])` ya en schema                      |
| `PlaceOwnership` única `(userId, placeId)`      | DB           | `@@unique([userId, placeId])` ya en schema                      |
| Ownership implica membership activa del owner   | Dominio      | `assertOwnerIsActiveMember` antes de mutations                  |
| Target de transfer debe ser miembro activo      | Dominio      | `assertTargetIsMember`                                          |
| Invitación abierta única por `(placeId, email)` | DB           | Unique index parcial `WHERE acceptedAt IS NULL` (2.E migración) |
| Token de invitación unadivinable                | Dominio      | 32 bytes random via `crypto.getRandomValues` + base64url        |
| Aceptación idempotente                          | Dominio      | Check `findActiveMembership` pre-insert, success silencioso     |
| Actor de invitación tiene permisos              | Dominio      | `assertInviterHasRole` (ADMIN o owner)                          |
| Aceptar invitación no afecta otras membresías   | Estructural  | Transacción solo toca filas del place objetivo                  |

## Errores estructurados

| Error                                        | Código `DomainError`          | Cuándo                                                                 |
| -------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------- |
| Error / causa                                | Código `DomainError`          | Cuándo                                                                 |
| -------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------- |
| Token inexistente                            | `NOT_FOUND`                   | `acceptInvitationAction` no encuentra el token                         |
| Expirada                                     | `VALIDATION`                  | `expiresAt < now()` (accept o resend)                                  |
| Ya usada por otro                            | `CONFLICT`                    | `acceptedAt != null` y el actor no era el invitee y no es miembro ya   |
| Ya aceptada (resend)                         | `CONFLICT`                    | Resend llamado sobre una invitación ya aceptada                        |
| Abierta duplicada                            | `CONFLICT` `already_open`     | `P2002` del unique parcial: ya hay una invitación pendiente al email   |
| Link gen falló (Supabase admin)              | `INVITATION_LINK_GENERATION`  | Ambos intentos `generateLink` fallan, o error no-422 en el primero     |
| Mailer falló (Resend)                        | `INVITATION_EMAIL_FAILED`     | `mailer.sendInvitation` lanza — la row queda `FAILED`, reenviable      |
| Cap 150 miembros                             | `INVARIANT_VIOLATION`         | `countActiveMemberships >= 150` pre-invite o en accept                 |
| Place archivado                              | `CONFLICT`                    | Archivado al invitar, aceptar, salir, transferir                       |
| Último owner no puede salir                  | `INVARIANT_VIOLATION`         | Leave dejaría al place sin owners                                      |
| Inviter/transferrer sin permisos             | `AUTHORIZATION`               | No es ADMIN ni owner                                                   |
| Target transfer no es miembro                | `VALIDATION`                  | Transfer a `toUserId` que no tiene membresía activa                    |
| Input mal formado                            | `VALIDATION`                  | Zod falla                                                              |

**Discriminación cliente-side:** todos los errores se discriminan por `code` (string enum). **No usar `instanceof`** en client-side: el serializador de server actions de Next 15 pierde la prototype chain en el boundary. El helper `isDomainError` (en `@/shared/errors/domain-error`) chequea shape: `code` enumerable + string + dentro de `DOMAIN_ERROR_CODES`. Los constructores de subclases asignan `this.code` explícitamente para que sobreviva `JSON.stringify(err)`.

Cada error genera log estructurado con `requestId`. El email se **redacta siempre** en los logs; lo único que sobrevive es el `invitationId` o el `email hash`.

## Delivery tracking

Columnas nuevas en `Invitation` (migración `20260425000000_invitation_delivery_tracking`):

- `deliveryStatus: InvitationDeliveryStatus` — enum `PENDING | SENT | DELIVERED | BOUNCED | COMPLAINED | FAILED`. Rows existentes backfillean a `PENDING`.
- `providerMessageId: String?` — id de Resend, indexado para lookup O(1) desde webhook.
- `lastDeliveryError: String?` — truncado a 500 chars.
- `lastSentAt: DateTime?` — marca del último envío (útil para debug + UI).

La máquina de estados es monótona por rank (`PENDING < FAILED < SENT < DELIVERED < BOUNCED ≡ COMPLAINED`). `BOUNCED` y `COMPLAINED` son terminales — un `email.delivered` tardío no los revierte. El helper `canTransitionInvitationDelivery` (en `@/features/members/public`) encapsula esta lógica; lo usa el webhook.

## Seguridad

- **Token de invitación unadivinable**: 32 bytes random → 43 chars base64url, espacio 2^256. Edge-safe (sin `node:crypto`).
- **CSRF**: todas las mutations son server actions → Next 15 + cookies `Secure` da CSRF por default.
- **Enumeration**: responder `NotFound` con el mismo mensaje y timing para token-inexistente e invitación-expirada NO es necesario en MVP porque el token es secreto; pero el log los distingue para operación.
- **PII en logs**: el email nunca se loguea crudo. Se redacta vía `redact` del logger. Un admin con acceso DB sí lo ve — es una trade-off consciente.
- **Rate limiting**: `inviteMemberAction` y `resendInvitationAction` entran bajo el gap técnico "Rate limiting compartido" (max 10 invites / owner / hora — TBD). Con `generateLink` de Supabase saltamos el SMTP rate limit, y Resend tiene cuotas de cuenta que no son bloqueantes en MVP.
- **Webhook auth**: `POST /api/webhooks/resend` requiere firma svix válida (`svix-id` + `svix-timestamp` + `svix-signature`). Sin firma válida → 400 (Resend reintenta). `RESEND_WEBHOOK_SECRET` se setea por ambiente desde el dashboard de Resend.
- **Spoofing de email del invitee**: como MVP no verifica match `session.email == invitation.email` al aceptar, un link filtrado puede ser usado por otro user logueado. Mitigaciones futuras (gap): (a) requerir que el user confirme su email vía Supabase antes de aceptar, o (b) validar match y ofrecer login-as-invitee. Se documenta.

## Multi-place — casuística explícita (tests obligatorios)

Los tests de 2.E/2.F ejercitan al menos:

1. Owner de A invita a user B. B ya es miembro activo de C, sin relación con A. Aceptar en A **no toca** su membresía en C. Resultado: B miembro de A y C.
2. Owner de A transfiere ownership a user B, donde B también es owner de place C. Transfer OK; B queda owner de A **y** sigue siendo owner de C. Las ownerships son independientes.
3. Owner de A intenta transferir a user B que NO es miembro de A (pero sí de place C) → `TargetNotMemberError`.
4. User A es owner único de A; también es miembro (MEMBER) de B. Intenta leave de A → `LastOwnerCannotLeaveError`. Leave de B → OK (su ownership en A no se afecta).
5. Dos owners de A hacen leave concurrente: uno gana, el otro falla con `LastOwnerCannotLeaveError` (serialización via `FOR UPDATE`).
6. User A acepta invitación a A mientras el contador de A está en 149 → OK. A = 150. Otra invitación intenta aceptar → `PlaceCapacityExceededError` tanto por el pre-check como por el trigger DB.
7. Aceptar el mismo token dos veces → segunda llamada retorna `alreadyMember: true`, sin lanzar error, sin duplicar membership.

## Fuera de scope (MVP)

- Revocar una invitación abierta (`revokeInvitationAction`) — futuro inmediato si aparece la necesidad.
- Editar rol de un miembro post-aceptación — futuro inmediato (promover MEMBER → ADMIN sin pasar por invitación).
- Banear / expulsar a un miembro — futuro (action `removeMemberAction` con razón).
- Invitación por link público (sin email) — no compatible con "max 150 sin squatting"; fuera de scope.
- Presence en perfil del miembro — Fase 5.
- DMs — post-MVP (`docs/ontologia/miembros.md` § DMs).

## Gaps técnicos relacionados (no bloquean MVP)

- **Cron de anonimización a 365 días** — **IMPLEMENTADO (C.L, 2026-04-24)**. Vercel Cron diario `/api/cron/erasure` + cron audit semanal. Nullifica `Post.authorUserId` / `Comment.authorUserId` + renombra `authorSnapshot.displayName` a "ex-miembro" tras 365d del `leftAt`. Audit trail con `snapshotsBefore` en tabla `ErasureAuditLog` para rollback manual. RLS + filters existentes cumplen la capa 1 (invisibilidad at-leave) sin borrado físico. Ver ADR `docs/decisions/2026-04-24-erasure-365d.md`.
- **Revoke de invitación abierta** — sencillo; action que setea `Invitation.acceptedAt` con un sentinel o flaga "revoked" (requiere columna nueva). Agendar si hay UX push.
- **Verificación email-invitee match en accept** — ver "Seguridad". Agendar antes del lanzamiento público.
- **Invitation email provider custom** — migrar de Supabase default a Resend/Postmark si branding o deliverability lo requiere. Agendar en Fase 8 (marketing) o antes si hace falta.

## Verificación

Al completar 2.E a 2.H:

1. **Unit tests** (`pnpm test`):
   - `invite-member.test.ts` cubre: token inválido, inviter sin permisos, place archivado, place lleno (150), email fail (mock SDK), unique parcial (invitación abierta duplicada), happy path.
   - `accept-invitation.test.ts` cubre: token inválido, expirado, ya usado por otro, idempotencia (ya miembro), place lleno, multi-place (miembro de C acepta A), place archivado.
   - `leave-membership.test.ts` cubre: no miembro, único owner, owner con otros owners, leave normal.
   - `transfer-ownership.test.ts` cubre: target no miembro del place, target miembro, transfer a self, removeActor true/false, multi-place independence, owners concurrentes.
   - `member-profile.test.ts` cubre: visitor no miembro → 404, miembro inexistente → 404, happy path (antigüedad, rol).
2. **E2E** (`pnpm test:e2e`): flow completo invite → email mock → accept → redirect a place.
3. **DB enforce** (2.G): tras migración, `INSERT` directo (MCP `execute_sql`) con place lleno falla por trigger.
4. **Manual**: dos cuentas en cloud dev — A invita a B, B acepta, B aparece en `/inbox` de B con flag correcto, A transfiere a B, A sale, B queda como único owner.
5. **Multi-place manual**: B es miembro previo de place C; después de aceptar a A, `SELECT * FROM "Membership" WHERE "userId" = B` retorna ambas filas activas.
