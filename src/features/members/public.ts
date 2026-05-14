/**
 * API pública client-safe del slice `members` — barrel **lite**.
 *
 * Sólo lo que SE USA EN MÚLTIPLES pages: `MemberAvatar` (todas las
 * pages que muestran members), tipos del dominio, schemas Zod globales,
 * y `searchMembersByPlaceAction` (typeahead de mentions).
 *
 * Los Client Components admin/forms (heavy: dialogs, sheets, forms con
 * react-hook-form + Zod) viven en sub-slice publics dedicados:
 *
 *  - `members/invitations/public` → InviteForm, AcceptInvitationView,
 *    InviteOwnerSheet, ResendInvitationButton, accept/invite/resend actions.
 *  - `members/moderation/public` → BlockMemberDialog, ExpelMemberDialog,
 *    UserBlockedView, block/expel/unblock actions.
 *  - `members/profile/public` → LeaveButton, LeavePlaceDialog, leave action.
 *  - `members/access/public` → OwnersAccessPanel (orchestrator de
 *    `/settings/access` con multiple dialogs).
 *
 * Re-exportar todo desde el barrel raíz (como antes) arrastra ~17 kB gzip
 * de forms a CUALQUIER page que sólo necesite `MemberAvatar` (member detail,
 * threads, comments, group detail, etc.). Por eso se splitea — sólo las
 * pages que usan los heavy importan del sub-slice. Ver ADR
 * `docs/decisions/2026-05-08-sub-slice-cross-public.md`.
 *
 * **No** incluye queries server-only ni componentes que las usen
 * (ver `public.server.ts`). Mismo patrón split que `flags/public.ts`
 * + `flags/public.server.ts` (ADR `2026-04-21-flags-subslice-split.md`):
 * Next traza re-exports al bundle cliente cuando un Server Component
 * que viaja a un Client Component importa este archivo. Mezclar
 * `import 'server-only'` acá rompería el build.
 */

// ---------------------------------------------------------------
// Tipos del dominio
// ---------------------------------------------------------------
export type {
  Invitation,
  InvitationDelivery,
  InvitationDeliveryStatus,
  InvitationId,
  InviterPermissions,
  PendingInvitation,
} from './domain/types'

// ---------------------------------------------------------------
// Schemas Zod + constants de moderación
// ---------------------------------------------------------------
export {
  BLOCK_MEMBER_REASON_MAX_LENGTH,
  EXPEL_MEMBER_REASON_MAX_LENGTH,
  UNBLOCK_MEMBER_MESSAGE_MAX_LENGTH,
  acceptInvitationTokenSchema,
  blockMemberInputSchema,
  expelMemberInputSchema,
  inviteMemberSchema,
  leaveMembershipPlaceSlugSchema,
  resendInvitationSchema,
  unblockMemberInputSchema,
  directoryQueryParamsSchema,
  DIRECTORY_LIMIT_DEFAULT,
  DIRECTORY_LIMIT_MAX,
  DIRECTORY_QUERY_MAX_LENGTH,
  type AcceptInvitationToken,
  type BlockMemberInput,
  type DirectoryQueryParams,
  type ExpelMemberInput,
  type InviteMemberInput,
  type LeaveMembershipPlaceSlug,
  type ResendInvitationInput,
  type UnblockMemberInput,
} from './schemas'

// ---------------------------------------------------------------
// Server Actions livianas (lite). Las heavy (accept/invite/leave/resend/
// block/expel/unblock) viven en los sub-slice publics correspondientes.
// ---------------------------------------------------------------

// F.4 (rich-text): autocomplete `@user` para composers — Server Action
// wrapper de la query cacheada `searchMembersByPlace`. Lite (no toca UI
// de admin/forms; se usa en cada composer surface).
export { searchMembersByPlaceAction } from './server/actions/mention-search'

// ---------------------------------------------------------------
// UI client-safe lite. Heavy components viven en sub-slice publics
// (ver docstring del archivo).
// ---------------------------------------------------------------
export { MemberAvatar } from './ui/member-avatar'

// ---------------------------------------------------------------
// Helpers puros (sin imports server-only)
// ---------------------------------------------------------------
export {
  RESEND_EVENT_TO_STATUS,
  canTransition as canTransitionInvitationDelivery,
} from './server/delivery-transitions'
