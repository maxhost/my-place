/**
 * Helpers test-only: retroceden `createdAt` en DB para ejercitar invariantes
 * temporales (ej: ventana de 60s de edit) sin esperar reloj real.
 *
 * NO usar en código de aplicación. Estos imports bypassean la action layer.
 * Se usan exclusivamente desde specs Playwright.
 */

import { PrismaClient } from '@prisma/client'

let _prisma: PrismaClient | null = null
function getPrisma(): PrismaClient {
  if (!_prisma) _prisma = new PrismaClient()
  return _prisma
}

export async function backdatePost(postId: string, intervalSqlLiteral: string): Promise<void> {
  // El `intervalSqlLiteral` es un literal SQL aceptado como `INTERVAL` en Postgres.
  // Ej: '2 minutes', '1 hour'. No aceptamos input arbitrario — siempre hardcoded en specs.
  const prisma = getPrisma()
  await prisma.$executeRawUnsafe(
    `UPDATE "Post" SET "createdAt" = "createdAt" - INTERVAL '${intervalSqlLiteral}' WHERE id = $1`,
    postId,
  )
}

export async function backdateComment(
  commentId: string,
  intervalSqlLiteral: string,
): Promise<void> {
  const prisma = getPrisma()
  await prisma.$executeRawUnsafe(
    `UPDATE "Comment" SET "createdAt" = "createdAt" - INTERVAL '${intervalSqlLiteral}' WHERE id = $1`,
    commentId,
  )
}

export async function closePrisma(): Promise<void> {
  if (_prisma) {
    await _prisma.$disconnect()
    _prisma = null
  }
}
