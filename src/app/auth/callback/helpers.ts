/**
 * Valida `next` para prevenir open-redirect.
 * Acepta sólo paths/URLs dentro del apex de la app (`place.app` o cualquier subdominio).
 */
export function resolveSafeNext(raw: string | null, appUrl: string, appDomain: string): string {
  const fallback = buildInboxUrl(appDomain)
  if (!raw) return fallback
  try {
    const candidate = new URL(raw, appUrl)
    const appHost = new URL(appUrl).host.toLowerCase()
    const domain = appDomain.toLowerCase()
    const host = candidate.host.toLowerCase()
    const sameApex = host === appHost || host === domain || host.endsWith(`.${domain}`)
    if (!sameApex) return fallback
    return candidate.toString()
  } catch {
    return fallback
  }
}

import { protocolFor } from '@/shared/lib/app-url'

export function buildInboxUrl(appDomain: string): string {
  return `${protocolFor(appDomain)}://app.${appDomain}/`
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
