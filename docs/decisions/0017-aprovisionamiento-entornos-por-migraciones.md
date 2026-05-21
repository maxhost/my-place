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

## Cierre del Watch (2026-05-20)

El §Consecuencias previa marcaba como **Watch (tarea de infra pendiente)** la automatización de `pnpm db:migrate` en el pipeline. Se reincidió el patrón: 2026-05-20, deploy del Hub V1 empujó código S2/S5 (commits `bc44744`/`a39c147`/`44930e0`/`be19575`/`8fbce88`/`be6a0e3`) sin que las migraciones `0004_member_read` y `0005_inbox_payload_fn` corrieran contra la branch `production`. Resultado: 500 en `app.place.community/es` con `digest=435036100` = `function app.get_inbox_payload() does not exist`. Fix manual aplicado via MCP Neon (2 tx atómicas con el SQL exacto del repo + INSERT en `drizzle.__drizzle_migrations` con los hashes oficiales extraídos de la branch `test`).

Para cerrar el §Watch de forma estructural, se introduce el guard `scripts/maybe-migrate.mjs` invocado desde `package.json` `build`:

```json
"build": "node scripts/maybe-migrate.mjs && cross-env NODE_ENV=production next build"
```

Comportamiento:

- **`VERCEL_ENV=production`** → corre `pnpm db:migrate` (rol admin vía `DATABASE_URL_MIGRATE` del environment de Vercel scoped a Production). Fail-closed: si la env var no está, o `drizzle-kit migrate` falla, el build aborta antes de `next build`. Mejor un deploy roto detectable que un deploy con código adelantado del schema.
- **`VERCEL_ENV=preview`** → skip. Las preview branches efímeras se aprovisionan fuera del flujo del deploy (creadas desde `production`). Si emerge la necesidad de preview con migraciones automáticas, se ajusta el guard.
- **Local `pnpm build`** (sin `VERCEL_ENV`) → skip. Preserva el flujo dev sin requerir credenciales admin localmente.

**Precondición operativa** (manual, una sola vez): la env var `DATABASE_URL_MIGRATE` se setea en Vercel scoped a **Production** únicamente, con el connection string admin (`neondb_owner`) de la branch `production` de Neon. Comando:

```bash
vercel env add DATABASE_URL_MIGRATE production
# Pegar: postgresql://neondb_owner:<password>@<endpoint-production>/<db>?sslmode=require
```

Esto cierra el gap entre "código pusheado" y "schema aprovisionado" sin acción humana intermedia. El próximo push con migración pendiente queda imposible de incumplir: o el migrate corre y el deploy avanza, o el build aborta y nada llega a producción.

**No supersede el ADR**: las decisiones 1-4 del §Decisión siguen vigentes literalmente; el cierre del Watch es la implementación de la promesa pendiente, no un cambio de regla.
