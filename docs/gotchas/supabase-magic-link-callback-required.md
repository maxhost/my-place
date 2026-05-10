# Magic links de Supabase Admin: implicit flow → no llegan al server

`supabase.auth.admin.generateLink({ type: 'invite' | 'magiclink', options: { redirectTo } })` retorna un `action_link` (`https://<proj>.supabase.co/auth/v1/verify?token=…&type=…&redirect_to=…`). Cuando el user lo clickea, Supabase verifica el token y redirige al `redirect_to` con los tokens en **`#hash` fragment** (implicit flow), NO en `?code=` query.

El fragment **nunca se envía al server** (HTTP spec). Si el `redirect_to` apunta a un Route Handler (ej: `/auth/callback`), `req.url.searchParams` no ve los tokens y el handler no puede setear cookies de sesión.

> **Distinto a `signInWithOtp`**: ese flow lo inicia un client `@supabase/ssr` con PKCE habilitado por default → el verify endpoint redirige con `?code=` en query → `/auth/callback` (PKCE flow) lo intercambia con `exchangeCodeForSession`. Ese path funciona. Solo se rompe en magic links generados por `admin.generateLink`.

## Síntoma del bug (reportado en producción 2026-05-09)

1. User clickea link del email de invitación → Supabase verify → redirige a `/auth/callback?next=/invite/accept/<tok>` SIN `?code=`.
2. `/auth/callback` ve `searchParams.get('code') === null` → loguea `callback_missing_code` → 307 a `/login?error=invalid_link`.
3. User cae en el form de login y tiene que tipear su email para recibir un SEGUNDO magic link (este sí PKCE → funciona).
4. Friction inaceptable + UX rota del onboarding.

Diagnóstico inicial (commit `2d5546c` del 2026-05-09): se intentó pasar por `/auth/callback` vía helper `authCallbackUrlForNext`. **No funciona** porque el problema no es la URL del callback — es el flow type (implicit vs PKCE). Confirmación: `dev-actions.ts` ya tenía un comentario explícito al respecto.

## Fix canónico (Approach C, 2026-05-10)

Saltarse el `action_link` de Supabase. Extraer `hashed_token` + `verification_type` del payload de `generateLink` y servirlo nosotros desde un route handler dedicado que hace `verifyOtp` server-side.

**Flujo:**

1. Server action llama `generateInviteMagicLink({ email })` → retorna `{ url, hashedToken, type, isNewAuthUser }`.
2. Construye `inviteUrl = inviteCallbackUrl({ tokenHash, type, next })` (helper en `src/shared/lib/auth-callback-url.ts`).
3. Email contiene esa URL: `https://app.place.community/auth/invite-callback?token_hash=…&type=invite|magiclink&next=/invite/accept/<token>`.
4. User clickea → llega a nuestro Route Handler `src/app/auth/invite-callback/route.ts`.
5. Handler: `supabase.auth.verifyOtp({ token_hash, type })` server-side → setea cookies sobre el `NextResponse` con `domain=<apex>` (cross-subdomain).
6. Upsert `User` local + redirect a `next` validado contra `SAFE_NEXT_PATTERNS`.

```ts
// 1. server action
import { inviteCallbackUrl } from '@/shared/lib/auth-callback-url'
import { generateInviteMagicLink } from '@/shared/lib/supabase/admin-links'

const link = await generateInviteMagicLink({ email })
const inviteUrl = inviteCallbackUrl({
  tokenHash: link.hashedToken,
  type: link.type,
  next: `/invite/accept/${invitationToken}`,
})
await mailer.sendInvitation({ to: email, inviteUrl, ... })
```

## Por qué un callback distinto del PKCE

| Path                    | Origen del link               | Flow     | Token en URL                | Handler                           |
| ----------------------- | ----------------------------- | -------- | --------------------------- | --------------------------------- |
| `/auth/callback`        | `signInWithOtp` (browser)     | PKCE     | `?code=<jwt>`               | `exchangeCodeForSession(code)`    |
| `/auth/invite-callback` | `admin.generateLink` (server) | OTP hash | `?token_hash=<hash>&type=…` | `verifyOtp({ token_hash, type })` |

Mantener separados evita branching frágil dentro de un solo handler y deja claro qué origen se está cubriendo.

## Side effect requerido: actualizar `SAFE_NEXT_PATTERNS`

Ambos callbacks comparten el allowlist (`src/app/auth/callback/helpers.ts`). Cuando se introduce un nuevo path destino, sumarlo al patrón. Hoy cubre `/invite/accept/<token>` con `[A-Za-z0-9_-]+` (token base64url-safe).

## Backward compat

Invitations enviadas ANTES del fix tienen el `action_link` viejo de Supabase como `inviteUrl` (implicit flow). Los users que las clickean siguen cayendo en `/login`. Workarounds:

- Admin clickea "Reenviar invitación" en `/settings/access` → genera nuevo link con la URL nueva.
- Si la invitación está cerca de expirar, esperar a que expire y reinvitar.

No hay fix automático para emails ya enviados.

## Tests que cubren el fix

- `src/app/auth/invite-callback/__tests__/route.test.ts` — happy paths (invite + magiclink), missing/invalid token_hash, type inválido, verifyOtp falla, next inválido cae a fallback, upsert falla → signOut + sync error.
- `src/shared/lib/__tests__/auth-callback-url.test.ts` — `inviteCallbackUrl` encoding seguro contra injection (`?` en next, `+/=` en token).
- `src/shared/lib/supabase/admin-links.test.ts` — return ahora incluye `hashedToken` + `type`; falla si Supabase no devuelve `hashed_token`.
- `src/features/members/{__tests__,invitations/__tests__}/{invite-member,resend-invitation}.test.ts` × 4 — assert que `inviteUrl` apunta a `/auth/invite-callback?...` y NO al `action_link` de Supabase.

## Aplicabilidad a futuros flows

Cualquier server action que use `auth.admin.generateLink` y necesite que el user llegue logueado al destino debe:

1. Llamar `generateInviteMagicLink({ email })` (sin `redirectTo`).
2. Construir la URL del email con `inviteCallbackUrl({ tokenHash, type, next })`.

NO usar `authCallbackUrlForNext` para esos flows — ese helper sigue válido únicamente para magic links de PKCE flow (ej: `signInWithOtp` futuro con destino custom).

NO importar `clientEnv.NEXT_PUBLIC_APP_URL` directo para construir URLs de magic link redirect. Siempre via helper.
