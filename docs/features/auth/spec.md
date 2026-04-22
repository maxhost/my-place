# Auth — Especificación

> **Alcance:** flujo de autenticación del usuario contra Place. Es infra compartida, no un feature slice. Cubre login, session, logout y sincronización con el `User` local de Prisma. No cubre permisos dentro de un place (eso vive en `places`/`members`).

> **Referencias:** `docs/stack.md` (Supabase Auth como proveedor), `docs/multi-tenancy.md` (routing por subdomain), `docs/data-model.md` (modelo `User`), `CLAUDE.md` (principios no negociables).

## Modelo mental

- **Login es universal, no por place.** Un usuario autenticado es "el mismo usuario" independientemente del subdomain. La membresía es lo contextual (ver `members/spec.md`), no la identidad.
- **Un usuario puede pertenecer a N places simultáneamente.** Su sesión no tiene scope de place. El middleware resuelve, por request, si el usuario puede acceder al host actual consultando `Membership` contra el slug.
- **No hay "cuenta de place":** la cuenta vive en `auth.users` de Supabase y en `User` de Prisma. Los places se listan derivados de las membresías.
- **Magic link es el único método en MVP.** Sin password, sin OAuth. Se agregan en fases posteriores si el producto lo requiere (decisión de producto, no técnica).

## Rutas públicas vs protegidas

| Host               | Ruta                 | Acceso                                        |
| ------------------ | -------------------- | --------------------------------------------- |
| `place.app`        | `/` (landing)        | Anónimo                                       |
| `place.app`        | `/login`             | Anónimo (redirige a inbox si hay sesión)      |
| `place.app`        | `/auth/callback`     | Anónimo (valida el magic link)                |
| `place.app`        | `/logout`            | Requiere sesión                               |
| `app.place.app`    | `/inbox` y hijos     | Requiere sesión (redirige a `/login?next=…`)  |
| `{slug}.place.app` | `/` y hijos          | Requiere sesión + `Membership` activa en slug |
| `{slug}.place.app` | `/invite/accept/...` | Requiere sesión (excepción documentada)       |

Si falta sesión, se redirige a `https://place.app/login?next={original-url-encoded}`. Después del callback, se vuelve a `next` (validado contra allowlist de dominios de la app).

Si hay sesión pero no membresía en el slug, `{slug}.place.app` responde **404** (no 403). La existencia del place no se filtra a outsiders. Esta política es parte del principio de "sin perfil público fuera de places".

## Flujo de login (magic link)

1. Usuario visita `place.app/login`.
2. Form client-side (RHF + Zod) pide email. Validación local: formato.
3. Submit dispara server action `requestMagicLink(email)`:
   - Rate limit: **máx 3 requests por email en 5 minutos** (ver sección rate limiting).
   - Llama `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: ${APP_URL}/auth/callback } })`.
   - El SDK de Supabase envía el email (mailer del proyecto). No se gestiona el template desde el código del MVP.
   - La UI siempre muestra "te enviamos un link a tu email" aunque el email no exista o el rate limit haya saltado. **No se filtra si el email está registrado.**
4. Usuario abre el link → redirige a `place.app/auth/callback?code=...&next=...`.
5. Route handler `GET /auth/callback`:
   - Intercambia el `code` por sesión (`supabase.auth.exchangeCodeForSession`).
   - Inicia **transacción Prisma**: upsert `User` local con `{ id: auth.user.id, email: auth.user.email, displayName: auth.user.user_metadata.full_name ?? auth.user.email.split('@')[0] }`.
   - Si el upsert falla: llama `supabase.auth.signOut()`, log estructurado del error (con `requestId`), y redirige a `/login?error=sync`.
   - Si todo OK: redirige a `next` validado, o a `app.place.app/inbox` por default.
6. Las cookies de sesión se renuevan automáticamente en cada request via el middleware (ver `1.B` del plan).

## Flujo de logout

- Server action `logout()` en `app/logout/actions.ts`.
- Llama `supabase.auth.signOut()`.
- Redirige a `place.app/` (landing). No requiere confirmación UI (el botón de logout es explícito).

## Sincronización `auth.users` ↔ `User` (Prisma)

- El `User` local es la **única fuente de verdad** para relaciones de dominio (membership, ownership, invitations). `auth.users` vive en un schema separado (`auth`) y Prisma no lo toca.
- La sincronización es **unidireccional**: `auth.users` → `User`, sólo en el callback.
- El id es compartido: `User.id = auth.users.id` (ambos `uuid`/string). Esto evita una FK cross-schema y simplifica joins.
- Si el email cambia en `auth.users` (el usuario lo edita en Supabase), **no se propaga automáticamente** al `User` local en MVP. Futuro: webhook de Supabase + resync. Se agenda como gap técnico cuando aparezca el requerimiento.
- Si el `User` local ya existe (sesión previa), el upsert actualiza `email` pero **no** `displayName`, `handle`, ni `avatarUrl` (esos campos los edita el usuario desde la UI de su perfil, no desde auth).

## Decisión: sin FK cross-schema

- No se agrega FK de `Membership.userId` → `auth.users.id`.
- El `User` local actúa como shim. Si un `auth.users` se borra, el `User` local queda huérfano hasta que aparezca un flow de soft-delete (gap técnico agendado en el plan).
- Razón: Prisma no soporta FKs cross-schema fácilmente en Supabase; forzarlo agregaría complejidad operacional sin beneficio claro en MVP.

## Rate limiting

MVP se apoya en los throttles **nativos de Supabase Auth**:

- 60 segundos mínimo entre magic links para el mismo email.
- Rate limit por IP en el endpoint de `signInWithOtp`.
- Ambos configurables en el dashboard (Project Settings → Auth → Rate Limits).

Defensa en profundidad (tabla `AuthRequest` propia con 3 req/email/5min) queda agendada en gaps técnicos (`Rate limiting compartido`). Se agrega antes del lanzamiento público o apenas aparezca abuso detectable en logs.

Los errores devueltos por Supabase cuando excede el throttle (`over_email_send_rate_limit`, código `429`) se mapean a `MagicLinkRateLimitedError` y se logean con requestId. La UI muestra siempre un mensaje genérico "te enviamos un link a tu email" — no se filtra si fue throttled ni si el email existe.

## Errores estructurados

Todos los errores del flow usan subclases de `DomainError` (`src/shared/errors/domain-error.ts`):

| Error                       | Código          | Cuándo                                                    |
| --------------------------- | --------------- | --------------------------------------------------------- |
| `InvalidMagicLinkError`     | `VALIDATION`    | `code` inválido o ya usado en el callback                 |
| `UserSyncError`             | `CONFLICT`      | Upsert del `User` local falló (DB down, constraint, etc.) |
| `MagicLinkRateLimitedError` | `VALIDATION`    | Se excedió 3/email/5min                                   |
| `SessionExpiredError`       | `AUTHORIZATION` | Cookie presente pero inválida/vencida en middleware       |
| `UnauthenticatedError`      | `AUTHORIZATION` | Ruta protegida sin sesión (se traduce a redirect, no 401) |

Cada error genera un **log estructurado** via `src/shared/lib/logger.ts` con: `{ requestId, errorCode, message, context, stack }`. Secretos (tokens, emails) se redactan.

El usuario ve mensajes amigables mapeados desde el `errorCode`, nunca el `message` o `stack` crudo.

## Invariantes

- Toda ruta protegida que reciba una request sin sesión **redirige**, no responde 401. Esto preserva UX: el usuario ve un login, no un JSON.
- El callback es **idempotente**: si se abre el mismo link dos veces, el segundo intento falla con `InvalidMagicLinkError` (Supabase invalida el code al primer uso). La UI lo traduce a "el link ya fue usado, pedí uno nuevo".
- La sesión **no se extiende** vía el middleware más allá de lo que Supabase permite por default (access token 1h, refresh token rotating). Cualquier ajuste de duración se documenta en `docs/decisions/`.
- El `User` local **nunca** se crea fuera del callback de auth. Ninguna otra acción (crear place, aceptar invitación, etc.) crea `User` filas — confían en que el usuario ya pasó por el callback al menos una vez.

## Seguridad

- Cookies de sesión: `HttpOnly`, `Secure` (en prod), `SameSite=Lax`. Configurado en `next.config.ts` (ver `1.E`).
- CSRF: Next 15 + Server Actions valida origin cuando cookies son secure. El middleware no agrega protección adicional en MVP.
- Sin logging de emails crudos en prod (redacción en logger).
- Sin validación de dominio del email (invitaciones a emails de cualquier dominio son aceptadas; un admin puede rechazar por fuera).

## Fuera de scope

- OAuth (Google, Apple, etc.) — pospuesto a fase post-MVP.
- Password-based login — no se soporta.
- 2FA — no se soporta en MVP.
- Recuperación de cuenta por teléfono — no se soporta.
- Impersonación admin — no se soporta. Un admin que necesite ver la cuenta de un user debe operar sobre la DB directamente con auditoría manual.
- Sincronización bidireccional `User` ↔ `auth.users` — gap agendado.
- Borrar cuenta (GDPR user-initiated) — gap agendado (`User.deletedAt` no existe aún).

## Verificación

Una vez implementado (sub-milestones 1.B a 1.E):

1. `curl -I http://app.localhost:3000/inbox` → 307 redirect a `http://localhost:3000/login?next=...` (sin sesión).
2. Visitar `localhost:3000/login`, ingresar email, revisar que llega magic link al Supabase Inbucket (dev) o al email real (cloud dev).
3. Clickear el link → ver que `auth.users` tiene una row (MCP `execute_sql`) y `User` de Prisma también (con mismo `id`).
4. Repetir request de magic link 4 veces en 5 min → cuarta falla silenciosamente (confirmar vía log estructurado, no vía UI).
5. Logout → cookie `sb-*` se borra, redirect a landing, `/inbox` vuelve a redirigir a login.
6. Tests unitarios cubren: upsert User (happy + fallback), validación de `next` param, rate limit store, errores estructurados.
