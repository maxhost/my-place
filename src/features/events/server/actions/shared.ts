import 'server-only'
import { revalidatePath } from 'next/cache'

/**
 * Revalida las rutas afectadas por un cambio sobre un evento específico.
 * Mismo patrón que discussions.revalidatePostPaths — Next cachea por path
 * exacto, así que cada ruta del slice debe listarse explícitamente.
 *
 * `postSlug` opcional para revalidar el thread asociado (auto-thread, F.E).
 */
export function revalidateEventPaths(placeSlug: string, eventId?: string, postSlug?: string): void {
  revalidatePath(`/${placeSlug}/events`)
  if (eventId) {
    revalidatePath(`/${placeSlug}/events/${eventId}`)
  }
  if (postSlug) {
    revalidatePath(`/${placeSlug}/conversations/${postSlug}`)
  }
}
