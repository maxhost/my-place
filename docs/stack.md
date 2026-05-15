# Stack técnico

Elecciones tecnológicas de Place y justificación de cada una. Cualquier cambio de stack se registra acá antes de implementarse.

> **Estado:** post reset a scaffold limpio. La capa de datos migra a **Neon (Postgres)**. Auth, Storage, Realtime, Pagos y método de acceso a la DB (ORM/driver) están **por definir (TBD)** — se deciden en sesiones futuras antes de implementarse.

## Piezas

| Pieza          | Elección                                        | Razón                                                                                              |
| -------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Framework      | Next.js 15 con App Router                       | Multi-tenant nativo con middleware, Server Components, Server Actions, integración directa con Vercel |
| Lenguaje       | TypeScript strict mode                          | Seguridad de tipos en modelos de dominio complejos                                                 |
| UI library     | React 19                                        | Estándar                                                                                           |
| Base de datos  | PostgreSQL 17 gestionado por **Neon**           | Postgres serverless con branching; relacional denso; aislamiento de places vía RLS de Postgres     |
| Acceso a datos | **TBD**                                         | ORM vs query builder vs SQL plano sin decidir. NO se vuelve a Prisma.                               |
| Auth           | **TBD**                                         | Sin proveedor de auth elegido. Decisión de producto + técnica pendiente.                           |
| Storage        | **TBD**                                         | Avatares / assets del place: proveedor pendiente.                                                  |
| Realtime       | **TBD**                                         | Si se necesita, se decide acotadamente cuando aparezca el caso de uso.                             |
| Pagos          | **TBD**                                         | Los modos de billing del producto requieren decisión antes de implementar.                         |
| CSS            | Tailwind (solo utilidades core) + CSS variables | Layout rápido + temas configurables por place                                                      |
| Estado cliente | Zustand                                         | Simple, sin boilerplate. Uso mínimo — preferir URL y server state                                  |
| Data fetching  | Server Components (server-first)                | Datos estables vía RSC. Mutations vía Server Actions. Capa de cliente para mutations/realtime: TBD |
| Forms          | React Hook Form + Zod                           | Validación tipada server + client                                                                  |
| Testing        | Vitest + Playwright                             | Unit/integration con Vitest (jsdom); E2E con Playwright                                            |
| Hosting        | Vercel                                          | Wildcard subdomains nativos, edge middleware, deploy automático                                    |

## Región e infraestructura

- **Vercel:** proyecto `my-place` (team `maxhost27-6230s-projects`), dominio prod `place.community` (+ `*.place.community`).
- **Neon:** misma nube y región que las Functions de Vercel para minimizar latencia DB↔app. Provider **AWS** (Vercel corre sobre AWS). Región a fijar según la *Function Region* de Vercel (Settings → Functions). Default Vercel `iad1` → Neon **AWS `us-east-1` (N. Virginia)**. Confirmar y anotar la región definitiva acá.

## Razones estructurales

**Neon como base de datos.** Postgres gestionado serverless, con branching de DB (útil para entornos efímeros de test/preview) y escalado a cero. Reemplaza al Postgres de Supabase. El aislamiento entre places se sigue modelando con RLS de Postgres (es feature del motor, no de Supabase).

**Stack desacoplado por decidir.** A diferencia del modelo previo de proveedor único, ahora auth/storage/realtime/pagos se eligen pieza por pieza cuando el producto lo requiera. Cada elección se registra en este documento y, si amerita, en `docs/decisions/`.

**Vercel** para hosting. Next.js está hecho por Vercel, la integración con wildcard subdomains es directa, SSL automático para todos los subdomains.

## Variables de entorno

Archivo `.env.local` (gitignored — nunca se commitea):

```env
# Database (connection string de Neon, pooled)
DATABASE_URL=

# App
NEXT_PUBLIC_APP_URL=https://place.community
NEXT_PUBLIC_APP_DOMAIN=place.community
```

Las variables de auth/storage/realtime/pagos se agregan acá cuando se decida cada pieza.

## Package manager

**pnpm** como package manager. Más rápido que npm, mejor manejo de monorepo si llegamos a necesitar workspaces.

## Versión de Node

Node LTS (22.x o superior). Vercel corre el proyecto en Node 24.x. Fijar en `.nvmrc` y en `package.json` via `engines` cuando se reintroduzcan.

## Request-scoped caching (patrón a reimplementar)

Patrón arquitectónico para cuando se reconstruya la capa de datos. Dentro del render de un RSC tree, evitar queries duplicadas a la misma fila mediante primitives cacheados por request:

- **`React.cache`** para primitives con clave única (ej. usuario actual, membership activa, ownership, perfil de usuario). Viven en `src/shared/lib/`.
- **Maps compartidos cross-key** cuando una misma entidad se accede por más de una clave natural (ej. `Place` por slug y por id). `React.cache` no dedupea entre funciones distintas, así que se hace cross-population manual: al resolver por una key, se siembra la otra con el mismo `Promise`.

Cuando se reimplemente, documentar la decisión en `docs/decisions/`.
