# 0011 — Función de identidad RLS propia (`app.current_user_id()`)

- **Fecha:** 2026-05-17
- **Estado:** Aceptada
- **Alcance:** auth (fundamento), multi-tenancy (RLS)
- **Cierra:** el "TBD acotado / verificar `auth.user_id()` en el branch" de ADR-0006 §Consecuencias / ADR-0010. **No** cambia el modelo RLS; fija el origen/nombre de la función de identidad.

## Contexto

ADR-0006/0010 referían `auth.user_id()` como la función que las policies leen para obtener la identidad (claim `sub` inyectado en `request.jwt.claims`), asumida "provista por Neon RLS, a verificar empíricamente". En S0 se verificó sobre el branch `dev` (rama de `production`): **`auth.user_id()` NO existe**, no hay schema `auth`, no hay roles `authenticated`/`anonymous`, solo la extensión `plpgsql`. Neon Auth está provisionado; **Neon RLS/Authorize NO** (es una feature aparte, no default).

## Decisión

**La función de identidad para RLS es propia y versionada por nosotros:** `app.current_user_id()` (schema `app`), definida en nuestras migraciones:

```sql
CREATE SCHEMA IF NOT EXISTS app;
CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS text
  LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub' $$;
```

- Las policies RLS (ADR-0010, por-operación) usan **`app.current_user_id()`** donde antes decía `auth.user_id()`. Sin claim → `NULL` → la policy deniega.
- El backend sigue: verificar el JWT con `jose`+JWKS → `set_config('request.jwt.claims', <claims>, true)` (**transaction-local**, `is_local=true`, obligatorio) dentro de la tx → las policies leen `app.current_user_id()`.
- **No** se usa el sugar `authUid`/`auth.user_id()` de `drizzle-orm/neon` (las policies son predicados custom por-operación; el sugar no era load-bearing). No se usa Neon RLS/Authorize, Data API ni rol `anon`.

## Verificación empírica (2026-05-17, branch `dev`)

Probado end-to-end con el rol real: creado `app_system` (`LOGIN`, `NOSUPERUSER`, **`NOBYPASSRLS`**), schema+función, tabla con RLS y policy `to app_system using (owner = app.current_user_id())`. Bajo `SET ROLE app_system` + `set_config('request.jwt.claims','{"sub":"u1"}',true)`: el `SELECT` devolvió **solo** la fila de `u1` (no la de `u2`). `app_system` pudo setear el GUC custom transaction-local. Aislamiento RLS real sin ninguna extensión/feature de Neon. (Tabla de prueba dropeada; schema/función/rol quedan como fundamento.)

## Alternativas rechazadas

- **Habilitar Neon RLS/Authorize para tener `auth.user_id()`.** Suma una feature de Neon no provisionada por default, schema/funciones library-owned (no en nuestras migraciones, no portables dev→prod con el resto), dependencia externa para algo que resolvemos con una función SQL de 1 línea. Rechazada por robustez/control.
- **Crear nuestra función dentro de un schema `auth`** (para reusar el sugar de Drizzle). Riesgo de colisión futura con Neon RLS/`neon_auth` y con el sugar; las policies son custom igual. Rechazada: `app.current_user_id()` en schema propio `app`, sin ambigüedad.

## Consecuencias

- `multi-tenancy.md` §RLS, `docs/features/onboarding/` (§5, tests), y referencias en docs vivos: `auth.user_id()` → **`app.current_user_id()`**. Las ADR históricas no se editan (su `auth.user_id()` se lee con esta supersesión de nombre/origen).
- La función + schema `app` + rol `app_system` entran en la **primera migración** (S1) y se versionan; van a `dev`/`test`/`production` por los mismos archivos de migración.
- Invariante operativo reforzado: la inyección de claims es **`set_config(..., true)` transaction-local dentro de una tx por request** (con el driver pooled de Neon, omitir `true` filtraría identidad entre requests). Test-guard/Test en S2/S3.
- `app.current_user_id()` es `STABLE` y devuelve `NULL` sin claim (deniega por default).

## Detalle operativo canónico

- RLS por-operación + rol/JWT + esta función: `docs/multi-tenancy.md` § RLS.
- Modelo RLS/invitación: ADR-0006, ADR-0010. Identidad/saga: ADR-0005/0008.
