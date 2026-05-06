/**
 * Parser de URL de YouTube → `{ videoId }`. Solo videos (no shorts /
 * playlists / channels). Acepta:
 *  - https://www.youtube.com/watch?v=<id>[&...]
 *  - https://youtu.be/<id>[?...]
 *  - https://m.youtube.com/watch?v=<id>
 *
 * Retorna `null` si no matchea — el caller decide si renderizar como link
 * plano o ignorar el paste. Sin throw: `parseUrl` es total.
 */

const YT_VIDEO_ID = /^[a-zA-Z0-9_-]{11}$/

export type ParsedYoutube = { videoId: string }

export function parseYoutubeUrl(input: string): ParsedYoutube | null {
  const trimmed = input.trim()
  if (trimmed.length === 0) return null
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null

  const host = url.hostname.toLowerCase()

  if (host === 'youtu.be') {
    const id = url.pathname.slice(1) // strip leading "/"
    return YT_VIDEO_ID.test(id) ? { videoId: id } : null
  }

  if (host === 'www.youtube.com' || host === 'youtube.com' || host === 'm.youtube.com') {
    if (url.pathname !== '/watch') return null
    const v = url.searchParams.get('v')
    if (!v) return null
    return YT_VIDEO_ID.test(v) ? { videoId: v } : null
  }

  return null
}
