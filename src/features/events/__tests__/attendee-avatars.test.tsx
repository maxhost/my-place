import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('next/image', () => ({
  default: (props: { src: string; alt: string; width: number; height: number }) => {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...props} />
  },
}))

// Mockear el barrel `members/public` evita arrastrar server-only chains
// (env, prisma, server actions) al test runner. Acá sólo necesitamos que
// MemberAvatar render algo identificable por displayName.
vi.mock('@/features/members/public', () => ({
  MemberAvatar: (props: { displayName: string; userId: string }) => (
    <span data-testid="member-avatar" data-user={props.userId}>
      {props.displayName}
    </span>
  ),
}))

import { AttendeeAvatars } from '../ui/attendee-avatars'

afterEach(() => {
  cleanup()
})

const baseAttendee = (i: number, overrides: Record<string, unknown> = {}) => ({
  userId: `user-${i}`,
  state: 'GOING' as const,
  note: null as string | null,
  displayName: `Member ${i}`,
  avatarUrl: null as string | null,
  ...overrides,
})

describe('AttendeeAvatars', () => {
  it('lista vacía no renderiza nada', () => {
    const { container } = render(<AttendeeAvatars attendees={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('overflow: muestra max + "+N" cuando hay más', () => {
    const attendees = Array.from({ length: 7 }, (_, i) => baseAttendee(i))
    render(<AttendeeAvatars attendees={attendees} max={4} />)
    expect(screen.getByLabelText('y 3 más')).toBeInTheDocument()
    expect(screen.getByText('+3')).toBeInTheDocument()
  })

  it('sin overflow cuando attendees ≤ max', () => {
    const attendees = Array.from({ length: 3 }, (_, i) => baseAttendee(i))
    render(<AttendeeAvatars attendees={attendees} max={4} />)
    expect(screen.queryByLabelText(/más/)).toBeNull()
  })

  it('tooltip incluye nota cuando GOING_CONDITIONAL + note', () => {
    const attendees = [
      baseAttendee(1, { state: 'GOING_CONDITIONAL', note: 'salgo del trabajo a las 8' }),
    ]
    const { container } = render(<AttendeeAvatars attendees={attendees} />)
    const wrapper = container.querySelector('[title]') as HTMLElement
    expect(wrapper.title).toBe('Member 1 · voy si salgo del trabajo a las 8')
  })

  it('tooltip es solo displayName cuando GOING (sin nota)', () => {
    const attendees = [baseAttendee(1, { state: 'GOING', note: 'algo' })]
    const { container } = render(<AttendeeAvatars attendees={attendees} />)
    const wrapper = container.querySelector('[title]') as HTMLElement
    expect(wrapper.title).toBe('Member 1')
  })

  it('aria-label refleja count total (no visibles)', () => {
    const attendees = Array.from({ length: 10 }, (_, i) => baseAttendee(i))
    render(<AttendeeAvatars attendees={attendees} max={4} />)
    expect(screen.getByLabelText('10 asistentes')).toBeInTheDocument()
  })
})
