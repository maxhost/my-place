import 'server-only'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/db/client'
import { createSupabaseAdmin } from '@/shared/lib/supabase/admin'
import { createSupabaseServer } from '@/shared/lib/supabase/server'

/**
 * Endpoint test-only para login programático de Playwright. Hidrata la sesión
 * Supabase (cookies) sin depender del flujo de magic link por email.
 *
 * Gate doble — ambos devuelven 404 para no filtrar existencia:
 *   1. `NODE_ENV === 'production'` → 404 antes de leer body o tocar Supabase.
 *   2. Header `x-test-secret` debe matchear `E2E_TEST_SECRET` exacto.
 *
 * Flow (reutiliza el patrón de `src/app/login/dev-actions.ts`):
 *   admin.generateLink({type:'magiclink', email}) → supabase.auth.verifyOtp(token_hash)
 *   → upsert Prisma User → 200 con Set-Cookie (Supabase setea via cookie store).
 *
 * Consumido por `tests/global-setup.ts` y `tests/helpers/playwright-auth.ts`.
 * Ver docs/plans (C.H) + CLAUDE.md Gotcha sobre `NODE_ENV=test` explícito en CI.
 */

const bodySchema = z.object({ email: z.string().email() })

export async function POST(request: Request): Promise<Response> {
  if (process.env.NODE_ENV === 'production') {
    return new NextResponse(null, { status: 404 })
  }

  const secret = process.env.E2E_TEST_SECRET
  const header = request.headers.get('x-test-secret')
  if (!secret || !header || header !== secret) {
    return new NextResponse(null, { status: 404 })
  }

  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: 'validation' }, { status: 400 })
  }

  const { email } = parsed.data

  const admin = createSupabaseAdmin()
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })
  const tokenHash = linkData?.properties?.hashed_token
  if (linkError || !tokenHash) {
    return NextResponse.json(
      { error: 'generate_link_failed', detail: linkError?.message ?? null },
      { status: 500 },
    )
  }

  const supabase = await createSupabaseServer()
  const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: 'magiclink',
  })
  if (verifyError || !verifyData?.user) {
    return NextResponse.json(
      { error: 'verify_otp_failed', detail: verifyError?.message ?? null },
      { status: 500 },
    )
  }

  const authUser = verifyData.user
  const userEmail = authUser.email ?? email
  const displayName = userEmail.split('@')[0] ?? 'User'
  await prisma.user.upsert({
    where: { id: authUser.id },
    create: { id: authUser.id, email: userEmail, displayName },
    update: { email: userEmail },
  })

  return NextResponse.json({ ok: true, userId: authUser.id })
}
