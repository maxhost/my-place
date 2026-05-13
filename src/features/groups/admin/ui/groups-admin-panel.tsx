'use client'

import { useEffect, useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { RowActions } from '@/shared/ui/row-actions'
import { toast } from '@/shared/ui/toaster'
import {
  ADMIN_PRESET_NAME,
  deleteGroupAction,
  type GroupMembership,
  type Permission,
  type PermissionGroup,
} from '@/features/groups/public'
import { friendlyGroupErrorMessage } from '@/features/groups/ui/errors'
import { GroupDetailPanel } from './group-detail-panel'
import { GroupFormSheet } from './group-form-sheet'
import { GroupMembersSheet } from './group-members-sheet'

type AvailableMember = {
  userId: string
  displayName: string
  handle: string | null
  avatarUrl: string | null
}

type Props = {
  placeSlug: string
  /** Grupos del place — preset arriba, después por createdAt asc. */
  groups: ReadonlyArray<PermissionGroup>
  /** Memberships precargadas para todos los grupos. */
  membershipsByGroupId: ReadonlyMap<string, GroupMembership[]>
  /** Miembros activos del place (no-owner). Para alimentar el members
   *  sheet con candidatos a agregar. */
  activeMembers: ReadonlyArray<AvailableMember>
}

type SheetState =
  | { kind: 'closed' }
  | { kind: 'create' }
  | { kind: 'detail'; groupId: string }
  | { kind: 'edit'; groupId: string }
  | { kind: 'members'; groupId: string }

/**
 * Orquestador admin de `/settings/groups` (S7, 2026-05-13).
 *
 * **Patrón canónico `detail-from-list`** (ver `docs/ux-patterns.md`):
 *  - Row entera tappable → abre `<GroupDetailPanel>` (EditPanel:
 *    sidebar desktop / bottomsheet mobile).
 *  - Kebab 3-dots (RowActions con `forceOverflow`) ofrece atajos
 *    Editar (abre wizard) + Eliminar (destructive con confirm).
 *  - Preset "Administradores": kebab solo Editar (no Eliminar — el delete
 *    está bloqueado a nivel de action). Detail panel idem.
 *  - Dashed-border "+ Nuevo grupo" abajo del listado.
 *
 * El detalle es read-only — muestra permisos + miembros + acciones.
 * "Gestionar miembros" abre sub-sheet (cierra detail + abre members,
 * mismo patrón que detail → wizard para evitar stack de 2 EditPanels).
 *
 * Latch interno para detail/edit/members panels: una vez abierto, queda
 * montado para que Radix Presence anime el exit.
 *
 * Mirror exacto del `<LibraryCategoriesPanel>` del slice library.
 */
export function GroupsAdminPanel({
  placeSlug,
  groups,
  membershipsByGroupId,
  activeMembers,
}: Props): React.ReactNode {
  const [sheet, setSheet] = useState<SheetState>({ kind: 'closed' })

  function close(): void {
    setSheet({ kind: 'closed' })
  }

  // Active state derivations.
  const detailGroup =
    sheet.kind === 'detail' ? (groups.find((g) => g.id === sheet.groupId) ?? null) : null
  const detailMembers = detailGroup ? (membershipsByGroupId.get(detailGroup.id) ?? []) : []

  const editingGroup = sheet.kind === 'edit' ? groups.find((g) => g.id === sheet.groupId) : null

  const membersGroup = sheet.kind === 'members' ? groups.find((g) => g.id === sheet.groupId) : null
  const membersList = membersGroup ? (membershipsByGroupId.get(membersGroup.id) ?? []) : []
  const membersInvitedSet = new Set(membersList.map((m) => m.userId))
  const membersAvailable = activeMembers.filter((m) => !membersInvitedSet.has(m.userId))

  // Latch del último edit mode para preservar Radix Presence exit anim.
  const [latchedEditMode, setLatchedEditMode] = useState<{
    kind: 'edit'
    groupId: string
    initialName: string
    initialDescription: string | null
    initialPermissions: ReadonlyArray<Permission>
    isPreset: boolean
  } | null>(null)
  useEffect(() => {
    if (editingGroup) {
      setLatchedEditMode({
        kind: 'edit',
        groupId: editingGroup.id,
        initialName: editingGroup.name,
        initialDescription: editingGroup.description,
        initialPermissions: editingGroup.permissions,
        isPreset: editingGroup.isPreset,
      })
    }
  }, [editingGroup])

  // Latch del último members sheet target.
  const [latchedMembersGroup, setLatchedMembersGroup] = useState<{
    id: string
    name: string
  } | null>(null)
  useEffect(() => {
    if (membersGroup) {
      setLatchedMembersGroup({ id: membersGroup.id, name: membersGroup.name })
    }
  }, [membersGroup])
  const latchedMembersList = latchedMembersGroup
    ? (membershipsByGroupId.get(latchedMembersGroup.id) ?? [])
    : []
  const latchedMembersInvitedSet = new Set(latchedMembersList.map((m) => m.userId))
  const latchedMembersAvailable = activeMembers.filter(
    (m) => !latchedMembersInvitedSet.has(m.userId),
  )

  function handleQuickDelete(group: PermissionGroup): void {
    // Quick delete desde el kebab del row (sin abrir detail). RowActions
    // ya dispara el confirm dialog automático con `destructive: true`.
    void deleteGroupAction({ groupId: group.id })
      .then((result) => {
        if (!result.ok) {
          if (result.error === 'cannot_delete_preset') {
            toast.error('El preset Administradores no se puede eliminar.')
          } else if (result.error === 'group_has_members') {
            toast.error('Quitá los miembros del grupo antes de eliminar.')
          }
          return
        }
        toast.success(`Grupo "${group.name}" eliminado.`)
      })
      .catch((err) => {
        toast.error(friendlyGroupErrorMessage(err))
      })
  }

  const customGroups = groups.filter((g) => !g.isPreset)
  const hasCustomGroups = customGroups.length > 0

  return (
    <>
      <section aria-labelledby="groups-list-heading" className="space-y-3">
        <div>
          <h2
            id="groups-list-heading"
            className="border-b pb-2 font-serif text-xl"
            style={{ borderColor: 'var(--border)' }}
          >
            Grupos
          </h2>
          <p className="mt-1 text-xs text-neutral-600">
            {groups.length} {groups.length === 1 ? 'grupo' : 'grupos'}. El preset “
            {ADMIN_PRESET_NAME}” tiene todos los permisos por defecto.
          </p>
        </div>

        {groups.length === 0 ? (
          <p className="rounded-md border border-neutral-200 bg-neutral-50 p-6 text-sm italic text-neutral-500">
            Todavía no hay grupos en este place.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-200 border-y border-neutral-200">
            {groups.map((g) => {
              const memberCount = membershipsByGroupId.get(g.id)?.length ?? g.memberCount
              const canDelete = !g.isPreset && memberCount === 0
              return (
                <li key={g.id} className="flex min-h-[56px] items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSheet({ kind: 'detail', groupId: g.id })}
                    className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3 text-left hover:bg-neutral-50"
                    aria-label={`Ver detalle del grupo ${g.name}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate font-serif text-base">{g.name}</h3>
                        {g.isPreset ? (
                          <span className="shrink-0 rounded-full border border-amber-300 px-2 py-0.5 text-[11px] text-amber-700">
                            preset
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <span className="shrink-0 text-xs text-neutral-600">
                      {memberCount} {memberCount === 1 ? 'miembro' : 'miembros'}
                    </span>
                  </button>
                  <div className="shrink-0 pr-2">
                    <RowActions
                      triggerLabel={`Acciones para ${g.name}`}
                      chipClassName="hidden"
                      forceOverflow={true}
                      actions={
                        canDelete
                          ? [
                              {
                                icon: <Pencil aria-hidden="true" className="h-4 w-4" />,
                                label: 'Editar',
                                onSelect: () => setSheet({ kind: 'edit', groupId: g.id }),
                              },
                              {
                                icon: <Trash2 aria-hidden="true" className="h-4 w-4" />,
                                label: 'Eliminar',
                                destructive: true,
                                confirmTitle: `¿Eliminar "${g.name}"?`,
                                confirmDescription:
                                  'Los miembros del grupo perderán los permisos asociados. Esta acción no se puede deshacer.',
                                confirmActionLabel: 'Sí, eliminar',
                                onSelect: () => handleQuickDelete(g),
                              },
                            ]
                          : [
                              {
                                icon: <Pencil aria-hidden="true" className="h-4 w-4" />,
                                label: 'Editar',
                                onSelect: () => setSheet({ kind: 'edit', groupId: g.id }),
                              },
                            ]
                      }
                    >
                      <span aria-hidden />
                    </RowActions>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        <button
          type="button"
          onClick={() => setSheet({ kind: 'create' })}
          className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md border border-dashed border-neutral-300 px-4 text-sm font-medium text-neutral-600 hover:border-neutral-500"
        >
          <span aria-hidden="true">+</span> Nuevo grupo
        </button>

        {!hasCustomGroups && (
          <p className="text-sm italic text-neutral-500">
            Todavía no creaste grupos custom. Crealos para delegar moderación a miembros sin darles
            todos los permisos.
          </p>
        )}
      </section>

      {/* Detail panel — siempre montado; open controla visibilidad. */}
      <GroupDetailPanel
        open={sheet.kind === 'detail'}
        onOpenChange={(next) => {
          if (!next) close()
        }}
        group={detailGroup}
        members={detailMembers}
        placeSlug={placeSlug}
        onEdit={() => {
          if (detailGroup) setSheet({ kind: 'edit', groupId: detailGroup.id })
        }}
        onManageMembers={() => {
          if (detailGroup) setSheet({ kind: 'members', groupId: detailGroup.id })
        }}
      />

      {/* Create form — always mounted, open controlled. */}
      <GroupFormSheet
        open={sheet.kind === 'create'}
        onOpenChange={(next) => {
          if (!next) close()
        }}
        mode={{ kind: 'create', placeSlug }}
      />

      {/* Edit form — mounted on demand con latch. */}
      {latchedEditMode ? (
        <GroupFormSheet
          open={sheet.kind === 'edit'}
          onOpenChange={(next) => {
            if (!next) close()
          }}
          mode={latchedEditMode}
        />
      ) : null}

      {/* Members sheet — mounted on demand con latch. */}
      {latchedMembersGroup ? (
        <GroupMembersSheet
          open={sheet.kind === 'members'}
          onOpenChange={(next) => {
            if (!next) close()
          }}
          groupId={latchedMembersGroup.id}
          groupName={latchedMembersGroup.name}
          currentMembers={latchedMembersList}
          availableMembers={latchedMembersAvailable}
        />
      ) : null}

      {/* Reference vars para evitar "unused" lint. */}
      <span aria-hidden className="hidden" data-active-members={activeMembers.length} />
      <span aria-hidden className="hidden" data-members-list={membersList.length} />
      <span aria-hidden className="hidden" data-members-available={membersAvailable.length} />
    </>
  )
}
