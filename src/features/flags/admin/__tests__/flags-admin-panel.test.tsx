import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => '/settings/flags',
}))

// El panel importa reviewFlagAction de flags/public que arrastra supabase
// server-only. Stub env para evitar parse eager de Zod sobre process.env.
vi.mock('@/shared/config/env', () => ({
  serverEnv: { NODE_ENV: 'test' },
  clientEnv: {
    NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
    NEXT_PUBLIC_APP_URL: 'http://lvh.me:3000',
    NEXT_PUBLIC_APP_DOMAIN: 'lvh.me:3000',
  },
}))

import { FlagsAdminPanel } from '../ui/flags-admin-panel'
import type { FlagView } from '@/features/flags/public'

afterEach(() => cleanup())

const baseView: FlagView = {
  id: 'flag-1',
  targetType: 'POST',
  targetId: 'post-1',
  reason: 'SPAM',
  reasonNote: 'Cuelga links sospechosos.',
  createdAt: new Date('2026-05-10T12:00:00Z'),
  reporterUserId: 'reporter-1',
  status: 'OPEN',
  reviewedAt: null,
  reviewNote: null,
  contentStatus: 'VISIBLE',
  title: 'Compra criptos baratas',
  preview: 'Inversión segura, contactame por DM…',
  postSlug: 'compra-criptos-baratas',
  postId: 'post-1',
}

const hrefs = {
  pendingTab: '/settings/flags',
  resolvedTab: '/settings/flags?tab=resolved',
  typeFilters: {
    all: '/settings/flags',
    POST: '/settings/flags?type=POST',
    COMMENT: '/settings/flags?type=COMMENT',
    EVENT: '/settings/flags?type=EVENT',
  },
  nextPage: null,
}

describe('<FlagsAdminPanel> — render según tab y filtro', () => {
  it('tab pending sin views: empty state genérico', () => {
    render(
      <FlagsAdminPanel
        placeSlug="the-company"
        tab="pending"
        targetType="all"
        views={[]}
        hrefs={hrefs}
      />,
    )
    expect(screen.getByText(/no hay reportes pendientes\./i)).toBeInTheDocument()
  })

  it('tab pending con targetType POST y sin views: empty state contextualizado', () => {
    render(
      <FlagsAdminPanel
        placeSlug="the-company"
        tab="pending"
        targetType="POST"
        views={[]}
        hrefs={hrefs}
      />,
    )
    expect(
      screen.getByText(/no hay reportes pendientes para este tipo de contenido/i),
    ).toBeInTheDocument()
  })

  it('tab resolved vacío: copy específico', () => {
    render(
      <FlagsAdminPanel
        placeSlug="the-company"
        tab="resolved"
        targetType="all"
        views={[]}
        hrefs={hrefs}
      />,
    )
    expect(screen.getByText(/no hay reportes resueltos todavía/i)).toBeInTheDocument()
  })

  it('tab chips: el chip activo tiene aria-current="page"', () => {
    render(
      <FlagsAdminPanel
        placeSlug="the-company"
        tab="pending"
        targetType="all"
        views={[]}
        hrefs={hrefs}
      />,
    )
    const pendientes = screen.getByRole('link', { name: 'Pendientes' })
    const resueltos = screen.getByRole('link', { name: 'Resueltos' })
    expect(pendientes).toHaveAttribute('aria-current', 'page')
    expect(resueltos).not.toHaveAttribute('aria-current')
  })

  it('targetType filter chip activo tiene aria-checked=true', () => {
    render(
      <FlagsAdminPanel
        placeSlug="the-company"
        tab="pending"
        targetType="POST"
        views={[]}
        hrefs={hrefs}
      />,
    )
    const posts = screen.getByRole('radio', { name: 'Posts' })
    const todos = screen.getByRole('radio', { name: 'Todos' })
    expect(posts).toHaveAttribute('aria-checked', 'true')
    expect(todos).toHaveAttribute('aria-checked', 'false')
  })
})

describe('<FlagsAdminPanel> — interacciones', () => {
  it('renderiza una row por view + chips de reason y targetType', () => {
    render(
      <FlagsAdminPanel
        placeSlug="the-company"
        tab="pending"
        targetType="all"
        views={[baseView]}
        hrefs={hrefs}
      />,
    )
    expect(screen.getByText('Compra criptos baratas')).toBeInTheDocument()
    expect(screen.getByText('Spam')).toBeInTheDocument()
    expect(screen.getByText('post')).toBeInTheDocument()
  })

  it('click en la row abre el detail panel con la reason y el preview', () => {
    render(
      <FlagsAdminPanel
        placeSlug="the-company"
        tab="pending"
        targetType="all"
        views={[baseView]}
        hrefs={hrefs}
      />,
    )
    const rowButton = screen.getByRole('button', { name: /ver detalle del reporte flag-1/i })
    fireEvent.click(rowButton)
    // Detail panel: section Reporte visible (TimeAgo + razón).
    expect(screen.getAllByText(/Reporte/i).length).toBeGreaterThan(0)
    // El reasonNote completo aparece en el panel.
    expect(screen.getByText(/Cuelga links sospechosos\./i)).toBeInTheDocument()
  })
})
