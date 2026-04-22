# Stack técnico

Elecciones tecnológicas de Place y justificación de cada una. Cualquier cambio de stack se registra acá antes de implementarse.

## Piezas

| Pieza          | Elección                                        | Razón                                                                                                                                                                                                                                       |
| -------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework      | Next.js 15 con App Router                       | Multi-tenant nativo con middleware, Server Components, Server Actions, integración directa con Vercel                                                                                                                                       |
| Lenguaje       | TypeScript strict mode                          | Seguridad de tipos en modelos de dominio complejos                                                                                                                                                                                          |
| UI library     | React 19                                        | Estándar                                                                                                                                                                                                                                    |
| Base de datos  | PostgreSQL gestionado por Supabase              | Relacional denso, row-level security para aislar places                                                                                                                                                                                     |
| ORM            | Prisma                                          | Tipos TypeScript auto-generados, velocidad de desarrollo                                                                                                                                                                                    |
| Auth           | Supabase Auth                                   | Magic links, OAuth, integrado con el resto del stack                                                                                                                                                                                        |
| Storage        | Supabase Storage                                | Avatares, fotos de eventos, assets del place                                                                                                                                                                                                |
| Realtime       | Supabase Realtime                               | Ver `realtime.md` para uso acotado                                                                                                                                                                                                          |
| Pagos          | Stripe + Stripe Connect Express                 | Los tres modos de billing del producto                                                                                                                                                                                                      |
| CSS            | Tailwind (solo utilidades core) + CSS variables | Layout rápido + temas configurables por place                                                                                                                                                                                               |
| Estado cliente | Zustand                                         | Simple, sin boilerplate. Uso mínimo — preferir URL y server state                                                                                                                                                                           |
| Data fetching  | Server Components + TanStack Query              | Server-first para datos estables, TanStack Query para mutations y realtime                                                                                                                                                                  |
| Forms          | React Hook Form + Zod                           | Validación tipada server + client                                                                                                                                                                                                           |
| Testing        | Vitest + Playwright                             | Unit/integration con Vitest (jsdom), RLS directos con Vitest (node + `pg` + `SET LOCAL request.jwt.claims`), E2E con Playwright sobre `my-place` Cloud (dev) / branch efímera (CI). Ver ADR `2026-04-22-e2e-rls-testing-cloud-branches.md`. |
| Hosting        | Vercel                                          | Wildcard subdomains nativos, edge middleware, deploy automático                                                                                                                                                                             |

## Razones estructurales

**Supabase como proveedor único** de auth + db + storage + realtime. Reduce complejidad operacional al mínimo para un solo founder. La alternativa (Neon + Clerk + Uploadthing + Pusher) fragmenta responsabilidades que conviene tener juntas.

**Vercel** para hosting. Next.js está hecho por Vercel, la integración con wildcard subdomains es directa, SSL automático para todos los subdomains. Alternativas son portables pero agregan fricción.

**Prisma sobre Drizzle.** Drizzle es más liviano pero Prisma tiene mejor DX para refactors de schema y velocidad de desarrollo en solitario.

## Variables de entorno

Archivo `.env.local`:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Database (connection string de Supabase)
DATABASE_URL=

# Stripe
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_CONNECT_CLIENT_ID=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=

# App
NEXT_PUBLIC_APP_URL=https://place.app
NEXT_PUBLIC_APP_DOMAIN=place.app
```

## Package manager

**pnpm** como package manager. Más rápido que npm, mejor manejo de monorepo si llegamos a necesitar workspaces.

## Versión de Node

Node LTS (20.x o superior). Definida en `.nvmrc` y en `package.json` via `engines`.

## Request-scoped caching (patrón)

Dentro del render de un RSC tree, evitamos queries duplicadas a la misma fila
mediante primitives cacheados por request. Dos capas:

- **`React.cache`** para primitives con clave única: `getCurrentAuthUser`,
  `findActiveMembership(userId, placeId)`, `findPlaceOwnership(userId, placeId)`,
  `findUserProfile(userId)`. Viven en `src/shared/lib/`.
- **Maps compartidos cross-key** cuando una misma entidad se accede por más de
  una clave natural. Hoy aplica a `Place` (slug + id) en
  `src/shared/lib/place-loader.ts`. `React.cache` no dedupea entre funciones
  distintas, así que hacemos cross-population manual: al resolver por una key,
  sembramos la otra con el mismo `Promise`.

Ver ADRs:

- `docs/decisions/2026-04-20-request-scoped-identity-cache.md` — patrón base.
- `docs/decisions/2026-04-21-unified-place-cache.md` — extensión cross-key.
- Pointer en `CLAUDE.md` § Gotchas sobre pgbouncer explica por qué cada query
  redundante cuesta caro en dev.
