# Una branch-entorno de Neon sin migraciones aplicadas: el signup anda pero el place no se crea

> Verificado empíricamente 2026-05-18 (MCP Neon, proyecto `prod-place`, branch `production`).

## Síntoma

El usuario completa el "registro" y **parece** que funciona, pero:

- El place **no se crea** (la pantalla de éxito no llega o falla silenciosa).
- En el branch de Neon que usa el deploy (ej. `production`) aparece el **auth user recién creado** en `neon_auth.user`… pero no hay ninguna tabla `public.*`.
- En los branches que sí tienen schema (`dev`/`test`) **no** está ese auth user, y `app_user` no tiene perfil en ninguno.

Desorienta porque el signup "anduvo" (la cuenta existe) y el código del wizard está bien — el bug no está en el código.

## Causa

La saga de onboarding es **two-tx** (ADR-0005 §4): `signUp` (Neon Auth) **commitea primero** en el branch que usa el deploy; recién después corren `ensureAppUser` + `app.create_place` contra ese mismo branch. Si el branch tiene Neon Auth provisto **pero no tiene el schema de app** (tablas `public.*`, schema/funciones `app`, rol `app_system`), la primera tx deja una **cuenta huérfana** y la segunda falla porque no existe `app_user` ni `app.create_place`.

Y `neon_auth.user` es **por-branch**: por eso el usuario aparece solo en el branch del deploy y no en los demás.

Raíz: ese branch **nunca recibió las migraciones**. Una branch de Neon no es una branch de git — no hay merge child→parent; el schema se promueve **corriendo las migraciones versionadas** en cada branch-entorno (ADR-0012/0017). Históricamente las migraciones se aplicaron a mano solo a `dev`/`test` y `production` quedó vacío.

## Solución

- **Regla (ADR-0017):** todo branch-entorno se aprovisiona con `pnpm db:migrate` contra ese branch (admin `neondb_owner` vía `DATABASE_URL_MIGRATE`), con el rol `app_system` (`NOBYPASSRLS`) creado **antes**. El deploy debe correr ese paso contra su branch destino — ningún entorno queda atrás.
- **Diagnóstico rápido** (MCP `run_sql` contra el branch sospechoso):
  ```sql
  SELECT
    (SELECT count(*) FROM pg_namespace WHERE nspname='app')                     AS app_schema,
    (SELECT count(*) FROM pg_roles WHERE rolname='app_system')                  AS app_system_role,
    (SELECT count(*) FROM information_schema.tables WHERE table_schema='public') AS public_tables;
  ```
  Todo en `0` = branch sin aprovisionar. El runbook de cutover de producción está en `docs/features/onboarding/plan-sesiones.md` (riesgo operativo).
- **Cuenta huérfana:** por idempotencia (ADR-0005 §4 / ADR-0008 §4), una vez aplicado el schema el usuario entra por **/login (vía "Acceso")** → wizard authed → crea el place (`app_user` se siembra de `verifyAccessToken().sub`, el `UNIQUE` de slug respalda el reintento). Alternativa: borrarla de `neon_auth` y re-registrar.

## Notas

- No es un bug a "arreglar" en código: el código respeta ADR-0005. Es un gap de **aprovisionamiento de entorno**.
- `next build`, los tests y el CI **no** lo detectan (no ejecutan la saga contra el branch real). Se ve solo ejercitando el flujo en el deploy → verificar en preview/prod, no solo en CI (mismo ethos que el gotcha de cookies `__Secure-`).
- Relacionado: ADR-0012 (migraciones source-of-truth), ADR-0017 (esta regla), `architecture.md` § "Migraciones y aprovisionamiento de entornos".
