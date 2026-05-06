import { logger } from '@/shared/lib/logger'
import { inboxUrl } from '@/shared/lib/app-url'

/**
 * Allowlist de paths a los que el callback puede redirigir post-login.
 *
 * Cerrado por default: cualquier path desconocido cae al fallback (inbox).
 * Defensa en profundidad contra:
 *   (a) open redirect — el origin check ya cubre dominios externos, pero
 *       este filtro actúa como segunda capa.
 *   (b) paths que rendean 404 conocidos (ej: `/not-found`) que llegan vía
 *       `?next=...` por bugs de clients viejos o por construcción manual.
 *   (c) URLs stale que algún cliente aún manda y que ya no tienen handler.
 *
 * Nota sobre slugs de place: aceptamos `/{slug}/...` SOLO si el subpath
 * corresponde a una zona conocida (`conversations`, `library`, `events`,
 * `m/<userId>`, `settings`). El slug pelado (`/the-company`) NO se acepta
 * porque no podemos distinguir un slug de place válido de un path 404 sin
 * golpear DB. Si un día queremos aceptar la home del place vía `?next=`,
 * agregamos pattern explícito + denylist de paths reservados.
 */
const SAFE_NEXT_PATTERNS: readonly RegExp[] = [
  /^\/inbox(\/|$)/,
  /^\/[a-z0-9-]+\/(conversations|library|events|m\/[a-z0-9-]+|settings)(\/|$)/,
  /^\/login$/, // edge: re-login sin loop infinito
  /^\/auth\/callback$/, // edge: bouncing intencional
] as const

const log = logger.child({ scope: 'auth/callback' })

/**
 * Devuelve `URL` segura para redirect post-login.
 *
 * - Si `rawNext` es null/empty → fallback.
 * - Si parsear falla → fallback + warn.
 * - Si origin distinto al fallback → fallback + warn (open-redirect guard).
 * - Si pathname NO matchea la allowlist → fallback + warn (defensive).
 * - Sino → URL parseada.
 */
export function resolveSafeNext(rawNext: string | null, fallback: URL): URL {
  if (!rawNext) return fallback

  let candidate: URL
  try {
    candidate = new URL(rawNext, fallback)
  } catch {
    log.warn({ rawNext }, 'callback_unsafe_next_invalid_url')
    return fallback
  }

  if (candidate.origin !== fallback.origin) {
    log.warn(
      {
        rawNext,
        candidateOrigin: candidate.origin,
        fallbackOrigin: fallback.origin,
      },
      'callback_unsafe_next_cross_origin',
    )
    return fallback
  }

  if (!SAFE_NEXT_PATTERNS.some((re) => re.test(candidate.pathname))) {
    log.warn({ rawNext, pathname: candidate.pathname }, 'callback_unsafe_next_unknown_path')
    return fallback
  }

  return candidate
}

/**
 * URL del inbox del apex de la app, derivada del helper canónico.
 * Mantenida como named export por compat con consumers existentes
 * (`page.tsx`, `login/page.tsx`, `dev-actions.ts`, `route.ts`).
 */
export function buildInboxUrl(): URL {
  return inboxUrl('/')
}

export function deriveDisplayName(
  email: string | null,
  metadata: Record<string, unknown> | undefined,
): string {
  const meta = metadata ?? {}
  const fullName = typeof meta.full_name === 'string' ? meta.full_name.trim() : ''
  if (fullName) return fullName
  if (email) return email.split('@')[0] ?? 'Miembro'
  return 'Miembro'
}
