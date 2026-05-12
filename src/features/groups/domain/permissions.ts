/**
 * Permisos atómicos del sistema de grupos (G.1.5).
 *
 * Lista cerrada hardcoded de 12 permisos. Fuente de verdad. Validados
 * Zod en server actions contra esta lista. Si crece > 30 items,
 * normalizar `PermissionGroup.permissions` a tabla
 * `GroupPermission(groupId, permission)` con FK al enum (ADR aparte).
 *
 * Owner-only hardcoded (NO permisos atómicos delegables):
 *  - Expulsar miembros (`expelMemberAction`).
 *  - Transferir ownership.
 *  - CRUD de tiers + asignación de tiers.
 *  - CRUD de grupos + asignación/remoción de miembros a grupos.
 *  - Settings del place (theme, hours, billing, opening).
 *  - Archivar el place.
 *
 * Override de ADR §2 (2026-05-09): los permisos `discussions:edit-post` y
 * `library:edit-item` SÍ son delegables. La decisión original (ADR
 * `2026-05-02-permission-groups-model.md` §2) fue revisada al cerrar la
 * deuda G.3 silenciosa: editar contenido ajeno es moderación válida que
 * algunos owners pueden querer delegar a un grupo custom (ej: revisores
 * editoriales). Owner sigue con bypass automático. Ver
 * `docs/decisions/2026-05-09-g3-edit-as-delegable-permission.md`.
 *
 * Ver `docs/features/groups/spec.md` § 4.
 */

export const PERMISSIONS_ALL = [
  'discussions:hide-post',
  'discussions:delete-post',
  'discussions:delete-comment',
  'discussions:edit-post',
  'library:moderate-items',
  'library:moderate-categories',
  'library:edit-item',
  'events:moderate',
  'flags:review',
  'members:invite',
  'members:block',
  'members:resend-invitation',
  'members:revoke-invitation',
] as const

export type Permission = (typeof PERMISSIONS_ALL)[number]

const PERMISSIONS_SET = new Set<string>(PERMISSIONS_ALL)

export function isValidPermission(value: string): value is Permission {
  return PERMISSIONS_SET.has(value)
}

/**
 * Permisos library:* son scopables por categoría. Si el grupo tiene
 * entries en `GroupCategoryScope`, sus permisos library:* aplican
 * SOLO a esas categorías. Otros permisos son siempre globales.
 */
export function isLibraryScopedPermission(p: Permission): boolean {
  return p === 'library:moderate-items' || p === 'library:moderate-categories'
}

/**
 * Label user-facing en español de cada permiso. Usado en
 * `<PermissionLabel>` y `<PermissionCheckboxList>`.
 */
const PERMISSION_LABELS: Record<Permission, string> = {
  'discussions:hide-post': 'Ocultar/des-ocultar discusiones ajenas',
  'discussions:delete-post': 'Eliminar discusiones ajenas',
  'discussions:delete-comment': 'Eliminar comentarios ajenos',
  'discussions:edit-post': 'Editar discusiones ajenas (post-60s)',
  'library:moderate-items': 'Archivar recursos ajenos en biblioteca',
  'library:moderate-categories':
    'Editar/archivar categorías de biblioteca + designar contribuidores',
  'library:edit-item': 'Editar recursos ajenos en biblioteca',
  'events:moderate': 'Editar / cancelar eventos ajenos',
  'flags:review': 'Revisar reportes y aplicar acciones',
  'members:invite': 'Invitar nuevos miembros (no admins)',
  'members:block': 'Bloquear/desbloquear acceso de un miembro',
  'members:resend-invitation': 'Reenviar invitación pendiente',
  'members:revoke-invitation': 'Revocar invitación pendiente',
}

export function permissionLabel(p: Permission): string {
  return PERMISSION_LABELS[p]
}

/**
 * Nombre canónico del grupo preset auto-generado por place. Hardcoded.
 * El grupo con `isPreset=true` y `name=ADMIN_PRESET_NAME` recibe
 * tratamiento especial: NO se puede eliminar, NO se pueden modificar
 * sus permisos, NO se puede scopear a categorías.
 */
export const ADMIN_PRESET_NAME = 'Administradores'
