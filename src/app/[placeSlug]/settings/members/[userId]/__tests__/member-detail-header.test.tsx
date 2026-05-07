import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

// Stub `@/features/members/public` para no arrastrar el chain de actions →
// env eager (NEXT_PUBLIC_*). Sólo necesitamos `MemberAvatar` para el render
// del header. Mismo patrón que `reader-stack.test.tsx` y otros tests del repo.
vi.mock('@/features/members/public', () => ({
  MemberAvatar: (props: { displayName: string; userId: string; size?: number }) => (
    <span data-testid="member-avatar" data-user={props.userId} data-size={props.size ?? 64}>
      {props.displayName}
    </span>
  ),
}))

import type { MemberDetail } from '@/features/members/public.server'
import { MemberDetailHeader } from '../components/member-detail-header'

afterEach(() => {
  cleanup()
})

const baseMember: MemberDetail = {
  userId: 'usr_e2e_ana',
  membershipId: 'mem_1',
  joinedAt: new Date('2026-01-15T10:00:00Z'),
  isOwner: false,
  isAdmin: false,
  user: {
    displayName: 'Ana Test',
    handle: 'ana',
    avatarUrl: null,
  },
}

describe('MemberDetailHeader', () => {
  it('renderiza displayName, handle y badge de rol miembro', () => {
    render(<MemberDetailHeader member={baseMember} />)
    expect(screen.getByRole('heading', { name: 'Ana Test' })).toBeTruthy()
    expect(screen.getByText('@ana')).toBeTruthy()
    expect(screen.getByText('miembro')).toBeTruthy()
  })

  it('muestra badge "owner" + "admin" cuando aplica', () => {
    render(<MemberDetailHeader member={{ ...baseMember, isOwner: true, isAdmin: true }} />)
    expect(screen.getByText('owner')).toBeTruthy()
    expect(screen.getByText('admin')).toBeTruthy()
  })

  it('NO muestra el email del miembro (decisión #6 ADR — privacidad)', () => {
    // Aunque MemberDetail no incluye email en el shape (decisión M.3), reforzamos
    // con un test explícito: ningún literal con un email fake aparece en el render.
    // Si el día de mañana alguien sumara `email` al shape sin pensar, este test
    // captura la regresión.
    render(
      <MemberDetailHeader
        member={{
          ...baseMember,
          // @ts-expect-error — propiedad fuera del tipo a propósito (ver doc arriba).
          user: { ...baseMember.user, email: 'ana@example.com' },
        }}
      />,
    )
    expect(screen.queryByText(/ana@example\.com/i)).toBeNull()
    expect(screen.queryByText(/email/i)).toBeNull()
  })

  it('muestra "Miembro desde" + fecha en formato absoluto', () => {
    render(<MemberDetailHeader member={baseMember} />)
    // formatAbsoluteTimeLong devuelve algo como "15 ene 2026, 07:00" en es-AR.
    // Validamos sólo que aparezca el prefix + el año — el formato exacto depende
    // del locale del runtime, pero el año es estable.
    const meta = screen.getByText(/Miembro desde/i)
    expect(meta).toBeTruthy()
    expect(meta.textContent).toMatch(/2026/)
  })

  it('omite handle cuando es null', () => {
    render(
      <MemberDetailHeader member={{ ...baseMember, user: { ...baseMember.user, handle: null } }} />,
    )
    expect(screen.queryByText(/^@/)).toBeNull()
  })
})
