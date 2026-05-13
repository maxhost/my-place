/**
 * API pública client-safe del slice `groups` (G.2).
 *
 * Lo que viaja al bundle cliente: tipos, schemas Zod, Server Action
 * references (Next serializa las actions como referencias — no son código
 * en cliente) y componentes UI client-safe. Para queries Prisma usar
 * `public.server.ts`.
 *
 * **No** incluye queries server-only ni componentes que las usen. Mismo
 * patrón split que `flags/public.ts` + `flags/public.server.ts`
 * (ADR `2026-04-21-flags-subslice-split.md`).
 *
 * Ver `docs/features/groups/spec.md`.
 */

// ---------------------------------------------------------------
// Domain — enum de permisos atómicos (estable G.1.5+)
// ---------------------------------------------------------------

export {
  ADMIN_PRESET_NAME,
  PERMISSIONS_ALL,
  isValidPermission,
  permissionLabel,
  type Permission,
} from './domain/permissions'

// ---------------------------------------------------------------
// Domain types + helpers puros
// ---------------------------------------------------------------

export type { GroupMembership, GroupSummary, PermissionGroup } from './domain/types'

export {
  GROUP_DESCRIPTION_MAX_LENGTH,
  GROUP_NAME_MAX_LENGTH,
  GROUP_NAME_MIN_LENGTH,
  arePermissionsValid,
  isValidGroupName,
  normalizePermissions,
  partitionPermissions,
} from './domain/invariants'

export { isAdminPreset, presetPermissions } from './domain/presets'

// ---------------------------------------------------------------
// Schemas Zod
// ---------------------------------------------------------------

export {
  addMemberToGroupInputSchema,
  createGroupInputSchema,
  deleteGroupInputSchema,
  permissionEnumSchema,
  removeMemberFromGroupInputSchema,
  updateGroupInputSchema,
  type AddMemberToGroupInput,
  type CreateGroupInput,
  type DeleteGroupInput,
  type RemoveMemberFromGroupInput,
  type UpdateGroupInput,
} from './schemas'

// ---------------------------------------------------------------
// Server actions — references viajan client-safe
// ---------------------------------------------------------------

// CRUD actions del raíz
export { createGroupAction, type CreateGroupResult } from './server/actions/create-group'
export { deleteGroupAction, type DeleteGroupResult } from './server/actions/delete-group'
export { updateGroupAction, type UpdateGroupResult } from './server/actions/update-group'

// Sub-slice memberships/
export {
  MemberGroupsControl,
  addMemberToGroupAction,
  removeMemberFromGroupAction,
} from './memberships/public'

// Sub-slice admin/ (post-S7 2026-05-13: detail-from-list pattern)
export {
  GroupDetailPanel,
  GroupFormSheet,
  GroupMembersSheet,
  GroupsAdminPanel,
} from './admin/public'

// UI primitives raíz
export { PermissionCheckboxList } from './ui/permission-checkbox-list'
export { friendlyGroupErrorMessage } from './ui/errors'
