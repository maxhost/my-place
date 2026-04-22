import type { InvitationDeliveryStatus, MembershipRole } from '@prisma/client'

/**
 * Tipos de dominio del slice `members`. Puros, sin Next/React.
 */

export type InvitationId = string

export type Invitation = {
  id: InvitationId
  placeId: string
  email: string
  invitedBy: string
  asAdmin: boolean
  acceptedAt: Date | null
  expiresAt: Date
  token: string
}

export type InvitationDelivery = {
  deliveryStatus: InvitationDeliveryStatus
  providerMessageId: string | null
  lastDeliveryError: string | null
  lastSentAt: Date | null
}

export type PendingInvitation = Invitation &
  InvitationDelivery & {
    inviter: { displayName: string }
  }

export { type InvitationDeliveryStatus } from '@prisma/client'

/** Snapshot de permisos del actor sobre un place, al momento de consultar. */
export type InviterPermissions = {
  role: MembershipRole | null
  isOwner: boolean
}

export { type MembershipRole } from '@prisma/client'
