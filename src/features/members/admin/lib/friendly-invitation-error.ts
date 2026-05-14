import { isDomainError } from '@/shared/errors/domain-error'

/**
 * Mapper de DomainError → string user-facing para acciones de invitations
 * (resend/revoke/invite). Usado en orchestrator + InvitationDetailPanel.
 *
 * Centralizado para mantener mensajes consistentes entre callsites.
 */
export function friendlyInvitationError(err: unknown): string {
  if (isDomainError(err)) {
    switch (err.code) {
      case 'AUTHORIZATION':
        return 'No tenés permisos.'
      case 'NOT_FOUND':
        return 'La invitación ya no existe.'
      case 'CONFLICT':
        return err.message
      case 'VALIDATION':
        return err.message
      case 'INVITATION_LINK_GENERATION':
        return 'No pudimos generar el link. Intentá de nuevo.'
      case 'INVITATION_EMAIL_FAILED':
        return 'No pudimos enviar el email. Intentá de nuevo.'
      default:
        return 'No se pudo completar la acción.'
    }
  }
  return 'Error inesperado.'
}
