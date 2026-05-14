'use client'

import {
  EditPanel,
  EditPanelBody,
  EditPanelClose,
  EditPanelContent,
  EditPanelDescription,
  EditPanelFooter,
  EditPanelHeader,
  EditPanelTitle,
} from '@/shared/ui/edit-panel'
import { MemberGroupsControl } from '@/features/groups/public'
import type { GroupSummary } from '@/features/groups/public'

type Props = {
  open: boolean
  onOpenChange: (next: boolean) => void
  placeId: string
  memberUserId: string
  memberDisplayName: string
  /** Grupos a los que el miembro ya pertenece (incluye preset). */
  currentGroups: ReadonlyArray<GroupSummary>
  /** Grupos del place a los que el miembro NO pertenece todavía. */
  availableGroups: ReadonlyArray<GroupSummary>
}

/**
 * Sub-sheet de gestión de grupos del miembro.
 *
 * Wrap thin de `<MemberGroupsControl>` de `features/groups/`. Las
 * mutaciones disparan `addMemberToGroupAction` / `removeMemberFromGroupAction`
 * que revalidan el path — los datos se refrescan al close.
 */
export function MemberGroupsSheet({
  open,
  onOpenChange,
  placeId,
  memberUserId,
  memberDisplayName,
  currentGroups,
  availableGroups,
}: Props): React.ReactNode {
  return (
    <EditPanel open={open} onOpenChange={onOpenChange}>
      <EditPanelContent>
        <EditPanelHeader>
          <EditPanelTitle>Grupos de “{memberDisplayName}”</EditPanelTitle>
          <EditPanelDescription>
            Asigná o quitá grupos. Los cambios aplican inmediatamente.
          </EditPanelDescription>
        </EditPanelHeader>

        <EditPanelBody>
          <div className="py-2">
            <MemberGroupsControl
              placeId={placeId}
              memberUserId={memberUserId}
              currentGroups={currentGroups}
              availableGroups={availableGroups}
            />
          </div>
        </EditPanelBody>

        <EditPanelFooter>
          <EditPanelClose asChild>
            <button
              type="button"
              className="inline-flex min-h-12 w-full items-center justify-center rounded-md bg-neutral-900 px-4 text-sm font-medium text-white"
            >
              Listo
            </button>
          </EditPanelClose>
        </EditPanelFooter>
      </EditPanelContent>
    </EditPanel>
  )
}
