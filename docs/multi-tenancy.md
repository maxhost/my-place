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

## Implementación en Next.js

Middleware en `src/app/middleware.ts` inspecciona el hostname en cada request:

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
├── api/              Route handlers (webhooks, cron, etc.) — a definir
└── middleware.ts
```

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

## Slug inmutable

El slug del place es inmutable una vez creado. Si un usuario necesita cambiar el slug de su place, es operación manual por soporte. Razón: los URLs compartidos, los invites enviados, y las referencias externas rompen si el slug cambia.

## Reservados

Subdomains que no pueden ser usados como slug de place:

- `app`, `www`, `api`, `admin`
- `staging`, `dev`, `test`
- Cualquier otro que el producto use para funcionalidad propia

Esta lista vive en código como constante en `shared/config/reserved-slugs.ts` y se valida en el flow de creación.
