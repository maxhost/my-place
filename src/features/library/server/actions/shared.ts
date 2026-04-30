import 'server-only'
import { revalidatePath } from 'next/cache'

/**
 * Revalida las rutas afectadas por un cambio sobre una categoría o
 * item. Mismo patrón que `events/server/actions/shared.ts`.
 *
 * Next cachea por path exacto, así que cada bucket
 * (`/library`, `/library/[slug]`, `/settings/library`) debe listarse
 * explícitamente.
 */
export function revalidateLibraryCategoryPaths(placeSlug: string, categorySlug?: string): void {
  revalidatePath(`/${placeSlug}/library`)
  revalidatePath(`/${placeSlug}/settings/library`)
  if (categorySlug) {
    revalidatePath(`/${placeSlug}/library/${categorySlug}`)
  }
}
