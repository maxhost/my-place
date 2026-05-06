/**
 * Parser de URL de Spotify → `{ kind, externalId }`. Soporta los 5 tipos
 * con player oficial: track, episode, show, playlist, album. Acepta el
 * prefijo de locale opcional (`/intl-es/`, `/intl-en/`, etc.) que Spotify
 * inyecta cuando estás logueado.
 */

const SPOTIFY_KINDS = ['track', 'episode', 'show', 'playlist', 'album'] as const
type SpotifyKind = (typeof SPOTIFY_KINDS)[number]

const SPOTIFY_ID = /^[a-zA-Z0-9]+$/

export type ParsedSpotify = { kind: SpotifyKind; externalId: string }

export function parseSpotifyUrl(input: string): ParsedSpotify | null {
  const trimmed = input.trim()
  if (trimmed.length === 0) return null
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (url.hostname.toLowerCase() !== 'open.spotify.com') return null

  // El path puede ser `/track/<id>` o `/intl-<locale>/track/<id>`.
  const segments = url.pathname.split('/').filter((s) => s.length > 0)
  // Si el primero es un prefijo `intl-...`, lo descartamos.
  const startIdx = segments[0]?.startsWith('intl-') ? 1 : 0
  const kindRaw = segments[startIdx]
  const idRaw = segments[startIdx + 1]
  if (!kindRaw || !idRaw) return null
  if (!SPOTIFY_KINDS.includes(kindRaw as SpotifyKind)) return null
  if (!SPOTIFY_ID.test(idRaw)) return null

  return { kind: kindRaw as SpotifyKind, externalId: idRaw }
}
