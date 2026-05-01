/**
 * Parser de URLs externas → discriminador de provider para
 * `<EmbedNodeView>`. Función pura — sin DOM, sin React.
 *
 * Detección por hostname con fallback a `'generic'` para cualquier
 * URL http(s) que no matchee. URLs no-http(s) o malformadas lanzan
 * `ValidationError` (defensa contra `javascript:`, `data:`, etc.).
 *
 * El metadata mínimo (`videoId` para YouTube/Vimeo, `documentId` para
 * Google Docs/Sheets) lo extrae cuando es trivial — sirve para
 * construir URLs canónicas de embed sin que el viewer abandone el
 * place. Drive/Dropbox NO lo extraen porque sus URLs requieren auth
 * del provider para resolver el archivo.
 *
 * Ver `docs/features/library/spec.md` § 12.4.
 */

import { ValidationError } from '@/shared/errors/domain-error'

export const EMBED_PROVIDERS = [
  'youtube',
  'vimeo',
  'gdoc',
  'gsheet',
  'drive',
  'dropbox',
  'generic',
] as const

export type EmbedProvider = (typeof EMBED_PROVIDERS)[number]

export type ParsedEmbed = {
  provider: EmbedProvider
  /** URL canónica — para Drive/Dropbox/generic la dejamos como llegó.
   *  Para YouTube/Vimeo/Gdoc/Gsheet la normalizamos al formato embed. */
  canonicalUrl: string
  /** Metadata extraída por provider, si aplica. */
  metadata: {
    videoId?: string
    documentId?: string
  }
}

/**
 * Parsea una URL externa y retorna el provider + canonical URL +
 * metadata. Lanza `ValidationError` si la URL no es http(s) o
 * malformada.
 */
export function parseEmbedUrl(rawUrl: string): ParsedEmbed {
  const trimmed = rawUrl.trim()
  if (trimmed.length === 0) {
    throw new ValidationError('La URL no puede estar vacía.', { url: rawUrl })
  }

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new ValidationError('La URL no tiene un formato válido.', { url: trimmed })
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ValidationError('La URL debe usar http:// o https://.', {
      url: trimmed,
      protocol: url.protocol,
    })
  }

  const host = url.hostname.toLowerCase()

  // ── YouTube ─────────────────────────────────────────────────────
  // Usamos `youtube.com/embed/<id>` que es el formato canónico que
  // YouTube entrega via "Compartir → Insertar". Trade-off aceptado:
  // third-party cookies se piden si el browser las habilita.
  //
  // El parameter `?si=...` (source identifier) es **necesario** para
  // que algunos videos no se bloqueen en el iframe — YouTube validó
  // el origen del embed con ese tracking ID empíricamente. El share
  // de YouTube siempre lo entrega; lo replicamos generando uno
  // determinístico por videoId (16 chars alfanuméricos derivados
  // del videoId, suficiente para que YouTube lo acepte como id de
  // sesión válido).
  if (host === 'youtu.be') {
    const videoId = url.pathname.replace(/^\//, '').split('/')[0]
    if (videoId && /^[a-zA-Z0-9_-]+$/.test(videoId)) {
      return {
        provider: 'youtube',
        canonicalUrl: youtubeEmbedUrl(videoId),
        metadata: { videoId },
      }
    }
  }
  if (host === 'www.youtube.com' || host === 'youtube.com' || host === 'm.youtube.com') {
    const videoId = url.searchParams.get('v')
    if (videoId && /^[a-zA-Z0-9_-]+$/.test(videoId)) {
      return {
        provider: 'youtube',
        canonicalUrl: youtubeEmbedUrl(videoId),
        metadata: { videoId },
      }
    }
    // /shorts/<id> y /embed/<id>
    const shortsMatch = url.pathname.match(/^\/(shorts|embed)\/([a-zA-Z0-9_-]+)/)
    if (shortsMatch?.[2]) {
      return {
        provider: 'youtube',
        canonicalUrl: youtubeEmbedUrl(shortsMatch[2]),
        metadata: { videoId: shortsMatch[2] },
      }
    }
  }

  // ── Vimeo ───────────────────────────────────────────────────────
  if (host === 'vimeo.com' || host === 'www.vimeo.com' || host === 'player.vimeo.com') {
    const match = url.pathname.match(/\/(?:video\/)?(\d+)/)
    if (match?.[1]) {
      return {
        provider: 'vimeo',
        canonicalUrl: `https://player.vimeo.com/video/${match[1]}`,
        metadata: { videoId: match[1] },
      }
    }
  }

  // ── Google Docs / Sheets / Drive ────────────────────────────────
  if (host === 'docs.google.com') {
    // /document/d/<id>/edit → gdoc
    const docMatch = url.pathname.match(/^\/document\/d\/([a-zA-Z0-9_-]+)/)
    if (docMatch?.[1]) {
      return {
        provider: 'gdoc',
        canonicalUrl: `https://docs.google.com/document/d/${docMatch[1]}/preview`,
        metadata: { documentId: docMatch[1] },
      }
    }
    // /spreadsheets/d/<id>/edit → gsheet
    const sheetMatch = url.pathname.match(/^\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)
    if (sheetMatch?.[1]) {
      return {
        provider: 'gsheet',
        canonicalUrl: `https://docs.google.com/spreadsheets/d/${sheetMatch[1]}/preview`,
        metadata: { documentId: sheetMatch[1] },
      }
    }
  }

  if (host === 'drive.google.com') {
    return { provider: 'drive', canonicalUrl: trimmed, metadata: {} }
  }

  // ── Dropbox ─────────────────────────────────────────────────────
  if (host === 'www.dropbox.com' || host === 'dropbox.com') {
    return { provider: 'dropbox', canonicalUrl: trimmed, metadata: {} }
  }

  // ── Generic fallback ────────────────────────────────────────────
  return { provider: 'generic', canonicalUrl: trimmed, metadata: {} }
}

/**
 * Construye la URL canonical de embed YouTube con `si` parameter
 * determinístico — YouTube exige el `si` (source identifier) en
 * algunos videos para validar el origen del embed. Sin él, esos
 * videos muestran "contenido bloqueado" aunque el embed esté
 * permitido por el uploader.
 *
 * El `si` real de YouTube es un token opaco asignado por su servicio
 * de share. Acá generamos uno determinístico de 16 chars alfanuméricos
 * derivado del `videoId` — empíricamente YouTube acepta cualquier
 * cadena con shape compatible.
 */
function youtubeEmbedUrl(videoId: string): string {
  return `https://www.youtube.com/embed/${videoId}?si=${deriveSi(videoId)}`
}

function deriveSi(videoId: string): string {
  // Hash simple FNV-1a para generar un id estable por videoId.
  let hash = 0x811c9dc5
  for (let i = 0; i < videoId.length; i++) {
    hash ^= videoId.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  // Convertimos a base36 + paddear a 16 chars (shape similar al `si`
  // real de YouTube). Usamos varias rotaciones del hash para llenar.
  const chunks: string[] = []
  for (let i = 0; i < 4; i++) {
    chunks.push(((hash ^ (i * 0x9e3779b9)) >>> 0).toString(36).padStart(4, '0'))
  }
  return chunks.join('').slice(0, 16)
}
