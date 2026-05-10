import { isReservedSlug } from '@/shared/config/reserved-slugs'

/**
 * Resolución de un hostname contra el dominio de la app.
 * Ver `docs/multi-tenancy.md`.
 */
export type HostResolution =
  | { kind: 'marketing' } // place.app → landing pública
  | { kind: 'inbox' } // app.place.app → inbox universal
  | { kind: 'place'; slug: string } // {slug}.place.app → portada del place
  | { kind: 'reserved'; slug: string } // subdomain reservado no ruteable a un place

/**
 * Resuelve el tipo de ruta según el hostname.
 *
 * @param hostname  ej. "thecompany.lvh.me:3000" o "app.place.app"
 * @param appDomain ej. "lvh.me:3000" o "place.app"
 */
export function resolveHost(hostname: string, appDomain: string): HostResolution {
  const normalized = hostname.toLowerCase().trim()
  const domain = appDomain.toLowerCase().trim()

  if (normalized === domain) {
    return { kind: 'marketing' }
  }

  const suffix = `.${domain}`
  if (!normalized.endsWith(suffix)) {
    // Hostname no reconocido (ej. algún proxy). Tratarlo como marketing como fallback seguro.
    return { kind: 'marketing' }
  }

  const subdomain = normalized.slice(0, -suffix.length)

  // Soporte de subdominios anidados (raro pero posible): tomamos el primer segmento desde el final.
  const firstSegment = subdomain.split('.').at(-1) ?? subdomain

  // `www.<apex>` se trata como alias del apex (marketing). Vercel y muchos
  // CDNs hacen redirect automático apex → www cuando ambos están registrados;
  // sin este alias, el redirect mata flows que apuntan a apex (callbacks de
  // auth, accept page de invites, etc.) porque caerían en `reserved` →
  // `/not-found`. Ver ADR `2026-05-10-auth-callbacks-on-apex.md` y
  // `docs/multi-tenancy.md`.
  if (firstSegment === 'www') {
    return { kind: 'marketing' }
  }

  if (firstSegment === 'app') {
    return { kind: 'inbox' }
  }

  if (isReservedSlug(firstSegment)) {
    return { kind: 'reserved', slug: firstSegment }
  }

  return { kind: 'place', slug: firstSegment }
}
