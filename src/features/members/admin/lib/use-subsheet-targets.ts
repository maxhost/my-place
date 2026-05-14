'use client'

import { useState } from 'react'
import type { GroupSummary } from '@/features/groups/public'
import type { TierMembershipDetail } from '@/features/tier-memberships/public'
import type { MemberSummary } from '@/features/members/public.server'

type SheetTarget = { userId: string; displayName: string }

type Input = {
  /** Estado actual del sub-sheet abierto (o null si no hay ninguno). */
  activeSheet: { kind: 'edit-tiers' | 'edit-groups'; userId: string } | null
  members: ReadonlyArray<MemberSummary>
  tierMembershipsByUserId: ReadonlyMap<string, ReadonlyArray<TierMembershipDetail>>
  groupsByUserId: ReadonlyMap<string, ReadonlyArray<GroupSummary>>
  allGroups: ReadonlyArray<GroupSummary>
}

export type TiersSheetData = {
  userId: string
  displayName: string
  tierMemberships: ReadonlyArray<TierMembershipDetail>
}

export type GroupsSheetData = {
  userId: string
  displayName: string
  currentGroups: ReadonlyArray<GroupSummary>
  availableGroups: ReadonlyArray<GroupSummary>
}

/**
 * Latch + derivación de datos para los sub-sheets `edit-tiers` / `edit-groups`
 * de `<MembersAdminPanel>`.
 *
 * Preserva el último `{userId, displayName}` non-null para que Radix Presence
 * anime el exit del Content cuando el sheet cierra. Deriva `availableGroups`
 * filtrando `allGroups` por los que el miembro ya tiene.
 */
export function useSubsheetTargets({
  activeSheet,
  members,
  tierMembershipsByUserId,
  groupsByUserId,
  allGroups,
}: Input): { tiersSheetData: TiersSheetData | null; groupsSheetData: GroupsSheetData | null } {
  const [latchedTiersTarget, setLatchedTiersTarget] = useState<SheetTarget | null>(null)
  const [latchedGroupsTarget, setLatchedGroupsTarget] = useState<SheetTarget | null>(null)

  if (activeSheet?.kind === 'edit-tiers') {
    const m = members.find((x) => x.userId === activeSheet.userId)
    if (m && latchedTiersTarget?.userId !== m.userId) {
      setLatchedTiersTarget({ userId: m.userId, displayName: m.user.displayName })
    }
  }
  if (activeSheet?.kind === 'edit-groups') {
    const m = members.find((x) => x.userId === activeSheet.userId)
    if (m && latchedGroupsTarget?.userId !== m.userId) {
      setLatchedGroupsTarget({ userId: m.userId, displayName: m.user.displayName })
    }
  }

  const tiersSheetData: TiersSheetData | null = latchedTiersTarget
    ? {
        userId: latchedTiersTarget.userId,
        displayName: latchedTiersTarget.displayName,
        tierMemberships: tierMembershipsByUserId.get(latchedTiersTarget.userId) ?? [],
      }
    : null

  let groupsSheetData: GroupsSheetData | null = null
  if (latchedGroupsTarget) {
    const currentGroups = groupsByUserId.get(latchedGroupsTarget.userId) ?? []
    const currentIds = new Set(currentGroups.map((g) => g.id))
    const availableGroups = allGroups.filter((g) => !currentIds.has(g.id))
    groupsSheetData = {
      userId: latchedGroupsTarget.userId,
      displayName: latchedGroupsTarget.displayName,
      currentGroups,
      availableGroups,
    }
  }

  return { tiersSheetData, groupsSheetData }
}
