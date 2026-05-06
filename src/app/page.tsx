import Link from 'next/link'
import { createSupabaseServer } from '@/shared/lib/supabase/server'
import { buildInboxUrl } from '@/app/auth/callback/helpers'

/**
 * Landing pública (`place.app` en prod, `lvh.me:3000` en dev).
 * Placeholder — el diseño final llega en Fase 8 del roadmap.
 */
export default async function MarketingHomePage() {
  const supabase = await createSupabaseServer()
  const { data } = await supabase.auth.getUser()

  const ctaHref = data.user ? buildInboxUrl().toString() : '/login'
  const ctaLabel = data.user ? 'Ir a tu inbox' : 'Entrar'

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="max-w-xl text-center">
        <h1 className="mb-4 font-serif text-5xl italic">Place</h1>
        <p className="text-muted">Un lugar digital pequeño e íntimo para hasta 150 personas.</p>
        <Link
          href={ctaHref}
          className="mt-8 inline-block rounded-md bg-neutral-900 px-5 py-2 text-white"
        >
          {ctaLabel}
        </Link>
        <p className="mt-8 text-sm text-muted">Landing placeholder · Fase 8 del roadmap</p>
      </div>
    </main>
  )
}
