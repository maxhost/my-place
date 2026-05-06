import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/shared/lib/supabase/server'
import { PlacesList } from '@/features/places/public'
import { listMyPlaces } from '@/features/places/public.server'

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
      <header className="mb-6">
        <h1 className="font-serif text-3xl italic">Inbox</h1>
      </header>
      <PlacesList places={places} />
      {places.length > 0 ? (
        // Pattern canónico "Add another to the list" (docs/ux-patterns.md):
        // dashed-border full-width neutral, después de la lista. Nunca top-right filled.
        <Link
          href="/places/new"
          className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md border border-dashed border-neutral-300 px-4 text-sm font-medium text-neutral-600 hover:border-neutral-500"
        >
          <span aria-hidden>+</span> Nuevo place
        </Link>
      ) : null}
    </main>
  )
}
