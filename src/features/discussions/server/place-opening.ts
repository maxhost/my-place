import 'server-only'
import { cache } from 'react'
import { Prisma } from '@prisma/client'
import { prisma } from '@/db/client'
import { currentOpeningWindow, findPlaceHours } from '@/features/hours/public'
import type { OpeningHours } from '@/features/hours/public'

/**
 * Sincronizador lazy entre las ventanas horarias declaradas en `Place.openingHours`
 * y la tabla materializada `PlaceOpening`.
 *
 * Se invoca desde:
 *  - `(gated)/layout.tsx` al renderizar — garantiza que cada request dentro del
 *    horario vea una apertura activa.
 *  - `markPostReadAction` — resuelve la apertura actual para atar un `PostRead`.
 *
 * Reglas (spec § 9):
 *  - `scheduled` dentro de ventana + sin apertura activa ⇒ abrir (`source=SCHEDULED`,
 *    `endAt=null`).
 *  - `scheduled` dentro de ventana + apertura activa ⇒ no-op.
 *  - `scheduled` fuera de ventana + apertura activa ⇒ cerrar (`endAt=now`).
 *  - `always_open` ⇒ crear apertura sin `endAt` si no existe; jamás cerrar.
 *    El contrato de lectores sigue vivo aunque `currentOpeningWindow` retorna null
 *    para `always_open` (spec § 9).
 *  - `unconfigured` ⇒ no-op. Sin apertura → no hay lectores hasta que se configure.
 *
 * Idempotencia: el índice parcial `UNIQUE (placeId) WHERE endAt IS NULL` hace
 * imposible tener dos aperturas activas; si hay carrera, el segundo INSERT pega
 * P2002 y lo resolvemos releyendo la activa.
 */
export const findOrCreateCurrentOpening = cache(
  async (
    placeId: string,
    now: Date = new Date(),
  ): Promise<{ id: string; startAt: Date; endAt: Date | null } | null> => {
    const hours = await findPlaceHours(placeId)

    if (hours.kind === 'unconfigured') return null

    if (hours.kind === 'always_open') {
      return upsertAlwaysOpenOpening(placeId, now)
    }

    const window = currentOpeningWindow(hours, now)
    const active = await prisma.placeOpening.findFirst({
      where: { placeId, endAt: null },
      select: { id: true, startAt: true, endAt: true },
    })

    if (window === null) {
      if (active) {
        await closeOpeningSafely(active.id, now)
      }
      return null
    }

    if (active) {
      return active
    }

    return createOpening({
      placeId,
      startAt: window.start,
      source: 'SCHEDULED',
    })
  },
)

async function upsertAlwaysOpenOpening(
  placeId: string,
  now: Date,
): Promise<{ id: string; startAt: Date; endAt: null }> {
  const existing = await prisma.placeOpening.findFirst({
    where: { placeId, endAt: null },
    select: { id: true, startAt: true },
  })
  if (existing) {
    return { ...existing, endAt: null }
  }
  const created = await createOpening({ placeId, startAt: now, source: 'ALWAYS_OPEN' })
  return { id: created.id, startAt: created.startAt, endAt: null }
}

async function createOpening(params: {
  placeId: string
  startAt: Date
  source: 'SCHEDULED' | 'ALWAYS_OPEN' | 'EXCEPTION'
}): Promise<{ id: string; startAt: Date; endAt: null }> {
  try {
    const created = await prisma.placeOpening.create({
      data: {
        placeId: params.placeId,
        startAt: params.startAt,
        source: params.source,
      },
      select: { id: true, startAt: true },
    })
    return { ...created, endAt: null }
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const existing = await prisma.placeOpening.findFirst({
        where: { placeId: params.placeId, endAt: null },
        select: { id: true, startAt: true },
      })
      if (existing) return { ...existing, endAt: null }
    }
    throw err
  }
}

async function closeOpeningSafely(openingId: string, endAt: Date): Promise<void> {
  await prisma.placeOpening.updateMany({
    where: { id: openingId, endAt: null },
    data: { endAt },
  })
}

export type { OpeningHours }
