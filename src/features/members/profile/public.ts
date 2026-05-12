/** API pública del sub-slice members/profile/. */

export { leaveMembershipAction } from './server/actions/leave'
export { LeaveButton } from './ui/leave-button'
export { LeavePlaceDialog } from './ui/leave-place-dialog'
// `LeaveSystemPanel` vive físicamente en `members/ui/leave-system-panel.tsx`
// (igual que `OwnersAccessPanel` vive en `ui/` pero se expone via `access/`).
// Lifecycle-related → barrel `profile/` que ya contiene `LeavePlaceDialog`.
export { LeaveSystemPanel } from '../ui/leave-system-panel'
