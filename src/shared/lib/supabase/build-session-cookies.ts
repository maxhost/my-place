import 'server-only'
import type { CookieToSet } from './cookie-cleanup'

const MAX_CHUNK_SIZE = 3180
const BASE64_PREFIX = 'base64-'

type SupabaseSession = {
  access_token: string
  refresh_token: string
  expires_at?: number
  expires_in?: number
  token_type?: string
}

type SupabaseUser = {
  id: string
  email?: string | null | undefined
  user_metadata?: Record<string, unknown> | undefined
  app_metadata?: Record<string, unknown> | undefined
}

/**
 * Construye las cookies de sesión Supabase manualmente, sin depender del
 * cookies adapter del SDK (`createServerClient` setAll) que no se invoca
 * sincrónicamente en route handlers — es disparado por `onAuthStateChange`
 * listener async que puede no correr antes del return.
 *
 * Replica el formato del SDK (`@supabase/ssr` `cookies.ts`):
 * - name: `sb-<projectRef>-auth-token`
 * - value: `'base64-' + base64url(JSON.stringify(sessionData))`
 * - chunked en chunks de max 3180 chars (URL-encoded length) cuando
 *   excede. Chunk names: `<name>.0`, `<name>.1`, etc.
 *
 * El middleware updateSession lee estas cookies via `combineChunks` del
 * SDK y reconstruye el session object.
 *
 * Ver `node_modules/@supabase/ssr/src/cookies.ts:216-267` para el flow
 * de setItem que esto replica.
 */
export function buildSessionCookies(args: {
  session: SupabaseSession
  user: SupabaseUser
  projectRef: string
  domain?: string | undefined
}): CookieToSet[] {
  const { session, user, projectRef, domain } = args
  const baseName = `sb-${projectRef}-auth-token`

  const sessionData = {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
    expires_in: session.expires_in,
    token_type: session.token_type ?? 'bearer',
    user,
  }

  const json = JSON.stringify(sessionData)
  const value = BASE64_PREFIX + Buffer.from(json, 'utf-8').toString('base64url')

  const cookieOptions = {
    ...(domain ? { domain } : {}),
    path: '/',
    maxAge: session.expires_in ?? 3600,
    secure: true,
    sameSite: 'lax' as const,
  }

  // Chunking: SDK chunkea cuando encodeURIComponent(value).length > MAX_CHUNK_SIZE.
  const encoded = encodeURIComponent(value)
  if (encoded.length <= MAX_CHUNK_SIZE) {
    return [{ name: baseName, value, options: cookieOptions }]
  }

  // Replicar createChunks del SDK respetando boundaries de encoding URI.
  // Algoritmo simplificado: dividir el value RAW en chunks que después de
  // encodeURIComponent caben en MAX_CHUNK_SIZE.
  const chunks: string[] = []
  let remaining = value
  while (remaining.length > 0) {
    let take = Math.min(remaining.length, MAX_CHUNK_SIZE)
    // Reducir hasta que encodeURIComponent del chunk quepa
    while (take > 0 && encodeURIComponent(remaining.slice(0, take)).length > MAX_CHUNK_SIZE) {
      take -= 1
    }
    if (take <= 0) break
    chunks.push(remaining.slice(0, take))
    remaining = remaining.slice(take)
  }

  return chunks.map((chunkValue, i) => ({
    name: `${baseName}.${i}`,
    value: chunkValue,
    options: cookieOptions,
  }))
}

/**
 * Extrae el `projectRef` del URL de Supabase (`https://<projectRef>.supabase.co`).
 */
export function extractProjectRef(supabaseUrl: string): string {
  const url = new URL(supabaseUrl)
  const ref = url.hostname.split('.')[0]
  if (!ref) throw new Error(`No se pudo extraer projectRef de ${supabaseUrl}`)
  return ref
}
