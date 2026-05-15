# Multi-tenancy: routing por subdomain

Cada place tiene su propia URL con subdomain. La estructura de URLs refuerza la ontología de "lugar" vs "app".

## Estructura de URLs

| URL                            | Qué es                                                                 |
| ------------------------------ | ---------------------------------------------------------------------- |
| `place.app`                    | Landing pública del producto                                           |
| `app.place.app`                | Inbox universal del usuario (DMs, lista de places a los que pertenece) |
| `{slug}.place.app`             | Portada del place con ese slug                                         |
| `{slug}.place.app/{zone}`      | Zona del place (conversations, events, etc)                            |
| `{slug}.place.app/thread/{id}` | Thread individual                                                      |
| `{slug}.place.app/settings`    | Configuración del place (solo admins)                                  |

## Implementación en Next.js

Middleware en `src/app/middleware.ts` inspecciona el hostname en cada request:

- Si el subdomain es `app` → rutea a `/(app)/inbox/...`
- Si el subdomain es cualquier otro → extrae el slug y reescribe la URL a `/(app)/[placeSlug]/...`
- Si es el dominio raíz → rutea a `/(marketing)/...`

Estructura de rutas:

```
src/app/
├── (marketing)/       Para place.app
│   └── page.tsx
├── (app)/             Para todo lo autenticado
│   ├── inbox/         En app.place.app
│   └── [placeSlug]/   En {slug}.place.app
│       ├── page.tsx
│       ├── [zone]/page.tsx
│       ├── thread/[id]/page.tsx
│       └── settings/page.tsx
├── api/              Route handlers (webhooks, cron, etc.) — a definir
└── middleware.ts
```

## DNS y Vercel

- Record wildcard: `*.place.app → CNAME → cname.vercel-dns.com`
- En Vercel: configurar wildcard domain en el proyecto
- SSL automático para todos los subdomains

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
