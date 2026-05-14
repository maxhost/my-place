import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

vi.mock('@/shared/config/env', () => ({
  serverEnv: { NODE_ENV: 'test' },
  clientEnv: {
    NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
    NEXT_PUBLIC_APP_URL: 'http://lvh.me:3000',
    NEXT_PUBLIC_APP_DOMAIN: 'lvh.me:3000',
  },
}))

import { FlagDetailPanel } from '../ui/flag-detail-panel'
import type { FlagView } from '@/features/flags/public'

afterEach(() => cleanup())

function makeView(overrides: Partial<FlagView> = {}): FlagView {
  return {
    id: 'flag-1',
    targetType: 'POST',
    targetId: 'post-1',
    reason: 'SPAM',
    reasonNote: null,
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
    ...overrides,
  }
}

describe('<FlagDetailPanel> — footer actions según contentStatus + targetType', () => {
  it('POST OPEN + VISIBLE: footer muestra Ignorar + Ocultar + Eliminar', () => {
    render(
      <FlagDetailPanel
        open={true}
        onOpenChange={() => {}}
        view={makeView()}
        onAfterReview={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: /ignorar/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ocultar post/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /eliminar post/i })).toBeInTheDocument()
  })

  it('POST OPEN + HIDDEN: NO se muestra "Ocultar" (ya está oculto)', () => {
    render(
      <FlagDetailPanel
        open={true}
        onOpenChange={() => {}}
        view={makeView({ contentStatus: 'HIDDEN' })}
        onAfterReview={() => {}}
      />,
    )
    expect(screen.queryByRole('button', { name: /ocultar post/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /eliminar post/i })).toBeInTheDocument()
  })

  it('POST OPEN + DELETED: NO se muestran "Ocultar" ni "Eliminar"', () => {
    render(
      <FlagDetailPanel
        open={true}
        onOpenChange={() => {}}
        view={makeView({ contentStatus: 'DELETED' })}
        onAfterReview={() => {}}
      />,
    )
    expect(screen.queryByRole('button', { name: /ocultar post/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /eliminar/i })).not.toBeInTheDocument()
    // Pero Ignorar sigue disponible (puede ignorarse un reporte sobre contenido ya borrado).
    expect(screen.getByRole('button', { name: /ignorar/i })).toBeInTheDocument()
  })

  it('COMMENT OPEN + VISIBLE: NO "Ocultar" (solo aplica a POST); SÍ "Eliminar comentario"', () => {
    render(
      <FlagDetailPanel
        open={true}
        onOpenChange={() => {}}
        view={makeView({ targetType: 'COMMENT', title: null })}
        onAfterReview={() => {}}
      />,
    )
    expect(screen.queryByRole('button', { name: /ocultar/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /eliminar comentario/i })).toBeInTheDocument()
  })

  it('Status REVIEWED_ACTIONED: NO se muestra el footer (resuelto)', () => {
    render(
      <FlagDetailPanel
        open={true}
        onOpenChange={() => {}}
        view={makeView({
          status: 'REVIEWED_ACTIONED',
          reviewedAt: new Date('2026-05-11T12:00:00Z'),
          reviewNote: 'Era spam evidente.',
        })}
        onAfterReview={() => {}}
      />,
    )
    expect(screen.queryByRole('button', { name: /ignorar/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /eliminar/i })).not.toBeInTheDocument()
    // Sí se muestra la sección Resolución con reviewNote.
    expect(screen.getByText(/Era spam evidente/i)).toBeInTheDocument()
    expect(screen.getByText(/Se tomó acción/i)).toBeInTheDocument()
  })

  it('reporterUserId === null (post-erasure): muestra "ex-miembro"', () => {
    render(
      <FlagDetailPanel
        open={true}
        onOpenChange={() => {}}
        view={makeView({ reporterUserId: null })}
        onAfterReview={() => {}}
      />,
    )
    expect(screen.getByText(/ex-miembro/i)).toBeInTheDocument()
  })

  it('preview vacío: muestra fallback "contenido no disponible"', () => {
    render(
      <FlagDetailPanel
        open={true}
        onOpenChange={() => {}}
        view={makeView({ preview: '' })}
        onAfterReview={() => {}}
      />,
    )
    expect(screen.getByText(/el contenido ya no está disponible/i)).toBeInTheDocument()
  })
})
