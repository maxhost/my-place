/**
 * Reset acotado de contenido E2E: borra Post/Comment/Reaction/Flag/PostRead del
 * place indicado y restaura el post baseline del seed. NO toca users,
 * memberships, ownerships, ni openings.
 *
 * Guard defensivo: si el `placeId` no matchea `/^place_e2e_/` → throw. Evita
 * blast radius accidental sobre places de dev (ej: `the-company`).
 *
 * Se importa desde specs Playwright cuando un flow necesita arrancar con "no
 * posts" o un estado conocido. Idempotente.
 */

import { PrismaClient, type Prisma } from '@prisma/client'
import {
  E2E_BASELINE_POST_SLUG,
  E2E_DISPLAY_NAMES,
  E2E_EMAILS,
  E2E_PLACES,
  E2E_PLACE_ID_PREFIX,
  type E2EPlaceKey,
} from '../fixtures/e2e-data'

let _prisma: PrismaClient | null = null
function getPrisma(): PrismaClient {
  if (!_prisma) _prisma = new PrismaClient()
  return _prisma
}

function assertE2EPlaceId(placeId: string): void {
  if (!placeId.startsWith(E2E_PLACE_ID_PREFIX)) {
    throw new Error(
      `[reset-content] REFUSING to reset non-E2E place "${placeId}". ` +
        `Only place IDs starting with "${E2E_PLACE_ID_PREFIX}" are allowed.`,
    )
  }
}

function baselineBody(text: string): Prisma.InputJsonValue {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  }
}

async function resolveBaselineAuthor(prisma: PrismaClient, placeKey: E2EPlaceKey): Promise<string> {
  const email = placeKey === 'palermo' ? E2E_EMAILS.memberA : E2E_EMAILS.memberB
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } })
  if (!user) throw new Error(`[reset-content] User E2E baseline no encontrado: ${email}`)
  return user.id
}

/**
 * Borra todo contenido dinámico del place y restaura el post baseline.
 * `placeKey` restringe a los slugs conocidos del seed.
 */
export async function resetContent(placeKey: E2EPlaceKey): Promise<void> {
  const placeId = E2E_PLACES[placeKey].id
  assertE2EPlaceId(placeId)
  const prisma = getPrisma()

  await prisma.flag.deleteMany({ where: { placeId } })
  await prisma.reaction.deleteMany({ where: { placeId } })
  await prisma.postRead.deleteMany({ where: { post: { placeId } } })
  await prisma.comment.deleteMany({ where: { placeId } })
  await prisma.post.deleteMany({ where: { placeId } })

  const authorId = await resolveBaselineAuthor(prisma, placeKey)
  const displayName = placeKey === 'palermo' ? E2E_DISPLAY_NAMES.memberA : E2E_DISPLAY_NAMES.memberB
  await prisma.post.create({
    data: {
      placeId,
      authorUserId: authorId,
      authorSnapshot: { displayName, avatarUrl: null },
      title: `Post baseline ${E2E_PLACES[placeKey].name}`,
      slug: E2E_BASELINE_POST_SLUG,
      body: baselineBody(`Baseline post en ${E2E_PLACES[placeKey].name}.`),
    },
  })
}

export async function closeResetPrisma(): Promise<void> {
  if (_prisma) {
    await _prisma.$disconnect()
    _prisma = null
  }
}
