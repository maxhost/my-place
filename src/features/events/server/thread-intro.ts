import 'server-only'
import type { Prisma } from '@prisma/client'

/**
 * Construye el cuerpo TipTap inicial del thread asociado a un evento.
 *
 * F1: cuerpo mínimo "Conversación del evento [title]" + heading. Si hay
 * `description` del evento, NO se duplica acá (queda en el detalle del
 * evento; el thread es para conversación, no para repetir el invitation).
 * F.E puede enriquecer agregando un callout linkeando al detalle del
 * evento si producto lo pide.
 *
 * Ver `docs/features/events/spec-integrations.md § 1.4`.
 */
export function buildEventThreadIntroBody(event: {
  id: string
  title: string
}): Prisma.InputJsonValue {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: `Conversación del evento "${event.title}". Acá coordinamos lo que haga falta.`,
          },
        ],
      },
    ],
  }
}
