import type { BillingMode, MembershipRole } from '@prisma/client'

/**
 * Tipos de dominio del slice `places`. Puros, sin dependencias de Next/React.
 * Prisma es OK porque define el enum a nivel schema (fuente canónica del modelo).
 */

export type PlaceId = string
export type Slug = string

export type Place = {
  id: PlaceId
  slug: Slug
  name: string
  description: string | null
  billingMode: BillingMode
  archivedAt: Date | null
  createdAt: Date
}

export type MyPlace = Place & {
  role: MembershipRole
  isOwner: boolean
  joinedAt: Date
}

export { type BillingMode, type MembershipRole } from '@prisma/client'
