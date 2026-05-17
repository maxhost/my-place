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

**Modelo POR-OPERACIÓN (S1, ADR-0010 — refina ADR-0006 §2).** Las policies se declaran por operación, no una sola para todo. Esto disuelve el falso "huevo y gallina" al crear un place (la fila de ownership aún no existe en ese instante).

- **`app_user` (todas):** solo la propia fila →
  ```sql
  (select auth.user_id()) = app_user.auth_user_id
  ```
- **`place` / `membership` / `place_ownership` — INSERT:** cualquier usuario **autenticado**, con `WITH CHECK` que garantiza que **solo se inserta a sí mismo** (su `app_user`) como owner/miembro del place que crea — no a nombre de otro ni en place ajeno. Crear el place propio no toca filas ajenas → sin función privilegiada.
- **`place` / `membership` / `place_ownership` — SELECT/UPDATE/DELETE:** solo el **owner** del place →
  ```sql
  EXISTS (
    SELECT 1 FROM place_ownership po
    JOIN app_user au ON au.id = po.user_id
    WHERE po.place_id = <tabla>.place_id   -- para `place`: po.place_id = place.id
      AND au.auth_user_id = (select auth.user_id())
  )
  ```
- **`invitation` (todas las operaciones): 100% owner-only** (mismo predicado). Sin policy por email, sin verified-email. La aceptación NO pasa por la RLS del usuario (ver "RLS e invitaciones").

Owner → CRUD completo solo en su place; cualquier autenticado puede **crear** su place; places distintos aislados. **El acceso de miembros NO está en la base** (deliberado): se agrega **por-feature, encima**, según tier/grupo/config. RLS incremental; la base entra en S1.

Se expresa en Drizzle con `pgPolicy`/`crudPolicy` + predicados custom (`drizzle-orm/neon`); `auth.user_id()` lee el claim `sub` inyectado.

**Modelo rol/JWT (nombres exactos verificados 2026-05-16, agente de verificación; cierran los "TBD acotado" de ADR-0006):**

- Queries de dominio bajo un **rol Postgres custom NO-admin** (sin `BYPASSRLS`), declarado en el schema con `pgRole('<rol>').existing()`. Las policies se declaran `to`/`for` **ese rol custom**, NO el `authenticatedRole`/`anonymousRole` de la Data API. `neondb_owner` (admin) solo para migraciones `drizzle-kit`, nunca en runtime.
- Token: `await auth.getSession()` → **`session.access_token`** (JWT). Se verifica con `jose` (`createRemoteJWKSet(new URL(NEON_AUTH_JWKS_URL))` + `jwtVerify`); el claim **`sub`** = `neon_auth.user.id`.
- Se **inyectan los claims** en la transacción: `select set_config('request.jwt.claims', <claims-json>, true)` dentro de `db.transaction`; las policies leen **`auth.user_id()`** (canónico para el patrón backend; `auth.uid()` es de la Data API, no se usa). Verificar empíricamente en S1 que `auth.user_id()` existe en el branch.
- Driver = **`neon-serverless` (WebSocket)** — la saga necesita transacción interactiva (`neon-http` no sirve para tx interactivas).
- **No se usa la Data API ni el rol `anonymous`/`anon`** — sin grants a `anon`, sin acceso no-autenticado a la DB. Todo acceso de dominio es autenticado y verificado server-side.
- Riesgo a vigilar en S1: el SDK cachea la sesión en cookie firmada (~300s, `cookies.sessionDataTtl`); validar que el `exp` del JWT no choque con ese cache.
- Toda op de dominio corre tras `ensureAppUser` (guard JIT idempotente, ADR-0006) y desde `queries.ts`/`actions.ts` del feature.

**RLS e invitaciones (diseño cerrado, ADR-0010 — supersede ADR-0009 §1).** `invitation` es **100% owner-only** en RLS. La invitación se accede y acepta **únicamente por su token-link**; el `invitation.token` (alta entropía, un solo uso) **es** la autorización. **No** hay acceso por email, **no** se requiere email verificado, **no** existe "listar mis invitaciones".

- El owner crea/lista/revoca invitaciones de su place → permitido por la base owner-only.
- Un secreto (token) **no** se expresa como regla RLS de identidad → la validación/aceptación va por una **función de confianza** `SECURITY DEFINER` (`EXECUTE` solo para `app_system`), porque la fila `invitation` es del owner:
  1. **Display (solo-lectura):** valida token (existe / no vencido / no usado). Inválido → error amable, **nada en la DB**.
  2. **Aceptar → form de cuenta → Crear:** en **una tx atómica**: `ensureAppUser` → crea `membership` → invalida la invitación (`accepted_at` NULL→now() con **test-and-set**: `UPDATE … WHERE accepted_at IS NULL RETURNING` — token de un solo uso, resuelve carrera). `UNIQUE(user_id,place_id)` respalda contra doble membership. Re-validar token al mostrar **y** al crear.
- **Email match:** el email de la cuenta creada DEBE ser `invitation.email` (estricto, ADR-0008) — prefijado/bloqueado en el form (detalle de la UI de aceptación, diferida).
- **Host del link:** `{slug}.place.community/invite/{token}`; si el place tiene custom domain verificado (`place_domain.verified_at IS NOT NULL`), `https://{dominio}/invite/{token}`.
- La tabla `invitation` nunca queda expuesta a scan por usuarios; el invitado nunca hace `SELECT`/`UPDATE` directo sobre `invitation` bajo su rol.
- **"Unirme" (vía Acceso, ADR-0008/0010):** ya **no** lista invitaciones por email (eliminado). Tras el signup account-first: "Crear mi place" (funcional) y "Unirme" = solo **directorio** (no existe) → **deshabilitado/"próximamente"**. Las invitaciones se entran por el link del email, no desde el menú "Acceso".

## Slug inmutable

El slug del place es inmutable una vez creado. Si un usuario necesita cambiar el slug de su place, es operación manual por soporte. Razón: los URLs compartidos, los invites enviados, y las referencias externas rompen si el slug cambia.

## Reservados

Subdomains que no pueden ser usados como slug de place:

- `app`, `www`, `api`, `admin`
- `staging`, `dev`, `test`
- Cualquier otro que el producto use para funcionalidad propia

Esta lista vive en código como constante en `shared/config/reserved-slugs.ts` y se valida en el flow de creación.
