/**
 * Parser de URL de Apple Podcasts → `{ region, showSlug, showId, episodeId? }`.
 *
 * Pattern oficial:
 *   `podcasts.apple.com/<region>/podcast/<showSlug>/id<showId>[?i=<episodeId>]`
 *
 * `region` = código ISO 2-letter (us, ar, es, mx, etc.). El embed de Apple
 * conserva el region path en la URL del iframe — re-derivar el region
 * default (`us`) rompe en algunos episodios geo-restringidos.
 */

const REGION = /^[a-z]{2}$/
const SHOW_ID = /^id(\d+)$/

export type ParsedApplePodcast = {
  region: string
  showSlug: string
  showId: string
  episodeId?: string | undefined
}

export function parseApplePodcastUrl(input: string): ParsedApplePodcast | null {
  const trimmed = input.trim()
  if (trimmed.length === 0) return null
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (url.hostname.toLowerCase() !== 'podcasts.apple.com') return null

  const segments = url.pathname.split('/').filter((s) => s.length > 0)
  // [region, "podcast", slug, "id<digits>"]
  if (segments.length !== 4) return null
  const [region, podcastLit, showSlug, idSeg] = segments
  if (!region || !showSlug || !idSeg) return null
  if (!REGION.test(region)) return null
  if (podcastLit !== 'podcast') return null
  const idMatch = idSeg.match(SHOW_ID)
  if (!idMatch || !idMatch[1]) return null

  const epi = url.searchParams.get('i')
  return {
    region,
    showSlug,
    showId: idMatch[1],
    episodeId: epi && /^\d+$/.test(epi) ? epi : undefined,
  }
}
