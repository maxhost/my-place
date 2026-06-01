# 0004 — Capa de acceso a datos: Drizzle ORM

- **Fecha:** 2026-05-16
- **Estado:** Aceptada
- **Alcance:** stack, datos, multi-tenancy (RLS)
- **Supersede:** cierra el TBD "Acceso a datos" de `docs/stack.md`

Las ADR son registro histórico: no se editan, se reemplazan con una nueva ADR que la supersede.

## Contexto

El reset a scaffold limpio eliminó Prisma. Prisma no se sacó por "ser un ORM", sino por tres problemas concretos de su arquitectura, todos verificados:

1. **Tiempo de carga**: Prisma arrastra un query engine (binario Rust / WASM) + client generado pesado → cold starts lentos y bundle grande en serverless (Vercel Functions). Aun tras reescribir el engine a TS en v7 sigue ~600 KB–1.6 MB y ~115 ms+ de cold start (antes 1–3 s).
2. **RLS**: Prisma gestiona su propio pool y no permite correr `SET LOCAL …` en la misma conexión/transacción que la query. Sin eso, las policies RLS de Postgres —el mecanismo de aislamiento entre places (`stack.md`)— no se pueden aplicar de forma confiable.
3. **Codebase**: DSL propio separado, client generado, modelo de migraciones opinado, acoplamiento del modelo de dominio al schema de la librería.

La capa de acceso necesita: integrarse con Neon serverless, soportar RLS por request, ser liviana en serverless, y no acoplar el dominio a un DSL.

## Decisión

**Capa de acceso a datos = Drizzle ORM.**

- **Carga**: Drizzle es un thin query builder que compila a SQL — **sin engine, sin binario, ~7 KB min+gzip, cero dependencias**, cold start ≈ el del driver. Elimina de raíz el problema 1.
- **RLS**: se usa el driver serverless de Neon (`neon-http` / `neon-websockets`); la conexión y la transacción quedan **bajo control de la app**, así que se puede setear el contexto por request (rol/`SET LOCAL`) en la misma transacción que las queries. Neon documenta oficialmente RLS declarativo con Drizzle (`crudPolicy` / `authenticatedRole` de `drizzle-orm/neon`): las policies viven en el schema TypeScript. Elimina el problema 2.
- **Codebase**: schema en TypeScript idiomático, sin DSL aparte ni client generado; migraciones generadas desde el schema (`drizzle-kit`). Elimina el problema 3.
- **RLS enforcement**: se enforcea conectando con un **rol no-admin**. Los connection strings admin de Neon traen `BYPASSRLS` e ignoran las policies — la app de producto **no** usa el rol admin para queries de dominio.

NO se vuelve a Prisma.

## Alternativas rechazadas

- **Kysely (query builder puro).** Resuelve los tres dolores igual de bien (liviano, conexión propia), pero no aporta DSL de schema ni migraciones: el schema/DDL se mantiene a mano. En un core con muchas FKs e invariantes (`data-model.md`) eso es más trabajo manual y más superficie de error. Rechazada por costo de mantenimiento, no por arquitectura.
- **SQL plano + `postgres.js`.** Lo más liviano y control total, pero tipos y migraciones 100% a mano → máxima superficie de error en un dominio relacional denso. Rechazada por riesgo/mantenibilidad para una sola persona.
- **Volver a Prisma (incluso v7).** Sigue con bundle/cold-start mayores y el problema de RLS por el manejo de conexión. Rechazada: reintroduce exactamente lo que se sacó.

## Consecuencias

- Dependencias nuevas (cuando se implemente S1): `drizzle-orm`, `drizzle-kit` (dev), driver serverless de Neon (`@neondatabase/serverless`). Versiones se fijan al implementar.
- Las tablas de auth son **library-owned** y viven en el schema `neon_auth` (Better Auth, ver diagnóstico en ADR-0005). El schema del core va en `public`. Drizzle modela `public`; las tablas de `neon_auth` **no** se versionan en nuestras migraciones (las gestiona Neon Auth).
- El patrón de request-scoped caching (`stack.md` § Request-scoped caching) se reimplementa sobre Drizzle + `React.cache`; se documentará su decisión al implementarlo.
- Falta acotado (se decide al implementar S1): elección `neon-http` vs `neon-websockets` por tipo de operación (HTTP para queries no interactivas, WebSocket para transacciones interactivas), y el rol Postgres no-admin que usa la app para enforcar RLS.

## Detalle operativo canónico

- Stack y estado del TBD cerrado: `docs/stack.md` § Piezas.
- Schema del core: `docs/data-model.md` (ORM-agnóstico; Drizzle es su expresión).
- RLS y aislamiento entre places: `docs/multi-tenancy.md` + guías Neon (`neon.com/docs/guides/rls-drizzle`, `/rls-query-execution`).

## Addendum operacional — Phase 2.F tech-debt closure (2026-06-01)

Write-back del uso real de Drizzle a junio 2026, para alinear el registro con el código (el cuerpo de la decisión arriba no se edita — es histórico). El audit pre-V1.3 marcó esto como "drift": la ADR describe Drizzle como query builder, pero el código no lo usa como tal.

**Cómo se usa Drizzle hoy** (verificado por grep exhaustivo, 2026-06-01):

- **Schema-as-types + migraciones.** `drizzle-orm/pg-core` define el schema del core en `src/db/schema/index.ts` (tablas, columnas, enums, policies RLS vía `pgPolicy`, CHECKs, índices). `drizzle-kit` genera las migraciones desde ese schema. El tag `sql` de `drizzle-orm` se usa solo para fragmentos raw embebidos en el schema (default `gen_random_uuid()`, predicados RLS, CHECKs).
- **Las queries de dominio NO usan el query builder de Drizzle.** En runtime corren como **SQL raw parametrizado** a través del `Pool` de `@neondatabase/serverless` (`src/db/client.ts`) y, en su mayoría, a través de **funciones DEFINER** (ADR-0011/0012). Grep confirmó **cero** usos de `.select()/.insert()/.update()/.delete()/db.query` de Drizzle en `src/`.

**Por qué no es una reversión de ADR-0004:** el valor que motivó elegir Drizzle —schema en TS idiomático + migraciones generadas + RLS declarativo en el schema, todo sin engine/binario— se está usando íntegro. Lo único que aún no se adoptó es la capa de **query builder** (el comentario en `src/db/client.ts` la deja explícitamente "para reintroducir con la primera feature"). En la práctica las features hasta V1.2 resolvieron con SQL raw + DEFINERs, que encajan mejor con el modelo RLS-por-operación. `drizzle-orm` sigue siendo **dependencia de runtime** porque el tag `sql` y los tipos del schema se importan desde `src/db/schema`.

**Decisión 2.F (status quo — opción a del tracker tech-debt):** se mantiene el patrón actual (SQL raw + DEFINERs); **NO** se migran queries al query builder de Drizzle. Si una feature futura justifica el query builder, se adopta incrementalmente sin ADR nueva (está dentro del alcance original de ADR-0004). `docs/stack.md` §Piezas "Acceso a datos" refleja este uso real.
