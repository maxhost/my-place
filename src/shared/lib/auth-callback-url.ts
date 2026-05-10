import { clientEnv } from '@/shared/config/env'

/**
 * Construye URL absoluta del `/auth/callback?next=...` para flows que usan
 * **PKCE flow** (ej: `signInWithOtp` desde el browser). Esos magic links
 * llegan al callback con `?code=<jwt>` y se intercambian via
 * `exchangeCodeForSession`.
 *
 * NO usar para magic links generados con `auth.admin.generateLink`. Esos
 * usan **implicit flow** (tokens en `#hash` que el server jamás recibe) y
 * van por `inviteCallbackUrl()` + `/auth/invite-callback` (verifyOtp
 * server-side). Ver `docs/gotchas/supabase-magic-link-callback-required.md`.
 *
 * **Side effect requerido:** el `nextPath` que pases acá tiene que estar
 * en `SAFE_NEXT_PATTERNS` de `src/app/auth/callback/helpers.ts`. Sino el
 * callback va a fallback al inbox por security guard.
 *
 * Ver también: `docs/features/auth/spec.md` y
 * `src/app/auth/callback/route.ts`.
 */
export function authCallbackUrlForNext(nextPath: string): string {
  const next = nextPath.startsWith('/') ? nextPath : `/${nextPath}`
  return `${clientEnv.NEXT_PUBLIC_APP_URL}/auth/callback?next=${encodeURIComponent(next)}`
}

/**
 * Construye URL absoluta de `/auth/invite-callback?token_hash=...&type=...&next=...`
 * para invitations + cualquier otro flow que use `auth.admin.generateLink`.
 *
 * **Por qué un callback distinto:** `admin.generateLink` retorna un
 * `action_link` con **implicit flow** — al clickearse, Supabase verifica el
 * token y redirige al `redirect_to` con tokens en `#hash` (fragment). El
 * fragment NUNCA se envía al server (HTTP spec), así que el route handler
 * no puede setear cookies. En lugar de eso, extraemos el `hashed_token`
 * del payload de `generateLink`, lo embebemos en una URL nuestra, y el
 * `/auth/invite-callback` route hace `verifyOtp({ token_hash, type })`
 * server-side para setear la sesión con `domain=<apex>`.
 *
 * **`type` debe matchear el tipo del token:**
 * - `'invite'` cuando el token vino de `generateLink({ type: 'invite' })`
 *   (path 1, user nuevo).
 * - `'magiclink'` cuando vino del fallback `generateLink({ type: 'magiclink' })`
 *   (path 2, user existente).
 *
 * **Side effect requerido:** el `next` debe estar en `SAFE_NEXT_PATTERNS`
 * de `src/app/auth/callback/helpers.ts` (compartido con `/auth/callback`).
 */
export function inviteCallbackUrl(params: {
  tokenHash: string
  type: 'invite' | 'magiclink'
  next: string
}): string {
  const next = params.next.startsWith('/') ? params.next : `/${params.next}`
  const qs = new URLSearchParams({
    token_hash: params.tokenHash,
    type: params.type,
    next,
  })
  return `${clientEnv.NEXT_PUBLIC_APP_URL}/auth/invite-callback?${qs.toString()}`
}
