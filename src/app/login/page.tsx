import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/shared/lib/supabase/server'
import { clientEnv } from '@/shared/config/env'
import { buildInboxUrl } from '@/app/auth/callback/helpers'
import { LoginForm } from './login-form'

export const metadata: Metadata = {
  title: 'Entrar · Place',
}

type SearchParams = Promise<{ next?: string; error?: string }>

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const supabase = await createSupabaseServer()
  const { data } = await supabase.auth.getUser()
  const params = await searchParams

  if (data.user) {
    redirect(params.next ?? buildInboxUrl(clientEnv.NEXT_PUBLIC_APP_DOMAIN))
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-sm">
        <h1 className="mb-2 font-serif text-4xl italic">Entrar</h1>
        <p className="mb-8 text-sm text-place-text-medium">
          Te enviamos un link a tu email. Hacé click y listo.
        </p>
        <LoginForm
          {...(params.next ? { next: params.next } : {})}
          syncError={params.error === 'sync'}
        />
      </div>
    </main>
  )
}
