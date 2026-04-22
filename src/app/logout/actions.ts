'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/shared/lib/supabase/server'
import { createRequestLogger, REQUEST_ID_HEADER } from '@/shared/lib/request-id'
import { clientEnv } from '@/shared/config/env'
import { protocolFor } from '@/shared/lib/app-url'

export async function logout(): Promise<void> {
  const headerStore = await headers()
  const log = createRequestLogger(headerStore.get(REQUEST_ID_HEADER) ?? 'unknown')

  const supabase = await createSupabaseServer()
  const { error } = await supabase.auth.signOut()
  if (error) {
    log.warn({ err: error }, 'logout_failed')
  } else {
    log.info({}, 'logout_success')
  }

  const domain = clientEnv.NEXT_PUBLIC_APP_DOMAIN
  redirect(`${protocolFor(domain)}://${domain}/`)
}
