/**
 * API pública del slice `places`. Único punto de entrada desde otras partes del sistema.
 * Ver `docs/architecture.md` § boundaries.
 */

export type { Place, MyPlace, PlaceId, Slug, BillingMode, MembershipRole } from './domain/types'
export {
  createPlaceSchema,
  transferOwnershipSchema,
  type CreatePlaceInput,
  type TransferOwnershipInput,
} from './schemas'
export { assertMinOneOwner } from './domain/invariants'
export { archivePlaceAction, createPlaceAction, transferOwnershipAction } from './server/actions'
export { listMyPlaces } from './server/queries'
export { PlaceCreateForm } from './ui/place-create-form'
export { PlacesList } from './ui/places-list'
export { TransferOwnershipForm } from './ui/transfer-ownership-form'
