import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/shared/lib/supabase/server'
import { clientEnv } from '@/shared/config/env'
import { listMyPlaces, PlacesList } from '@/features/places/public'

/**
 * Inbox universal del usuario. Accedido via `app.place.app` (prod) o `app.lvh.me:3000` (dev).
 * El middleware hace rewrite del hostname a `/inbox/*` y garantiza sesión.
 */
export default async function InboxPage() {
  const supabase = await createSupabaseServer()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) redirect('/login')

  const places = await listMyPlaces(auth.user.id)

  return (
    <main className="mx-auto min-h-screen max-w-2xl p-8">
      <header className="mb-6 flex items-baseline justify-between gap-4">
        <h1 className="font-serif text-3xl italic">Inbox</h1>
        <Link
          href="/places/new"
          className="text-sm text-neutral-600 underline decoration-neutral-300 hover:decoration-neutral-600"
        >
          Nuevo place
        </Link>
      </header>
      <PlacesList places={places} appDomain={clientEnv.NEXT_PUBLIC_APP_DOMAIN} />
    </main>
  )
}
