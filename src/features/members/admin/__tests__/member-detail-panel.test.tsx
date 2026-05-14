import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

// MemberDetailPanel embebe BlockMemberDialog/ExpelMemberDialog que importan
// moderation actions → arrastran supabase server-only. Stub env.
vi.mock('@/shared/config/env', () => ({
  serverEnv: { NODE_ENV: 'test' },
  clientEnv: {
    NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
    NEXT_PUBLIC_APP_URL: 'http://lvh.me:3000',
    NEXT_PUBLIC_APP_DOMAIN: 'lvh.me:3000',
  },
}))

import { MemberDetailPanel } from '../ui/member-detail-panel'
import type { MemberSummary } from '@/features/members/public.server'
import type { MemberDetailBlockInfo } from '../ui/member-detail-panel'

afterEach(() => cleanup())

const baseMember: MemberSummary = {
  userId: 'u-1',
  membershipId: 'm-1',
  joinedAt: new Date('2026-01-10T00:00:00Z'),
  isOwner: false,
  isAdmin: false,
  user: { displayName: 'Ana', handle: 'ana', avatarUrl: null },
  tierCount: 2,
}

const blockInfo: MemberDetailBlockInfo = {
  blockedAt: new Date('2026-04-01T00:00:00Z'),
  blockedReason: 'Spam recurrente.',
  blockedContactEmail: 'mod@example.com',
  blockedByDisplayName: 'Maxi',
}

describe('<MemberDetailPanel> — visibility según estado + permisos', () => {
  it('renderea displayName, handle y chip role en el header', () => {
    render(
      <MemberDetailPanel
        open={true}
        onOpenChange={() => {}}
        member={{ ...baseMember, isAdmin: true }}
        blockInfo={null}
        placeId="p-1"
        actorEmail="viewer@x.com"
        canExpel={true}
        canBlock={true}
        canUnblock={false}
        onManageTiers={null}
        onManageGroups={null}
      />,
    )
    expect(screen.getByText('Ana')).toBeInTheDocument()
    expect(screen.getByText('@ana')).toBeInTheDocument()
    expect(screen.getByText('admin')).toBeInTheDocument()
  })

  it('member sin bloqueo + canExpel + canBlock: footer muestra Bloquear + Expulsar', () => {
    render(
      <MemberDetailPanel
        open={true}
        onOpenChange={() => {}}
        member={baseMember}
        blockInfo={null}
        placeId="p-1"
        actorEmail="viewer@x.com"
        canExpel={true}
        canBlock={true}
        canUnblock={false}
        onManageTiers={null}
        onManageGroups={null}
      />,
    )
    expect(screen.getByRole('button', { name: /bloquear/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /expulsar/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /desbloquear/i })).not.toBeInTheDocument()
  })

  it('member bloqueado + canUnblock: footer muestra Desbloquear + sección amber con info', () => {
    render(
      <MemberDetailPanel
        open={true}
        onOpenChange={() => {}}
        member={baseMember}
        blockInfo={blockInfo}
        placeId="p-1"
        actorEmail="viewer@x.com"
        canExpel={true}
        canBlock={false}
        canUnblock={true}
        onManageTiers={null}
        onManageGroups={null}
      />,
    )
    expect(screen.getByRole('button', { name: /desbloquear/i })).toBeInTheDocument()
    expect(screen.getByText(/spam recurrente/i)).toBeInTheDocument()
    expect(screen.getByText(/por maxi/i)).toBeInTheDocument()
  })

  it('sin permisos: mensaje "sin acciones disponibles"', () => {
    render(
      <MemberDetailPanel
        open={true}
        onOpenChange={() => {}}
        member={baseMember}
        blockInfo={null}
        placeId="p-1"
        actorEmail="viewer@x.com"
        canExpel={false}
        canBlock={false}
        canUnblock={false}
        onManageTiers={null}
        onManageGroups={null}
      />,
    )
    expect(screen.getByText(/sin acciones disponibles/i)).toBeInTheDocument()
  })

  it('tier count > 0 muestra "asignaciones activas"', () => {
    render(
      <MemberDetailPanel
        open={true}
        onOpenChange={() => {}}
        member={baseMember}
        blockInfo={null}
        placeId="p-1"
        actorEmail="viewer@x.com"
        canExpel={false}
        canBlock={false}
        canUnblock={false}
        onManageTiers={null}
        onManageGroups={null}
      />,
    )
    expect(screen.getByText(/2 asignaciones activas/i)).toBeInTheDocument()
  })

  it('tier count = 0 muestra "sin tiers asignados"', () => {
    render(
      <MemberDetailPanel
        open={true}
        onOpenChange={() => {}}
        member={{ ...baseMember, tierCount: 0 }}
        blockInfo={null}
        placeId="p-1"
        actorEmail="viewer@x.com"
        canExpel={false}
        canBlock={false}
        canUnblock={false}
        onManageTiers={null}
        onManageGroups={null}
      />,
    )
    expect(screen.getByText(/sin tiers asignados/i)).toBeInTheDocument()
  })
})
