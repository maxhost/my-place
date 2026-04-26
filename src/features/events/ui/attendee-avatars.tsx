import { MemberAvatar } from '@/features/members/public'
import type { EventDetailView } from '../domain/types'

/**
 * Stack de avatares de asistentes (GOING + GOING_CONDITIONAL). Render:
 *  - Hasta `max` avatares MemberAvatar con overlap (-ml-1.5) y ring blanco
 *    (border-2 border-surface) para definir el corte.
 *  - Si `attendees.length > max`, un círculo final "+N" con bg-soft.
 *
 * Cada avatar lleva `title=` con el nombre del miembro y, si su RSVP es
 * `GOING_CONDITIONAL` con nota, "displayName · voy si <nota>". Es un
 * tooltip nativo HTML (suficiente para F1; evaluamos tooltip custom en F2).
 *
 * `imageUrl` precede a `initials` por design del Avatar puro — los
 * miembros con foto se ven con foto.
 */
type Attendee = EventDetailView['publicAttendees'][number]

type AttendeeAvatarsProps = {
  attendees: ReadonlyArray<Attendee>
  max?: number
  size?: number
}

export function AttendeeAvatars({
  attendees,
  max = 4,
  size = 22,
}: AttendeeAvatarsProps): React.ReactNode {
  if (attendees.length === 0) return null

  const visible = attendees.slice(0, max)
  const overflow = attendees.length - visible.length

  return (
    <div className="flex items-center" aria-label={`${attendees.length} asistentes`}>
      {visible.map((a, idx) => (
        <span
          key={a.userId}
          className={['inline-flex rounded-full ring-2 ring-surface', idx > 0 ? '-ml-1.5' : '']
            .filter(Boolean)
            .join(' ')}
          title={buildTooltip(a)}
        >
          <MemberAvatar
            userId={a.userId}
            displayName={a.displayName}
            avatarUrl={a.avatarUrl}
            size={size}
          />
        </span>
      ))}
      {overflow > 0 ? (
        <span
          className="-ml-1.5 inline-flex items-center justify-center rounded-full bg-soft text-muted ring-2 ring-surface"
          style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.45)) }}
          aria-label={`y ${overflow} más`}
        >
          +{overflow}
        </span>
      ) : null}
    </div>
  )
}

function buildTooltip(a: Attendee): string {
  if (a.state === 'GOING_CONDITIONAL' && a.note) {
    return `${a.displayName} · voy si ${a.note}`
  }
  return a.displayName
}
