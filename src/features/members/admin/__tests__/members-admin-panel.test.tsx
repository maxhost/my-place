import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'

// MembersAdminPanel usa EditPanel (Radix Dialog) + RowActions; no toca next/router
// directamente (sólo `<a>` para tab chips). Mock minimal.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/settings/members',
}))

// El panel importa actions de members/invitations/public que arrastran supabase
// server-only. Stubeamos el env para evitar parse eager de Zod sobre process.env.
vi.mock('@/shared/config/env', () => ({
  serverEnv: { NODE_ENV: 'test' },
  clientEnv: {
    NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
    NEXT_PUBLIC_APP_URL: 'http://lvh.me:3000',
    NEXT_PUBLIC_APP_DOMAIN: 'lvh.me:3000',
  },
}))

import { MembersAdminPanel } from '../ui/members-admin-panel'
import type {
  MemberDirectoryPage,
  PendingInvitationsPage,
  MemberSummary,
} from '@/features/members/public.server'

beforeEach(() => {})

afterEach(() => cleanup())

const baseMember: MemberSummary = {
  userId: 'u-1',
  membershipId: 'm-1',
  joinedAt: new Date('2026-01-10T00:00:00Z'),
  isOwner: false,
  isAdmin: false,
  user: { displayName: 'Ana', handle: 'ana', avatarUrl: null },
  tierCount: 0,
}

const hrefs = {
  activeTab: '/settings/members',
  pendingTab: '/settings/members?tab=pending',
  prevPage: null,
  nextPage: null,
}

const emptyMembersPage: MemberDirectoryPage = { rows: [], totalCount: 0, hasMore: false }
const emptyInvitationsPage: PendingInvitationsPage = { rows: [], totalCount: 0, hasMore: false }

describe('<MembersAdminPanel> — render según tab', () => {
  it('tab active vacío: empty state con copy adecuado', () => {
    render(
      <MembersAdminPanel
        placeSlug="the-company"
        tab="active"
        q=""
        page={1}
        pageSize={20}
        membersPage={emptyMembersPage}
        invitationsPage={emptyInvitationsPage}
        blockInfoByUserId={new Map()}
        viewerUserId="viewer"
        canBlock={true}
        canUnblock={true}
        canExpel={true}
        canRevoke={true}
        placeId="p-1"
        actorEmail="viewer@x.com"
        canInviteAsAdmin={true}
        tierMembershipsByUserId={new Map()}
        groupsByUserId={new Map()}
        publishedTiers={[]}
        allGroups={[]}
        hrefs={hrefs}
      />,
    )
    expect(screen.getByText(/todavía no hay miembros activos/i)).toBeInTheDocument()
  })

  it('tab active con rows: renderiza filas con displayName y handle', () => {
    render(
      <MembersAdminPanel
        placeSlug="the-company"
        tab="active"
        q=""
        page={1}
        pageSize={20}
        membersPage={{ rows: [baseMember], totalCount: 1, hasMore: false }}
        invitationsPage={emptyInvitationsPage}
        blockInfoByUserId={new Map()}
        viewerUserId="viewer"
        canBlock={true}
        canUnblock={true}
        canExpel={true}
        canRevoke={true}
        placeId="p-1"
        actorEmail="viewer@x.com"
        canInviteAsAdmin={true}
        tierMembershipsByUserId={new Map()}
        groupsByUserId={new Map()}
        publishedTiers={[]}
        allGroups={[]}
        hrefs={hrefs}
      />,
    )
    expect(screen.getByText('Ana')).toBeInTheDocument()
    expect(screen.getByText('@ana')).toBeInTheDocument()
  })

  it('tab pending vacío con q: copy específico de búsqueda sin matches', () => {
    render(
      <MembersAdminPanel
        placeSlug="the-company"
        tab="pending"
        q="nomatch"
        page={1}
        pageSize={20}
        membersPage={emptyMembersPage}
        invitationsPage={emptyInvitationsPage}
        blockInfoByUserId={new Map()}
        viewerUserId="viewer"
        canBlock={true}
        canUnblock={true}
        canExpel={true}
        canRevoke={true}
        placeId="p-1"
        actorEmail="viewer@x.com"
        canInviteAsAdmin={true}
        tierMembershipsByUserId={new Map()}
        groupsByUserId={new Map()}
        publishedTiers={[]}
        allGroups={[]}
        hrefs={hrefs}
      />,
    )
    expect(screen.getByText(/ninguna invitación coincide/i)).toBeInTheDocument()
  })

  it('tab chips: el chip activo tiene aria-current="page" y el otro no', () => {
    render(
      <MembersAdminPanel
        placeSlug="the-company"
        tab="active"
        q=""
        page={1}
        pageSize={20}
        membersPage={emptyMembersPage}
        invitationsPage={emptyInvitationsPage}
        blockInfoByUserId={new Map()}
        viewerUserId="viewer"
        canBlock={true}
        canUnblock={true}
        canExpel={true}
        canRevoke={true}
        placeId="p-1"
        actorEmail="viewer@x.com"
        canInviteAsAdmin={true}
        tierMembershipsByUserId={new Map()}
        groupsByUserId={new Map()}
        publishedTiers={[]}
        allGroups={[]}
        hrefs={hrefs}
      />,
    )
    const activos = screen.getByRole('link', { name: /activos/i })
    const invitados = screen.getByRole('link', { name: /invitados/i })
    expect(activos).toHaveAttribute('aria-current', 'page')
    expect(invitados).not.toHaveAttribute('aria-current')
  })
})

describe('<MembersAdminPanel> — interacciones de detail panel', () => {
  it('click en el row de un miembro abre detail panel con su displayName', () => {
    render(
      <MembersAdminPanel
        placeSlug="the-company"
        tab="active"
        q=""
        page={1}
        pageSize={20}
        membersPage={{ rows: [baseMember], totalCount: 1, hasMore: false }}
        invitationsPage={emptyInvitationsPage}
        blockInfoByUserId={new Map()}
        viewerUserId="viewer"
        canBlock={true}
        canUnblock={true}
        canExpel={true}
        canRevoke={true}
        placeId="p-1"
        actorEmail="viewer@x.com"
        canInviteAsAdmin={true}
        tierMembershipsByUserId={new Map()}
        groupsByUserId={new Map()}
        publishedTiers={[]}
        allGroups={[]}
        hrefs={hrefs}
      />,
    )
    const rowButton = screen.getByRole('button', { name: /ver detalle de ana/i })
    fireEvent.click(rowButton)
    // EditPanel renderiza el title con el displayName.
    // Detail panel: section "Membresía" con fecha de joined.
    expect(screen.getByText(/membresía/i)).toBeInTheDocument()
  })

  it('viewer es self → no se muestran acciones expulsar/bloquear en kebab', () => {
    render(
      <MembersAdminPanel
        placeSlug="the-company"
        tab="active"
        q=""
        page={1}
        pageSize={20}
        membersPage={{ rows: [{ ...baseMember, userId: 'viewer' }], totalCount: 1, hasMore: false }}
        invitationsPage={emptyInvitationsPage}
        blockInfoByUserId={new Map()}
        viewerUserId="viewer"
        canBlock={true}
        canUnblock={true}
        canExpel={true}
        canRevoke={true}
        placeId="p-1"
        actorEmail="viewer@x.com"
        canInviteAsAdmin={true}
        tierMembershipsByUserId={new Map()}
        groupsByUserId={new Map()}
        publishedTiers={[]}
        allGroups={[]}
        hrefs={hrefs}
      />,
    )
    // No hay kebab (sin acciones para self) → no aparece "Expulsar"
    expect(screen.queryByText(/expulsar/i)).not.toBeInTheDocument()
  })
})
