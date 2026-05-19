# 0017 — Aprovisionamiento de entornos por migraciones versionadas; el deploy las corre; Neon branches efímeras (no merge)

- **Fecha:** 2026-05-18
- **Estado:** Aceptada
- **Alcance:** proceso/infra (estrategia de migraciones y deploy; sin cambio de comportamiento de la app)
- **Cierra:** la causa raíz del incidente del 2026-05-18 — `production` con Neon Auth provisto pero **cero schema de app** (signup OK, el place no se crea). Extiende ADR-0012 (migraciones = source-of-truth) con la disciplina de **aplicación/promoción** por entorno.

Las ADR son registro histórico: no se editan, se reemplazan con una nueva ADR que la supersede.

## Contexto

Incidente verificado empíricamente (MCP Neon, proyecto `prod-place` `odd-mountain-73982304`, 2026-05-18):

- Branch `production` (`br-divine-credit-ap9ty5er`, primary/default — el que usa el deploy): `neon_auth.*` provisto, **0 tablas `public`**, **0 funciones `app`**, **rol `app_system` ausente**, 0 migraciones drizzle. Un usuario huérfano en `neon_auth.user` (signup que no pudo crear place).
- Branches `dev`/`test`: 4 migraciones aplicadas, schema completo, rol `app_system` presente.

Causa raíz: las migraciones se aplicaron **a mano solo a `dev`/`test`** (S1–S4) y `production` nunca las recibió. **Neon branch ≠ git:** no existe un `merge` de una branch hija al parent que unifique schema+datos; la promoción es por **migraciones versionadas** (ADR-0012). El gap real: no había un paso que garantice que el branch destino del deploy tenga las migraciones aplicadas — quedó como acción manual, olvidable, y se olvidó para producción.

## Decisión

1. **Todo branch-entorno (production incluida) se aprovisiona ejecutando las migraciones versionadas del repo** (`pnpm db:migrate` → `drizzle-kit migrate`, leyendo `DATABASE_URL_MIGRATE` = conexión **admin `neondb_owner`** al branch destino). Nunca DDL a mano selectivo por entorno, nunca "merge"/promover una branch de dev a primary.
2. **Precondición dura:** el rol runtime **`app_system` (`LOGIN`, `NOBYPASSRLS`) debe existir en el branch destino ANTES de migrar** — las migraciones `0000`/`0001` lo referencian en `GRANT`/`REVOKE` y las policies RLS. Su password es **secreto por-entorno, generado fuera de banda** (nunca en repo, env versionada ni chat). `NOBYPASSRLS` es invariante (el rol de runtime jamás saltea RLS — ver `tests.md` § falso-verde).
3. **El deploy corre las migraciones contra su branch destino como paso del pipeline** (CI/cutover), de modo que ningún entorno quede atrás de las migraciones del repo. Las branches efímeras se crean **desde `production`** para probar; lo que se promueve es el **archivo de migración**, no el estado de la branch; la branch efímera se descarta.
4. **Un entorno NO se considera listo** hasta: migraciones aplicadas **+** rol `app_system` presente **+** envs seteadas y verificadas (`DATABASE_URL` = `app_system`@branch, vars de Neon Auth del branch, `NEON_AUTH_COOKIE_SECRET` ≥32, `AI_GATEWAY_API_KEY`, `NEXT_PUBLIC_APP_URL`/dominio).

## Alternativas rechazadas

- **Merge / promover branch en Neon.** No existe un merge real child→parent; promover `dev` a primary arrastra datos de dev, su `app_system` de dev y desalinea el proyecto/usuarios de Neon Auth ya reales en `production`.
- **Aplicar DDL a mano por entorno.** Es exactamente lo que causó el incidente (drift entre entornos, paso olvidable).
- **Que la app cree el schema en runtime.** Viola least-privilege: `app_system` no hace DDL (y no debe); el aprovisionamiento es responsabilidad del pipeline con rol admin.

## Consecuencias

- **+** Ningún entorno queda sin schema; aprovisionamiento reproducible y auditable; "promover a prod" deja de ser memoria humana.
- **+** Reafirma el modelo: branches Neon = copias efímeras para probar; el código (migraciones) es la verdad.
- **−** Cada entorno requiere su rol `app_system` + password creados **antes** del primer `db:migrate` (precondición operativa explícita, no implícita).
- **Watch (tarea de infra pendiente):** automatizar el `pnpm db:migrate` en el pipeline del deploy contra el branch destino. Hasta que exista, el cutover de producción se hace por el **runbook documentado** en `plan-sesiones.md` (riesgo operativo) y este ADR es la regla que lo obliga.

## Detalle operativo canónico

- Síntoma/diagnóstico rápido: `docs/gotchas/neon-branch-sin-migraciones.md`.
- Runbook de cutover de producción y checklist de envs: `docs/features/onboarding/plan-sesiones.md` § riesgo operativo / cutover.
- Índice arquitectónico: `docs/architecture.md` § "Migraciones y aprovisionamiento de entornos".
- Extiende ADR-0012 (source-of-truth de schema/funciones en migraciones); no lo supersede.
