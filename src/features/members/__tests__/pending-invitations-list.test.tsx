import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import React from 'react'

const listPendingInvitationsByPlace = vi.fn()
vi.mock('../server/queries', () => ({
  listPendingInvitationsByPlace: (...a: unknown[]) => listPendingInvitationsByPlace(...a),
}))

vi.mock('server-only', () => ({}))

// El botón de reenvío es un Client Component aparte; lo stubeamos para que el
// test del list se concentre en layout + badges sin pegar a `resendInvitationAction`.
vi.mock('../ui/resend-invitation-button', () => ({
  ResendInvitationButton: ({ invitationId }: { invitationId: string }) => (
    <button type="button" data-testid={`resend-${invitationId}`}>
      Reenviar
    </button>
  ),
}))

import { PendingInvitationsList } from '../ui/pending-invitations-list'

const baseInvitation = {
  placeId: 'place-1',
  invitedBy: 'user-1',
  asAdmin: false,
  acceptedAt: null,
  token: 'tok',
  providerMessageId: null,
  lastDeliveryError: null,
  lastSentAt: null,
  inviter: { displayName: 'Max' },
}

beforeEach(() => {
  listPendingInvitationsByPlace.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('PendingInvitationsList', () => {
  it('empty state cuando no hay pending', async () => {
    listPendingInvitationsByPlace.mockResolvedValue([])
    const ui = await PendingInvitationsList({ placeId: 'place-1' })
    render(ui)
    expect(screen.getByText(/no hay invitaciones pendientes/i)).toBeTruthy()
  })

  it('renderiza rows con email, inviter, fecha, badge y botón reenviar', async () => {
    listPendingInvitationsByPlace.mockResolvedValue([
      {
        ...baseInvitation,
        id: 'inv-1',
        email: 'ana@example.com',
        expiresAt: new Date('2026-05-01T12:00:00Z'),
        deliveryStatus: 'SENT',
      },
      {
        ...baseInvitation,
        id: 'inv-2',
        email: 'juan@example.com',
        expiresAt: new Date('2026-04-28T12:00:00Z'),
        deliveryStatus: 'BOUNCED',
        lastDeliveryError: 'mailer: bounce — invalid mailbox',
      },
      {
        ...baseInvitation,
        id: 'inv-3',
        email: 'owner@example.com',
        expiresAt: new Date('2026-05-02T12:00:00Z'),
        deliveryStatus: 'PENDING',
        asAdmin: true,
      },
    ])

    const ui = await PendingInvitationsList({ placeId: 'place-1' })
    render(ui)

    expect(screen.getByText('ana@example.com')).toBeTruthy()
    expect(screen.getByText('juan@example.com')).toBeTruthy()
    expect(screen.getByText('owner@example.com')).toBeTruthy()

    // Status badges
    expect(screen.getByText('enviado')).toBeTruthy()
    expect(screen.getByText('rebotado')).toBeTruthy()
    expect(screen.getByText('pendiente')).toBeTruthy()

    // Admin badge solo en el tercero
    expect(screen.getByText('como admin')).toBeTruthy()

    // Inviter visible
    expect(screen.getAllByText(/invitado por max/i)).toHaveLength(3)

    // Error de delivery solo en el BOUNCED
    expect(screen.getByText(/invalid mailbox/i)).toBeTruthy()

    // Botón resend por row
    expect(screen.getByTestId('resend-inv-1')).toBeTruthy()
    expect(screen.getByTestId('resend-inv-2')).toBeTruthy()
    expect(screen.getByTestId('resend-inv-3')).toBeTruthy()
  })
})
