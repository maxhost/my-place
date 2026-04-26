import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

// Stub MemberAvatar para no arrastrar el chain de members/server-only env al
// test runtime (mismo patrón que reader-stack.test.tsx). PostReadersBlock
// reusa <ReaderStack> que internamente usa MemberAvatar.
vi.mock('@/features/members/public', () => ({
  MemberAvatar: (props: { displayName: string; userId: string; size?: number }) => (
    <span data-testid="member-avatar" data-user={props.userId} data-size={props.size ?? 28}>
      {props.displayName}
    </span>
  ),
}))

import { PostReadersBlock } from '../ui/post-readers-block'

// Shape mínimo del PostReader. El tipo canónico vive en
// `../server/queries` pero importarlo arrastra el chain de Prisma+env
// al test runtime. Acá replicamos el shape (es estable, sin métodos).
type PostReader = {
  userId: string
  displayName: string
  avatarUrl: string | null
  readAt: Date
}

function makeReader(
  overrides: Partial<{
    userId: string
    displayName: string
    avatarUrl: string | null
    readAt: Date
  }> = {},
): PostReader {
  return {
    userId: overrides.userId ?? 'u-1',
    displayName: overrides.displayName ?? 'Max',
    avatarUrl: overrides.avatarUrl ?? null,
    readAt: overrides.readAt ?? new Date('2026-04-22T20:00:00Z'),
  }
}

function renderBlock(readers: PostReader[]) {
  return render(<PostReadersBlock readers={readers} />)
}

describe('PostReadersBlock (R.6.4 layout: stack + "{n} leyeron")', () => {
  afterEach(() => {
    cleanup()
  })

  it('retorna null cuando readers es vacío (place unconfigured o sin lectores)', () => {
    const { container } = renderBlock([])
    expect(container).toBeEmptyDOMElement()
  })

  it('renderiza hasta 5 avatares + chip "+N" cuando overflow', () => {
    const readers = Array.from({ length: 8 }).map((_, i) =>
      makeReader({ userId: `u-${i}`, displayName: `User ${i}` }),
    )
    renderBlock(readers)

    const block = screen.getByLabelText('Lectores de la apertura')
    expect(block).toBeInTheDocument()
    // 5 visibles + overflow "+3"
    expect(screen.getAllByTestId('member-avatar')).toHaveLength(5)
    expect(screen.getByText('+3')).toBeInTheDocument()
  })

  it('sin overflow cuando hay ≤5 lectores', () => {
    renderBlock([
      makeReader({ userId: 'u-1', displayName: 'Max' }),
      makeReader({ userId: 'u-2', displayName: 'Lucía' }),
    ])

    expect(screen.getAllByTestId('member-avatar')).toHaveLength(2)
    expect(screen.queryByText(/^\+/)).not.toBeInTheDocument()
  })

  it('label "{n} leyeron" muestra count total (no visible)', () => {
    const readers = Array.from({ length: 10 }).map((_, i) =>
      makeReader({ userId: `u-${i}`, displayName: `User ${i}` }),
    )
    renderBlock(readers)

    expect(screen.getByText('10 leyeron')).toBeInTheDocument()
  })

  it('label en singular cuando count = 1 (acepta plural también — handoff usa "leyeron" para todos)', () => {
    renderBlock([makeReader()])

    expect(screen.getByText('1 leyeron')).toBeInTheDocument()
  })
})
