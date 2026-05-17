# Multi-tenancy: routing por subdomain

Cada place tiene su propia URL con subdomain. La estructura de URLs refuerza la ontología de "lugar" vs "app".

## Estructura de URLs

| URL                            | Qué es                                                                 |
| ------------------------------ | ---------------------------------------------------------------------- |
| `place.community`                    | Landing pública del producto                                           |
| `app.place.community`                | Inbox universal del usuario (DMs, lista de places a los que pertenece) |
| `{slug}.place.community`             | Portada del place con ese slug                                         |
| `{slug}.place.community/{zone}`      | Zona del place (conversations, events, etc)                            |
| `{slug}.place.community/thread/{id}` | Discusión individual                                                   |
| `{slug}.place.community/settings`    | Configuración del place (solo owner)                                   |

> El slug de URL `thread` es **deliberado**: técnico/universal en la ruta, mientras el objeto canónico de producto es **Discusión** (`docs/ontologia/conversaciones.md`). Consistente con "código en inglés, docs/UI en español" (`CLAUDE.md`). Un barrido de consistencia no debe "corregir" esto.

> **Estado (2026-05-16, ADR-0005):** hoy `src/middleware.ts` solo hace i18n de la landing (build de la landing). El routing **host-based** descrito abajo entra en alcance con la tanda de registro: el onboarding del owner vive en el **apex** `place.community` (i18n bajo `[locale]`) y el place creado queda servible en `{slug}.place.community`. El middleware i18n se integra con el host-based (no se duplica).

## Implementación en Next.js

Middleware en `src/middleware.ts` (Next 15; en Next 16 sería `proxy.ts`) inspecciona el hostname en cada request:

- Si el subdomain es `app` → rutea a `/(app)/inbox/...`
- Si el subdomain es cualquier otro → extrae el slug y reescribe la URL a `/(app)/[placeSlug]/...`
- Si es el dominio raíz → rutea a `/(marketing)/...`

Estructura de rutas:

```
src/app/
├── (marketing)/       Para place.community
│   └── page.tsx
├── (app)/             Para todo lo autenticado
│   ├── inbox/         En app.place.community
│   └── [placeSlug]/   En {slug}.place.community
│       ├── page.tsx
│       ├── [zone]/page.tsx
│       ├── thread/[id]/page.tsx
│       └── settings/page.tsx
└── api/              Route handlers (webhooks, cron, etc.) — a definir

src/middleware.ts        # raíz de src, NO src/app/ (Next 15; Next 16 → proxy.ts)
```

> Estado real: hoy `src/middleware.ts` solo hace i18n de la landing y `src/app/[locale]/` tiene la landing. La estructura `(marketing)/(app)` + el routing host-based de arriba son el **target**, se construyen en el batch de registro (ver nota al inicio de esta sección y ADR-0005 §10).

## DNS y Vercel

- Record wildcard: `*.place.community → CNAME → cname.vercel-dns.com`
- En Vercel: configurar wildcard domain en el proyecto
- SSL automático para todos los subdomains

## Dominios propios (custom domains)

Un place puede configurar su propio dominio en vez del subdomain asignado: en vez de `mio.place.community`, servirse en `community.empresa.com`. El subdomain `{slug}.place.community` sigue existiendo siempre como fallback canónico.

- **Routing:** el middleware resuelve el place por hostname. Si el host no es `*.place.community` ni el apex, se busca el place por `place_domain` (ver `data-model.md`); resuelve **solo dominios verificados**; si no matchea, 404.
- **Alta y verificación (vía Vercel Domains API, sin trabajo manual):** el dueño escribe su dominio en la UI del place → el backend lo agrega al proyecto con `POST /v10/projects/{project}/domains` → Vercel devuelve los records DNS + challenge → se muestran en la UI → el dueño los pone en su DNS provider (su único paso manual) → polleamos el estado hasta `verified: true`; Vercel emite el SSL solo. Recién ahí se setea `place_domain.verified_at`. Vercel es la única fuente de verdad de verificación + SSL.
- **OIDC client:** al verificarse el dominio, el backend provisiona su client OIDC confidencial (`place_domain.oauth_client_id`); al archivar el dominio, se revoca.
- **Sesión:** un custom domain no comparte la cookie del apex, pero el miembro igual tiene SSO silencioso vía el flujo OIDC. Login único, sesión local aislada por dominio. Canónico en `docs/architecture.md` § "Sesión y SSO".

## Development local

Los browsers modernos resuelven `*.localhost` automáticamente. Usar:

- `thecompany.localhost:3000` para probar un place
- `app.localhost:3000` para el inbox
- `localhost:3000` para la landing

Alternativa: entradas en `/etc/hosts` si algún browser no resuelve wildcard localhost.

## RLS: aislamiento por place (base) y modelo rol/JWT

Canónico en **ADR-0006** (esta sección es su spec operativa). El aislamiento entre places se enforcea en el **motor** (Postgres RLS), no solo en código de aplicación.

**Predicados base (S1):**

- **`app_user`** — el usuario solo lee/actualiza su propia fila:
  ```sql
  (select auth.user_id()) = app_user.auth_user_id
  ```
- **Tablas con `place_id`** (`membership`, `place_ownership`, `invitation`, y futuras tablas de features) — la fila pertenece a un place que el usuario actual ownea:
  ```sql
  EXISTS (
    SELECT 1 FROM place_ownership po
    JOIN app_user au ON au.id = po.user_id
    WHERE po.place_id = <tabla>.place_id
      AND au.auth_user_id = (select auth.user_id())
  )
  ```
- **`place`** — mismo predicado, referido a `place.id` en lugar de `<tabla>.place_id`.

Owner → CRUD completo solo en su place; places distintos quedan aislados automáticamente. **El acceso de miembros NO está en la base** (es deliberado): se agrega **por-feature, encima de esta base**, según tier/grupo/config de thread/library/eventos — cada feature documenta y agrega sus propias policies. RLS se construye incremental; la base owner entra en S1.

Se expresa en Drizzle con `pgPolicy`/`crudPolicy` + predicados custom (`drizzle-orm/neon`); `auth.user_id()` lee el claim `sub` inyectado.

**Modelo rol/JWT (nombres exactos verificados 2026-05-16, agente de verificación; cierran los "TBD acotado" de ADR-0006):**

- Queries de dominio bajo un **rol Postgres custom NO-admin** (sin `BYPASSRLS`), declarado en el schema con `pgRole('<rol>').existing()`. Las policies se declaran `to`/`for` **ese rol custom**, NO el `authenticatedRole`/`anonymousRole` de la Data API. `neondb_owner` (admin) solo para migraciones `drizzle-kit`, nunca en runtime.
- Token: `await auth.getSession()` → **`session.access_token`** (JWT). Se verifica con `jose` (`createRemoteJWKSet(new URL(NEON_AUTH_JWKS_URL))` + `jwtVerify`); el claim **`sub`** = `neon_auth.user.id`.
- Se **inyectan los claims** en la transacción: `select set_config('request.jwt.claims', <claims-json>, true)` dentro de `db.transaction`; las policies leen **`auth.user_id()`** (canónico para el patrón backend; `auth.uid()` es de la Data API, no se usa). Verificar empíricamente en S1 que `auth.user_id()` existe en el branch.
- Driver = **`neon-serverless` (WebSocket)** — la saga necesita transacción interactiva (`neon-http` no sirve para tx interactivas).
- **No se usa la Data API ni el rol `anonymous`/`anon`** — sin grants a `anon`, sin acceso no-autenticado a la DB. Todo acceso de dominio es autenticado y verificado server-side.
- Riesgo a vigilar en S1: el SDK cachea la sesión en cookie firmada (~300s, `cookies.sessionDataTtl`); validar que el `exp` del JWT no choque con ese cache.
- Toda op de dominio corre tras `ensureAppUser` (guard JIT idempotente, ADR-0006) y desde `queries.ts`/`actions.ts` del feature.

**RLS e invitaciones (diseño cerrado, ADR-0005 §4 + esta sección).** La RLS owner-only sobre `invitation` se aplica desde S1 **sin** romper la aceptación futura:

- El owner crea/lista/revoca invitaciones de su place → permitido por la base owner-only.
- El `invitation.token` es una **capability** de alta entropía. La aceptación NO pasa por la RLS del usuario: va por una **vía privilegiada server-side de un solo propósito** (`SECURITY DEFINER` o rol controlado acotado a esa operación) que valida token (existe, no expiró, no usado), exige que el **email de la cuenta que acepta coincida con `invitation.email`** (estricto, decidido), corre `ensureAppUser`, crea `membership` (respeta máx 150 y `UNIQUE(user_id,place_id)`) y marca `accepted_at` — todo en una tx. La tabla `invitation` nunca queda expuesta a scan por usuarios.
- **Host del link:** `{slug}.place.community/invite/{token}`; si el place tiene custom domain verificado (`place_domain.verified_at IS NOT NULL`), `https://{dominio}/invite/{token}`.
- **Lookup de invitaciones por email (ADR-0008/0009):** "ver si tengo invitaciones a mi email" (vía Acceso → Unirme) se resuelve con un **Server Action privilegiado** que lista invitaciones donde `invitation.email` = el **email verificado** del usuario autenticado. La RLS de `invitation` **sigue owner-only** (no se amplía `SELECT`); el match se valida server-side; requiere email verificado. Es análogo a la vía privilegiada de aceptación (no pasa por el rol del usuario).
- "Join desde directorio" es otro flujo posterior con su propia policy; no se diseña acá. La rama "Unirme" se muestra **deshabilitada/"próximamente"** en la tanda de registro (ADR-0009).

## Slug inmutable

El slug del place es inmutable una vez creado. Si un usuario necesita cambiar el slug de su place, es operación manual por soporte. Razón: los URLs compartidos, los invites enviados, y las referencias externas rompen si el slug cambia.

## Reservados

Subdomains que no pueden ser usados como slug de place:

- `app`, `www`, `api`, `admin`
- `staging`, `dev`, `test`
- Cualquier otro que el producto use para funcionalidad propia

Esta lista vive en código como constante en `shared/config/reserved-slugs.ts` y se valida en el flow de creación.
