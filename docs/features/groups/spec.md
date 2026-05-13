# PermissionGroups + Block/Expel — Especificación

> **Actualización v3 (2026-05-13, S7)**: rediseño de `/settings/groups`
> admin UI al patrón canónico `detail-from-list` (ver
> `docs/ux-patterns.md`). Drop del master-detail con page detalle full
>
> - URL `/settings/groups/[groupId]`. Reemplazado por flat page +
>   `<GroupsAdminPanel>` (orquestador) + `<GroupDetailPanel>` (read-only
>   en EditPanel responsive: sidebar desktop / bottomsheet mobile).
>   Sub-sheets `<GroupFormSheet>` y `<GroupMembersSheet>` migrados de
>   BottomSheet legacy a EditPanel responsive. Mirror exacto del slice
>   library admin post-S5. Spec sections § 4.7 + § 6 quedan parcialmente
>   obsoletas (componentes legacy listados); el código es la fuente.
>
> **Library scope por categoría**: eliminado en S1b del rediseño library
> (2026-05-13). Los permisos `library:*` aplican globalmente al place
> ahora. Ver ADR `docs/decisions/2026-05-12-library-permissions-model.md`.

> **Alcance v1 (G.x, 2026-05-02)**: sistema de grupos con permisos
> atómicos para delegar moderación. Reemplaza el rol `ADMIN` del
> enum por un grupo preset "Administradores" auto-generado. Suma
> block/unblock (permiso atómico delegable) y expel (owner-only) con
> emails Resend. Library tiene scope por categoría.

> **Referencias**:
> `CLAUDE.md` (principios no negociables, gotchas discriminated
> union return, snapshot pattern erasure 365d, connection_limit),
> `docs/architecture.md` (vertical slices),
> `docs/features/tiers/spec.md` y
> `docs/features/tier-memberships/spec.md` (planes anteriores
> definen owner-only hardcoded de tiers + tier-memberships, este
> plan los respeta),
> `docs/decisions/2026-05-02-permission-groups-model.md` (ADR
> de este feature),
> `docs/decisions/2026-04-24-erasure-365d.md` (snapshot pattern),
> `docs/decisions/2026-05-01-stripe-deferred-to-phase-3.md`
> (Stripe diferido — los `tiers:*` permisos NO existen en v1),
> `docs/decisions/2026-05-01-rls-comprehensive-pre-launch.md`
> (RLS unificado deferred — incluye PermissionGroup),
> `docs/plans/2026-05-02-permission-groups-and-member-controls.md`
> (plan ejecutable con sub-fases).

## 1. Modelo mental

Hasta hoy el producto tiene 3 "roles" hardcoded: `OWNER` (vía
`PlaceOwnership`), `ADMIN` (`Membership.role='ADMIN'`), `MEMBER`
(`Membership.role='MEMBER'`). La moderación se gateia con
`role==='ADMIN' || isOwner` repartido en ~30 callsites.

Este feature introduce **grupos custom con permisos atómicos** —
patrón establecido en SMF, Discord, Discourse. El owner crea grupos
nombrados ("Moderadores", "Recruiters", "Library Mods"), elige qué
permisos atómicos tiene cada grupo, y asigna miembros. Un miembro
puede estar en N grupos; sus permisos son la unión de los grupos.

**Eliminamos el rol `ADMIN`**. La función equivalente la cumple un
**grupo preset "Administradores"** auto-generado por place con
TODOS los permisos atómicos. Los admins existentes se migran a ese
grupo (data migration). Owner sigue existiendo como concepto
distinto (`PlaceOwnership`) y es **dios implícito** — tiene todos
los permisos sin asignación.

Adicionalmente:

- **Block**: cualquier user con permiso `members:block` puede
  bloquear/desbloquear el acceso de otro miembro. Soft (membership
  persiste, pero el gate rechaza). Email Resend al bloqueado con
  email de contacto del que bloqueó.
- **Expel**: SOLO owner. Forzar `leftAt` (mismo efecto que leave
  voluntario). Email Resend al expulsado.

**No es:**

- Un sistema de roles editoriales aplicados a recursos individuales
  (ej: "moderador del thread X"). Sólo a place + categoría library
  (scope natural existente).
- Un sistema de aprobación previa de contenido. Posts/comments/items
  se publican siempre.
- Un sistema de notificaciones push agresivas. Sólo emails Resend
  para block/expel.
- Un mecanismo de cobro o billing. Tiers + tier-memberships viven
  aparte y siguen owner-only.

**Es:**

- La forma canónica de delegar moderación en Place.
- La unidad de gestión de privilegios en el directorio del miembro
  (`/settings/members/[userId]`).
- La base sobre la que en futuro se construirán features adicionales
  (ej: bloqueo temporal, audit log de moderación).

## 2. Vocabulario

- **PermissionGroup** (`groups/`): grupo nombrado con lista de
  permisos atómicos. Vive por place. Owner crea/edita/elimina.
- **GroupMembership**: tabla N:M entre `User` y `PermissionGroup`.
  Identifica quién pertenece a qué grupo.
- **GroupCategoryScope**: tabla N:M entre `PermissionGroup` y
  `LibraryCategory`. Si un grupo tiene entries en esta tabla, sus
  permisos `library:*` aplican SOLO a las categorías listadas. Sin
  entries → global.
- **Permission** (enum hardcoded): uno de los 10 permisos atómicos
  válidos (ver § 4 lista cerrada).
- **Grupo preset "Administradores"**: auto-generado por place al
  crearse. `isPreset=true`, tiene TODOS los permisos atómicos.
  **No se puede eliminar** (hardcoded check). Sí se pueden quitar
  miembros y agregar otros.
- **Owner**: viewer con `PlaceOwnership` activa para el place.
  Equivalente a "tener TODOS los permisos atómicos siempre", sin
  necesidad de estar en grupos. Hardcoded en `hasPermission`.
- **Block** (`Membership.blockedAt`): soft-block. Membership persiste
  pero el gate rechaza acceso al place mientras `blockedAt IS NOT NULL`.
- **Expel** (`Membership.leftAt` con metadata): leave forzado por
  owner. Membership inactiva (`leftAt IS NOT NULL`). NO reversible
  (re-invitar para volver). Tras 365d entra al flujo erasure.

**Idioma**: UI en español ("Grupos", "Crear grupo", "Permisos",
"Asignar miembros", "Bloquear miembro", "Expulsar miembro",
"Administradores", "Sin tiers asignados", "Indefinido"). Código en
inglés (`PermissionGroup`, `hasPermission`, `blockMemberAction`,
etc.).

## 3. Scope v1 — cerrado

**Sí en v1**:

- Modelos `PermissionGroup`, `GroupMembership`, `GroupCategoryScope`
  - extensión a `Membership` (block + expel fields).
- Slice nuevo `src/features/groups/` autocontenido.
- 10 permisos atómicos (lista cerrada — § 4).
- Eliminación del rol `ADMIN`:
  - Data migration: admins existentes → grupo preset
    "Administradores".
  - Refactor de ~228 callsites que chequean `role === 'ADMIN'`.
  - Drop de `Membership.role` columna + `MembershipRole` enum
    (G.7 final).
- 9 server actions: 6 grupos + block + unblock + expel.
- Page `/settings/groups` (owner-only).
- Detalle del miembro (`/settings/members/[userId]`) extendido:
  - Sección "Grupos asignados" con assign/remove (owner-only).
  - Botón "Bloquear miembro" → modal con motivo + email contacto.
  - Botón "Expulsar miembro" (sólo owner) → modal análogo.
- Email Resend templates: block, unblock, expel.
- Gate `(gated)/layout.tsx` extendido con chequeo de `blockedAt`.
- ADR `docs/decisions/2026-05-02-permission-groups-model.md`.
- Tests unit + RTL + E2E.

**Fuera de v1, deferred**:

- **RLS policies** sobre las nuevas tablas. Plan unificado posterior.
- **Aprobar posts antes de publicar** (queue de moderación).
- **Override por recurso individual** (ej: moderador de thread X).
  Sólo library categoría tiene scope; resto global.
- **Audit log de moderación** (quién hidió/eliminó qué cuándo).
- **Notificaciones push** al miembro bloqueado/expulsado.
- **Templates de grupos** ("Crear con preset Moderador básico").
  v1 sólo "Administradores" preset; resto se crea custom.
- **Bulk operations** (asignar N miembros a un grupo a la vez).
- **`tiers:*` permisos** (asignar tiers delegable). Hoy owner-only.
- **Bloqueo temporal con `blockedUntil`**. Hoy bloqueo indefinido.
- **Snapshot del bloqueador/expulsor** (mismo de erasure 365d). v1
  asume que el bloqueador/expulsor existirá durante el ciclo del
  block/expel; si pasa erasure, perdemos info de "quién hizo qué".
  Aceptable para v1 — block/expel son acciones recientes en
  general. Si emerge necesidad, se suma snapshot en plan futuro.

## 4. Lista cerrada de 10 permisos atómicos

Hardcoded en `groups/domain/permissions.ts` (enum). Lista validada
por user 2026-05-02:

| Permission                    | Descripción humana                                              |
| ----------------------------- | --------------------------------------------------------------- |
| `discussions:hide-post`       | Ocultar/des-ocultar posts ajenos                                |
| `discussions:delete-post`     | Hard-delete posts ajenos                                        |
| `discussions:delete-comment`  | Soft-delete comments ajenos                                     |
| `library:moderate-items`      | Archivar items ajenos (scopable por categoría)                  |
| `library:moderate-categories` | Editar/archivar categorías + designated contributors (scopable) |
| `events:moderate`             | Editar / cancelar events ajenos                                 |
| `flags:review`                | Revisar flags + ejecutar sideEffects                            |
| `members:invite`              | Invitar members (no admins)                                     |
| `members:block`               | Bloquear/desbloquear acceso de un miembro                       |
| `members:resend-invitation`   | Reenviar invitación pending                                     |

Permisos `library:*` son **scopables** — si el grupo tiene entries
en `GroupCategoryScope`, aplican SOLO a esas categorías; sin
entries, aplican a todas las categorías del place.

**Owner-only hardcoded** (NO permisos atómicos delegables):

- Expulsar miembros (`expelMemberAction`).
- Transferir ownership.
- CRUD de tiers + asignación de tiers a miembros.
- CRUD de grupos + asignación/remoción de miembros a grupos.
- Settings del place (theme, hours, billing, opening).
- Archivar el place.

## 5. Routes y comportamiento

### `/settings/groups` (owner-only)

Server Component. Doble gate: layout (admin-or-owner — pero queda
relajado a "tiene cualquier permiso atómico OR es owner") + page
(`if (!perms.isOwner) notFound()`). Owner-only en práctica.

Estructura:

```tsx
const place = await loadPlaceBySlug(placeSlug)
if (!place) notFound()
const auth = await getCurrentAuthUser()
if (!auth) redirect(`/login?next=/settings/groups`)
const isOwner = await findPlaceOwnership(auth.id, place.id)
if (!isOwner) notFound()

const groups = await listGroupsByPlace(place.id)
const categories = await listLibraryCategories(place.id)

return (
  <div className="space-y-6 p-4 md:p-8">
    <SettingsHeader title="Grupos" />
    <p>
      Definí grupos con permisos para delegar moderación. El grupo "Administradores" tiene todos los
      permisos por defecto y no se puede eliminar.
    </p>
    <NewGroupButton placeSlug={place.slug} categories={categories} />
    <GroupsListAdmin groups={groups} categories={categories} />
  </div>
)
```

### `/settings/members/[userId]` (extensión owner-only)

Suma 3 secciones nuevas a la page existente:

1. **"Grupos asignados"**:
   - Lista de grupos del miembro con badge `(preset)` si aplica.
   - `<MemberGroupsControl>` Client: dropdown de grupos NO asignados +
     botón "Asignar al grupo". Cada row tiene botón "Quitar del
     grupo" con confirm inline.
   - Owner-only.

2. **"Bloquear miembro"** (sección, no botón directo):
   - Si el viewer NO tiene `members:block` → sección oculta.
   - Si el target ES owner → sección oculta (cannot block owner).
   - Si el target YA está bloqueado → muestra "Bloqueado el [date]
     por [admin]. Razón: [reason]" + botón "Desbloquear" → modal
     con form (motivo opcional + email contacto).
   - Si el target NO está bloqueado → botón "Bloquear miembro" →
     modal con form (motivo required + email contacto autocompletado
     con email del actor).

3. **"Expulsar miembro"** (sección, no botón directo):
   - SOLO owner ve esta sección.
   - Si el target ES owner → sección oculta (cannot expel owner).
   - Si el target ya está expulsado (`leftAt IS NOT NULL`) → la page
     muestra al miembro como "ex-miembro" en lugar de detalle activo.
   - Si activo: botón "Expulsar miembro" → modal análogo al bloqueo.

### Gate `(gated)/layout.tsx` — orden actualizado

```ts
// 1. Auth (requireAuthUserId) — sin sesión → redirect login
// 2. Membership activa (leftAt IS NULL) — no miembro → 404
// 3. blockedAt IS NULL → si NO, render <UserBlockedView>
// 4. Place open por horario → si NO, render <PlaceClosedView>
// 5. Renderear children (zona del place)
```

`<UserBlockedView>` muestra:

- Heading "Estás bloqueado de [place name]".
- Razón si está disponible (`Membership.blockedReason`).
- Email de contacto del que bloqueó (`Membership.blockedContactEmail`).
- Sin link a otras zonas — el user sólo puede leer este mensaje.

## 6. Componentes UI

| Componente                 | Tipo   | Slice   | Props                                                                                     |
| -------------------------- | ------ | ------- | ----------------------------------------------------------------------------------------- |
| `<GroupsListAdmin>`        | Server | groups  | `groups`, `categories`                                                                    |
| `<GroupCard>`              | Server | groups  | `group`, `categories` (renderiza `<GroupFormDialog>` para editar + `<DeleteGroupButton>`) |
| `<GroupFormDialog>`        | Client | groups  | `mode` (create/edit), `placeSlug`, `categories`, `initial?`                               |
| `<GroupMembersDialog>`     | Client | groups  | `group`, `placeMembers` (gestiona assign/remove)                                          |
| `<PermissionCheckboxList>` | Client | groups  | `value: Permission[]`, `onChange`                                                         |
| `<CategoryScopeSelector>`  | Client | groups  | `value: string[]`, `categories`, `onChange`, `enabled`                                    |
| `<DeleteGroupButton>`      | Client | groups  | `groupId`, `groupName`, `isPreset`, `memberCount`                                         |
| `<NewGroupButton>`         | Server | groups  | `placeSlug`, `categories` (wrap del dialog)                                               |
| `<PermissionLabel>`        | Server | groups  | `permission: Permission` (renderiza el label español + descripción)                       |
| `<MemberGroupsControl>`    | Client | groups  | `placeId`, `memberUserId`, `currentGroups`, `availableGroups`                             |
| `<UserBlockedView>`        | Server | members | `placeName`, `blockedReason`, `blockedContactEmail`                                       |
| `<BlockMemberDialog>`      | Client | members | `placeId`, `memberUserId`, `actorEmail`, `mode` (block/unblock)                           |
| `<ExpelMemberDialog>`      | Client | members | `placeId`, `memberUserId`, `actorEmail`                                                   |

## 7. Empty states

- **Owner sin grupos custom** (sólo "Administradores" preset): la
  page muestra el preset normalmente + empty state secundario "Todavía
  no creaste grupos custom. Crealos para delegar moderación a
  miembros sin darles todos los permisos."
- **Grupo sin miembros**: en `<GroupCard>` muestra "Este grupo no
  tiene miembros asignados." + botón "Gestionar miembros".
- **Owner intenta eliminar grupo con miembros**: dialog "Quitá los
  miembros primero antes de eliminar el grupo." (botón delete
  bloqueado server-side; UI muestra disabled state si memberCount > 0).
- **Detalle del miembro sin grupos asignados**: "Este miembro no
  está en ningún grupo." + dropdown para agregar.

## 8. Permisos (matriz canónica)

| Acción                                                 | Owner | Members con permiso                               | Otros members                                                         |
| ------------------------------------------------------ | ----- | ------------------------------------------------- | --------------------------------------------------------------------- |
| Ver `/settings/groups`                                 | ✓     | — (owner-only)                                    | —                                                                     |
| Crear grupo                                            | ✓     | —                                                 | —                                                                     |
| Editar grupo (name, desc, permisos, scope)             | ✓     | —                                                 | —                                                                     |
| Editar grupo preset "Administradores" (name, permisos) | —     | —                                                 | — (hardcoded: NO se puede modificar el preset; sólo asignar miembros) |
| Eliminar grupo                                         | ✓ \*  | —                                                 | —                                                                     |
| Asignar/remover miembros a un grupo                    | ✓     | —                                                 | —                                                                     |
| Configurar scope library de un grupo                   | ✓     | —                                                 | —                                                                     |
| Bloquear miembro                                       | ✓     | ✓ con `members:block`                             | —                                                                     |
| Desbloquear miembro                                    | ✓     | ✓ con `members:block`                             | —                                                                     |
| Expulsar miembro                                       | ✓     | — (owner-only)                                    | —                                                                     |
| Hide/delete post                                       | ✓     | ✓ con permiso                                     | —                                                                     |
| Soft-delete comment ajeno                              | ✓     | ✓ con `discussions:delete-comment`                | —                                                                     |
| Archivar item library                                  | ✓     | ✓ con `library:moderate-items` (scope-aware)      | —                                                                     |
| Editar/archivar categoría library                      | ✓     | ✓ con `library:moderate-categories` (scope-aware) | —                                                                     |
| Editar/cancelar evento                                 | ✓     | ✓ con `events:moderate`                           | —                                                                     |
| Revisar flag (con sideEffect)                          | ✓     | ✓ con `flags:review`                              | —                                                                     |
| Invitar miembro (no admin)                             | ✓     | ✓ con `members:invite`                            | —                                                                     |
| Reenviar invitación                                    | ✓     | ✓ con `members:resend-invitation`                 | —                                                                     |

\* El preset "Administradores" NO se puede eliminar (hardcoded).

Defense in depth aplicado:

1. **UI gate**: pages owner-only hacen `if (!perms.isOwner) notFound()`.
2. **UI filter**: `<SettingsNavFab>` filtra `'groups'` por `requiredRole: 'owner'`.
3. **Server action gate**: cada action chequea owner / `hasPermission`.
4. **`hasPermission` con bypass owner**: arranca con `if (isOwner) return true`.
5. **RLS** (deferida al plan unificado): cuarta capa cuando llegue.

## 9. Modelo de datos

### `PermissionGroup`

```prisma
model PermissionGroup {
  id          String    @id @default(cuid())
  placeId     String
  name        String    @db.VarChar(60)
  description String?   @db.VarChar(280)
  // Postgres array de strings (Permission enum). Validados Zod en
  // server actions. Pragmático para 10 permisos estables; si crece
  // > 30 items, normalizar a tabla GroupPermission.
  permissions String[]
  // Hardcoded preset: "Administradores". isPreset=true → no se puede
  // eliminar ni modificar permisos. Sólo se gestionan miembros.
  isPreset    Boolean   @default(false)
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  place            Place                  @relation(fields: [placeId], references: [id], onDelete: Cascade)
  groupMemberships GroupMembership[]
  categoryScopes   GroupCategoryScope[]

  @@index([placeId])
}
```

### `GroupMembership`

```prisma
model GroupMembership {
  id            String   @id @default(cuid())
  groupId       String
  userId        String
  placeId       String   // denormalizado para queries por place sin join
  addedAt       DateTime @default(now())
  addedByUserId String?

  group   PermissionGroup @relation(fields: [groupId], references: [id], onDelete: Cascade)
  user    User            @relation("GroupMembershipsAsUser", fields: [userId], references: [id], onDelete: Cascade)
  place   Place           @relation(fields: [placeId], references: [id], onDelete: Cascade)
  addedBy User?           @relation("GroupMembershipsAddedBy", fields: [addedByUserId], references: [id], onDelete: SetNull)

  @@unique([groupId, userId])
  @@index([placeId, userId])  // hasPermission query
  @@index([userId])
}
```

### `GroupCategoryScope`

```prisma
model GroupCategoryScope {
  groupId    String
  categoryId String

  group    PermissionGroup @relation(fields: [groupId], references: [id], onDelete: Cascade)
  category LibraryCategory @relation(fields: [categoryId], references: [id], onDelete: Cascade)

  @@id([groupId, categoryId])
  @@index([categoryId])
}
```

### Cambios al `Membership`

```prisma
model Membership {
  // existing fields...

  // Block / unblock (delegable vía permiso members:block):
  blockedAt           DateTime?
  blockedByUserId     String?
  blockedReason       String?  @db.VarChar(500)
  blockedContactEmail String?

  // Expel (owner-only hardcoded). leftAt se setea + estos campos:
  expelledByUserId    String?
  expelReason         String?  @db.VarChar(500)
  expelContactEmail   String?

  // FKs nuevas:
  blockedBy  User? @relation("MembershipsBlockedBy",  fields: [blockedByUserId],  references: [id], onDelete: SetNull)
  expelledBy User? @relation("MembershipsExpelledBy", fields: [expelledByUserId], references: [id], onDelete: SetNull)

  // role columna PERMANECE durante G.1-G.6, drop en G.7.
}
```

## 10. Validación (Zod) — contrato de inputs

Schemas en `groups/schemas.ts` + extensión a `members/schemas.ts`:

- `permissionEnumSchema = z.enum([...PERMISSIONS_ALL])`.
- `createGroupInputSchema`: `{ placeSlug, name, description?, permissions: Permission[], categoryScopeIds?: string[] }`.
- `updateGroupInputSchema`: `{ groupId, name, description?, permissions, categoryScopeIds? }`.
- `deleteGroupInputSchema`: `{ groupId }`.
- `addMemberToGroupInputSchema`: `{ groupId, userId }`.
- `removeMemberFromGroupInputSchema`: `{ groupId, userId }`.
- `setGroupCategoryScopeInputSchema`: `{ groupId, categoryIds: string[] }` (override del scope completo).
- `blockMemberInputSchema`: `{ placeId, memberUserId, reason: string min=1 max=500, contactEmail: z.string().email() }`.
- `unblockMemberInputSchema`: `{ placeId, memberUserId, message?: string max=500, contactEmail: z.string().email() }`.
- `expelMemberInputSchema`: `{ placeId, memberUserId, reason: string min=1 max=500, contactEmail: z.string().email() }`.

## 11. `hasPermission` API + `listAllowedCategoryIds`

Vive en `members/server/queries.ts` (no en `groups/`) porque se
compone con `findPlaceOwnership` y `findActiveMembership` —
helpers de identity que ya viven en members.

```ts
// hasPermission con opts normalizado por Zod parse interno para
// garantizar React.cache dedupe correcta.
export const hasPermission = cache(
  async (
    userId: string,
    placeId: string,
    permission: Permission,
    opts?: { categoryId?: string },
  ): Promise<boolean> => {
    // 1. Owner bypass.
    if (await findPlaceOwnership(userId, placeId)) return true

    // 2. Membership activa requerida.
    const membership = await findActiveMembership(userId, placeId)
    if (!membership) return false

    // 3. Group memberships con el permiso.
    const groups = await prisma.groupMembership.findMany({
      where: {
        userId,
        placeId,
        group: { permissions: { has: permission } },
      },
      include: {
        group: {
          select: { id: true, categoryScopes: { select: { categoryId: true } } },
        },
      },
    })
    if (groups.length === 0) return false

    // 4. Library scope (si aplica).
    if (isLibraryScopedPermission(permission) && opts?.categoryId) {
      // Si algún grupo del user tiene el permiso SIN scope, allow global.
      // Si todos los grupos tienen scope, necesita matchear categoryId.
      const allUnscoped = groups.every((g) => g.group.categoryScopes.length === 0)
      if (allUnscoped) return true
      return groups.some(
        (g) =>
          g.group.categoryScopes.length === 0 ||
          g.group.categoryScopes.some((s) => s.categoryId === opts.categoryId),
      )
    }

    return true
  },
)

// listAllowedCategoryIds: para UI condicional (mostrar/ocultar
// botones de moderación en cada categoría).
export const listAllowedCategoryIds = cache(
  async (
    userId: string,
    placeId: string,
    permission: Permission,
  ): Promise<{ all: true } | { all: false; ids: string[] }> => {
    if (await findPlaceOwnership(userId, placeId)) return { all: true }
    const membership = await findActiveMembership(userId, placeId)
    if (!membership) return { all: false, ids: [] }
    // Group memberships con permiso + scope.
    const groups = await prisma.groupMembership.findMany({
      where: { userId, placeId, group: { permissions: { has: permission } } },
      include: { group: { select: { categoryScopes: { select: { categoryId: true } } } } },
    })
    if (groups.length === 0) return { all: false, ids: [] }
    if (groups.some((g) => g.group.categoryScopes.length === 0)) return { all: true }
    const ids = Array.from(
      new Set(groups.flatMap((g) => g.group.categoryScopes.map((s) => s.categoryId))),
    )
    return { all: false, ids }
  },
)
```

**Estado post-cleanup C.3** (plan `tidy-stargazing-summit.md`): la columna
`Membership.role` y el enum `MembershipRole` fueron dropeados. El fallback
legacy `role === 'ADMIN'` ya no existe — la única vía a admin (fuera de
owner) es membership al grupo preset "Administradores".

## 12. Server actions

Las 9 actions con discriminated union return (audit-fixed completo):

| Action                        | Result                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `createGroupAction`           | `{ ok: true; groupId } \| { ok: false; error: 'group_name_taken' \| 'permission_invalid' }`                                          |
| `updateGroupAction`           | `{ ok: true } \| { ok: false; error: 'group_name_taken' \| 'permission_invalid' \| 'cannot_modify_preset' }`                         |
| `deleteGroupAction`           | `{ ok: true } \| { ok: false; error: 'group_has_members' \| 'cannot_delete_preset' }`                                                |
| `addMemberToGroupAction`      | `{ ok: true } \| { ok: false; error: 'target_user_not_member' \| 'target_is_owner' \| 'already_in_group' }`                          |
| `removeMemberFromGroupAction` | `{ ok: true } \| { ok: false; error: 'not_in_group' }`                                                                               |
| `setGroupCategoryScopeAction` | `{ ok: true } \| { ok: false; error: 'category_not_in_place' \| 'cannot_scope_preset' }`                                             |
| `blockMemberAction`           | `{ ok: true } \| { ok: false; error: 'cannot_block_owner' \| 'cannot_block_self' \| 'already_blocked' \| 'target_user_not_member' }` |
| `unblockMemberAction`         | `{ ok: true } \| { ok: false; error: 'not_blocked' }`                                                                                |
| `expelMemberAction`           | `{ ok: true } \| { ok: false; error: 'cannot_expel_owner' \| 'cannot_expel_self' \| 'target_user_not_member' }`                      |

Errores **inesperados** (auth fail, place archivado, validación
Zod corrupta) siguen como throw — caen al `error.tsx` boundary.

Todas las actions:

- Owner-only de grupos: chequean `findPlaceOwnership` directo.
- Block/unblock: chequean `hasPermission(actorId, placeId, 'members:block')`.
- Expel: chequea `findPlaceOwnership` directo (NO permiso atómico).

## 13. Settings nav extension

`src/features/shell/domain/settings-sections.ts`:

```ts
export const SETTINGS_SECTIONS = [
  { slug: '', label: 'General' },
  { slug: 'hours', label: 'Horarios' },
  { slug: 'library', label: 'Biblioteca' },
  { slug: 'access', label: 'Acceso' },
  { slug: 'members', label: 'Miembros', requiredRole: 'owner' },
  { slug: 'flags', label: 'Reportes' },
  { slug: 'groups', label: 'Grupos', requiredRole: 'owner' }, // NEW (G.5)
  { slug: 'tiers', label: 'Tiers', requiredRole: 'owner' },
] as const
```

Razón del orden: "Grupos" inmediatamente antes de "Tiers" — ambos
son configuración avanzada owner-only.

## 14. Email Resend templates

3 templates en `members/server/templates/`:

- **`block-email.ts`**: subject "Has sido bloqueado de [place
  name]". Cuerpo: motivo redactado por el admin + "Si querés
  discutirlo, contactá a [contactEmail]". Footer estándar.
- **`unblock-email.ts`**: subject "Tu acceso fue restaurado en
  [place name]". Cuerpo más breve + contactEmail.
- **`expel-email.ts`**: subject "Has sido expulsado de [place
  name]". Cuerpo: motivo + contactEmail + "Si querés volver al
  place, deberás recibir una nueva invitación".

Todos los templates usan el `mailer` shared (`shared/lib/mailer`,
patrón establecido en members/invitation-email).

**Manejo de errores en send**: try/catch en la action — si el send
falla, la acción de block/unblock/expel se commitea igual (es la
intención principal); el email queda como log warning. UI muestra
toast "Acción ejecutada pero el email no pudo enviarse — contactá
manualmente."

## 15. Estrategia de migración del rol Admin

Critical para no romper en flight (resumen del plan, ver § 1.bis
del plan completo para el script de migración):

1. **G.1**: schema con NUEVA tabla + grupo preset + script
   `migrate-admins-to-groups.ts` aplicado al cloud dev. Validación
   automática de equality (admin count ↔ group memberships count).
2. **G.1.5**: `hasPermission` con FALLBACK compat
   (isOwner OR role===ADMIN OR group-membership). Stubs de slice
   groups creados.
3. **G.2** (paralelo): implementación real del slice groups.
4. **G.3** (paralelo): refactor masivo de ~228 callsites (~72
   archivos). Cada uno migrado y testeado. Especial:
   `acceptInvitationAction` cambia para que `asAdmin=true` asigne
   al grupo "Administradores" (insert `GroupMembership`) en vez de
   setear `role='ADMIN'`. La columna `Invitation.asAdmin` queda
   intacta — sigue siendo señal del intent del inviter.
5. **G.4** (paralelo): block/unblock/expel + gate update + UI
   dialogs.
6. **G.5/G.6** (post-batch-1): pages.
7. **G.7**: drop `Membership.role` columna + `MembershipRole` enum
   - branch fallback. Cleanup final.

## 16. Principios no negociables aplicados (CLAUDE.md)

- **"Sin métricas vanidosas"**: el directorio de grupos NO muestra
  "grupo más activo" ni "miembros más bloqueados". Sí muestra
  contadores útiles ("X miembros en este grupo", "Y grupos
  asignados").
- **"Sin urgencia artificial"**: los emails de block/expel son
  informativos, sin countdowns ni amenazas. Texto plano.
- **"Sin gamificación"**: no hay "ranking de moderadores", "reports
  resueltos por mes" etc.
- **"Customización activa, no algorítmica"**: el owner crea grupos
  manualmente. No hay "auto-promoción" basada en actividad.
- **"Identidad contextual"**: el bloqueo no se exporta a otros
  places — sólo afecta el place donde fue bloqueado.
- **"Memoria preservada"**: bloqueo soft preserva membership.
  Expel preserva contenido del miembro hasta erasure 365d.
- **"Lugares pequeños"**: 150 miembros × 5-10 grupos × 10
  permisos es manejable. Performance OK con índices estándar.

## 17. Sub-fases — referencia al plan

Ver `docs/plans/2026-05-02-permission-groups-and-member-controls.md`
para detalle ejecutable. Resumen:

| Sub       | Tema                                                       | Quién                             |
| --------- | ---------------------------------------------------------- | --------------------------------- |
| **G.0**   | Spec + ADR (este doc)                                      | Lead                              |
| **G.1**   | Schema + migration + data migration script + validación    | Lead                              |
| **G.1.5** | Pre-setup stubs compartidos (con `hasPermission` fallback) | Lead                              |
| **G.2**   | Slice `groups/` completo                                   | Agente A (paralelo)               |
| **G.3**   | Refactor ~228 callsites role===ADMIN → hasPermission       | Agente B (paralelo)               |
| **G.4**   | Block/unblock/expel + emails + gate update                 | Agente C (paralelo)               |
| **G.5**   | Page `/settings/groups`                                    | Agente D (paralelo, post-batch-1) |
| **G.6**   | Detalle del miembro extendido                              | Agente E (paralelo, post-batch-1) |
| **G.7**   | Drop role column + cleanup                                 | Lead                              |
| **G.8**   | E2E + cleanup                                              | Lead                              |

## 18. Verificación

### Por sub-fase

- typecheck + lint + tests targeted al área modificada.

### Cuando G.8 cierre (final)

- typecheck + lint + suite completa (Vitest + E2E). RLS suite no
  aplica.
- Build prod limpio.
- Migration `<ts>_drop_membership_role` aplicada al cloud dev. La
  columna ya no existe.
- Manual smoke en dev local: 14 pasos descritos en el plan
  (`docs/plans/2026-05-02-permission-groups-and-member-controls.md`
  § Verificación).
- E2E spec con 12+ escenarios (ver plan § Verificación).
