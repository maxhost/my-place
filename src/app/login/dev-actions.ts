'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { prisma } from '@/db/client'
import { createSupabaseAdmin } from '@/shared/lib/supabase/admin'
import { createSupabaseServer } from '@/shared/lib/supabase/server'
import { clientEnv } from '@/shared/config/env'
import { buildInboxUrl, deriveDisplayName, resolveSafeNext } from '@/app/auth/callback/helpers'

const schema = z.object({
  email: z.string().email(),
  next: z.string().optional(),
})

export type DevSignInResult = { ok: false; error: 'disabled' | 'validation' | 'failed' }

/**
 * Dev-only backdoor: genera un OTP via admin API, lo verifica server-side,
 * setea la sesión (cookies con `domain=<apex>`) y redirige al inbox.
 *
 * Evita el `action_link` implicit flow (tokens en `#hash` que no llegan al server)
 * y salta el mailer (no topea rate limit).
 *
 * Solo activo en `NODE_ENV !== 'production'`.
 */
export async function devSignIn(input: unknown): Promise<DevSignInResult | never> {
  if (process.env.NODE_ENV === 'production') {
    return { ok: false, error: 'disabled' }
  }

  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: 'validation' }
  }

  const { email, next } = parsed.data

  const admin = createSupabaseAdmin()
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })
  const tokenHash = linkData?.properties?.hashed_token
  if (linkError || !tokenHash) {
    return { ok: false, error: 'failed' }
  }

  const supabase = await createSupabaseServer()
  const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: 'magiclink',
  })
  if (verifyError || !verifyData.user) {
    return { ok: false, error: 'failed' }
  }

  const user = verifyData.user
  try {
    const userEmail = user.email ?? null
    await prisma.user.upsert({
      where: { id: user.id },
      create: {
        id: user.id,
        email: userEmail ?? `${user.id}@noemail.place.local`,
        displayName: deriveDisplayName(userEmail, user.user_metadata),
      },
      update: userEmail ? { email: userEmail } : {},
    })
  } catch {
    await supabase.auth.signOut().catch(() => {})
    return { ok: false, error: 'failed' }
  }

  const target = resolveSafeNext(
    next ?? null,
    clientEnv.NEXT_PUBLIC_APP_URL,
    clientEnv.NEXT_PUBLIC_APP_DOMAIN,
  )
  redirect(target || buildInboxUrl(clientEnv.NEXT_PUBLIC_APP_DOMAIN))
}
