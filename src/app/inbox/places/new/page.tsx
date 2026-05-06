import Link from 'next/link'
import { PlaceCreateForm } from '@/features/places/public'

/**
 * Ruta "crear nuevo place" bajo `app.place.app/places/new`.
 * El middleware rewrite mapea ese URL a `/inbox/places/new` y garantiza sesión.
 */
export default function NewPlacePage() {
  return (
    <main className="mx-auto min-h-screen max-w-xl p-8">
      <div className="mb-6">
        <Link href="/" className="text-sm text-neutral-500 hover:underline">
          ← Volver al inbox
        </Link>
      </div>
      <h1 className="mb-2 font-serif text-3xl italic">Crear un place</h1>
      <p className="mb-6 text-sm text-neutral-600">
        Un lugar digital para hasta 150 personas. Vas a ser el owner y primer admin.
      </p>
      <PlaceCreateForm />
    </main>
  )
}
