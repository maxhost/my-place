import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import React from 'react'
import { ConflictError } from '@/shared/errors/domain-error'

const resendInvitationAction = vi.fn()
vi.mock('../server/actions', () => ({
  resendInvitationAction: (...a: unknown[]) => resendInvitationAction(...a),
}))

import { ResendInvitationButton } from '../ui/resend-invitation-button'

beforeEach(() => {
  resendInvitationAction.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('ResendInvitationButton', () => {
  it('click dispara la action con el invitationId', async () => {
    resendInvitationAction.mockResolvedValue({ ok: true, invitationId: 'inv-1' })
    render(<ResendInvitationButton invitationId="inv-1" />)
    fireEvent.click(screen.getByRole('button', { name: /reenviar/i }))

    expect(resendInvitationAction).toHaveBeenCalledWith({ invitationId: 'inv-1' })
    expect(await screen.findByRole('status')).toHaveTextContent(/reenviado/i)
  })

  it('muestra mensaje friendly si la action tira ConflictError', async () => {
    resendInvitationAction.mockRejectedValue(
      new ConflictError('Esta invitación ya fue aceptada.', { reason: 'already_accepted' }),
    )
    render(<ResendInvitationButton invitationId="inv-1" />)
    fireEvent.click(screen.getByRole('button', { name: /reenviar/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/ya fue aceptada/i)
  })

  it('muestra mensaje para INVITATION_EMAIL_FAILED sin revelar detalle técnico', async () => {
    // Objeto serialized-style (sin prototype chain) — simula lo que llega del boundary.
    resendInvitationAction.mockRejectedValue({
      code: 'INVITATION_EMAIL_FAILED',
      message: 'resend 503 downstream noise',
    })
    render(<ResendInvitationButton invitationId="inv-1" />)
    fireEvent.click(screen.getByRole('button', { name: /reenviar/i }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/no pudimos enviar el email/i)
    expect(alert.textContent).not.toMatch(/503/i)
  })
})
