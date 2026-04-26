import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

// Stub MemberAvatar para no arrastrar el chain de members/server-only env
// al test runtime (mismo patrón que attendee-avatars.test.tsx de events).
vi.mock('@/features/members/public', () => ({
  MemberAvatar: (props: { displayName: string; userId: string; size?: number }) => (
    <span data-testid="member-avatar" data-user={props.userId} data-size={props.size ?? 28}>
      {props.displayName}
    </span>
  ),
}))

import { ReaderStack } from '../ui/reader-stack'

afterEach(() => {
  cleanup()
})

const reader = (i: number) => ({
  userId: `u-${i}`,
  displayName: `Reader ${i}`,
  avatarUrl: null,
})

describe('ReaderStack', () => {
  it('lista vacía no renderiza nada (silencio)', () => {
    const { container } = render(<ReaderStack readers={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renderiza N avatares cuando readers.length <= max (default 4)', () => {
    render(<ReaderStack readers={[reader(1), reader(2), reader(3)]} />)
    expect(screen.getAllByTestId('member-avatar')).toHaveLength(3)
    expect(screen.queryByText(/^\+/)).toBeNull()
  })

  it('overflow: muestra max avatares + chip "+N" cuando readers.length > max', () => {
    const readers = Array.from({ length: 7 }, (_, i) => reader(i))
    render(<ReaderStack readers={readers} max={4} />)
    expect(screen.getAllByTestId('member-avatar')).toHaveLength(4)
    expect(screen.getByText('+3')).toBeInTheDocument()
  })

  it('aria-label refleja count TOTAL (no visible)', () => {
    const readers = Array.from({ length: 10 }, (_, i) => reader(i))
    render(<ReaderStack readers={readers} max={4} />)
    expect(screen.getByLabelText('10 lectores')).toBeInTheDocument()
  })

  it('exactamente max readers: sin chip overflow', () => {
    const readers = Array.from({ length: 4 }, (_, i) => reader(i))
    render(<ReaderStack readers={readers} max={4} />)
    expect(screen.getAllByTestId('member-avatar')).toHaveLength(4)
    expect(screen.queryByText(/^\+/)).toBeNull()
  })

  it('size prop se pasa a MemberAvatar', () => {
    render(<ReaderStack readers={[reader(1)]} size={28} />)
    expect(screen.getByTestId('member-avatar')).toHaveAttribute('data-size', '28')
  })

  it('overlap: el primer avatar NO tiene -ml-1.5; los siguientes sí', () => {
    const { container } = render(<ReaderStack readers={[reader(1), reader(2), reader(3)]} />)
    const wrappers = container.querySelectorAll('.inline-flex')
    // Primer wrapper (idx 0): no tiene -ml-1.5
    expect(wrappers[0]?.className).not.toContain('-ml-1.5')
    // Segundo y tercero: tienen -ml-1.5
    expect(wrappers[1]?.className).toContain('-ml-1.5')
    expect(wrappers[2]?.className).toContain('-ml-1.5')
  })
})
