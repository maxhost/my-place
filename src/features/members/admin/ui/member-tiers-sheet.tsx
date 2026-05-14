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
import { AssignedTiersList, TierAssignmentControl } from '@/features/tier-memberships/public'
import type { TierMembershipDetail } from '@/features/tier-memberships/public'
import type { Tier } from '@/features/tiers/public'

type Props = {
  open: boolean
  onOpenChange: (next: boolean) => void
  placeSlug: string
  memberUserId: string
  memberDisplayName: string
  /** Tiers asignados al miembro hoy (incluye expiraciones futuras + indefinidos). */
  tierMemberships: ReadonlyArray<TierMembershipDetail>
  /** Tiers del place con `visibility=PUBLISHED` — el control filtra y la action valida. */
  publishedTiers: ReadonlyArray<Tier>
}

/**
 * Sub-sheet de gestión de tiers asignados a un miembro.
 *
 * Wrap thin del par `<AssignedTiersList>` + `<TierAssignmentControl>`
 * existentes en `features/tier-memberships/`. Las mutaciones disparan
 * `assignTierToMemberAction` / `removeTierAssignmentAction` que
 * revalidan el path — los datos se refrescan al close.
 *
 * Footer: "Listo" cierra el sheet (no es submit — las mutations son
 * inmediatas por gesto, igual que `<GroupMembersSheet>`).
 */
export function MemberTiersSheet({
  open,
  onOpenChange,
  placeSlug,
  memberUserId,
  memberDisplayName,
  tierMemberships,
  publishedTiers,
}: Props): React.ReactNode {
  return (
    <EditPanel open={open} onOpenChange={onOpenChange}>
      <EditPanelContent>
        <EditPanelHeader>
          <EditPanelTitle>Tiers de “{memberDisplayName}”</EditPanelTitle>
          <EditPanelDescription>
            Asigná o quitá tiers. Los cambios aplican inmediatamente.
          </EditPanelDescription>
        </EditPanelHeader>

        <EditPanelBody>
          <div className="space-y-4 py-2">
            <AssignedTiersList tierMemberships={tierMemberships} />
            <div className="space-y-2">
              <h3
                className="border-b pb-2 font-serif text-base"
                style={{ borderColor: 'var(--border)' }}
              >
                Asignar tier
              </h3>
              <TierAssignmentControl
                placeSlug={placeSlug}
                memberUserId={memberUserId}
                availableTiers={publishedTiers}
              />
            </div>
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
