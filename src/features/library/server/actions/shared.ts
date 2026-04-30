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

/**
 * Revalida paths que tocan un item específico: zona biblioteca
 * (Recientes), categoría (listado), item detail, thread cross-zona
 * en /conversations.
 */
export function revalidateLibraryItemPaths(
  placeSlug: string,
  categorySlug: string,
  postSlug: string,
): void {
  revalidatePath(`/${placeSlug}/library`)
  revalidatePath(`/${placeSlug}/library/${categorySlug}`)
  revalidatePath(`/${placeSlug}/library/${categorySlug}/${postSlug}`)
  revalidatePath(`/${placeSlug}/conversations`)
  revalidatePath(`/${placeSlug}/conversations/${postSlug}`)
}

/**
 * Stringify defensivo para diagnóstico — captura functions, symbols,
 * circular refs (caso edge raro de SSR action input). Trunca a `maxLen`
 * para no inundar logs.
 */
export function safeStringify(value: unknown, maxLen = 4000): string {
  try {
    const seen = new WeakSet<object>()
    const out = JSON.stringify(value, (_key, v) => {
      if (typeof v === 'function') return `[Function: ${v.name || 'anonymous'}]`
      if (typeof v === 'symbol') return `[Symbol: ${v.toString()}]`
      if (typeof v === 'object' && v !== null) {
        if (seen.has(v)) return '[Circular]'
        seen.add(v)
      }
      return v
    })
    return out.length > maxLen ? out.slice(0, maxLen) + `…(truncated, total=${out.length})` : out
  } catch (err) {
    return `[stringify-failed: ${err instanceof Error ? err.message : String(err)}]`
  }
}
