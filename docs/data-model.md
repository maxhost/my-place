# Modelo de datos base

Schema del core del producto, expresado en **SQL (Postgres) ORM-agnóstico**. El método de acceso (ORM/query builder/SQL plano) está TBD; el modelo no depende de esa decisión. Cada feature agrega sus propias tablas respetando este core.

> _Última actualización: 2026-05-16._ Documento vivo: si un cambio de código altera el schema o un invariante, se actualiza **en la misma sesión** y se ajusta la fecha. El detalle de dominio es canónico en `docs/ontologia/`; este doc es su expresión en schema.

## Schema base

```sql
-- IDs opacos no secuenciales (cuid/uuid generado por la app o gen_random_uuid()).
-- Razón: no exponer conteos de places/users vía URLs secuenciales.

-- No hay ENUM de rol. El rol se deriva: un usuario es OWNER de un place si
-- existe fila en place_ownership; si solo tiene membership, es MIEMBRO. La
-- administración delegada (rol "admin") será una feature futura de grupos con
-- permisos granulares, no un rol en membership.

-- billing_mode: estrategia de pagos TBD. Se conserva el enum como invariante
-- de dominio (un place tiene un solo modo). Las columnas Stripe-específicas se
-- removieron del core hasta decidir proveedor de pagos.
CREATE TYPE billing_mode AS ENUM ('OWNER_PAYS', 'OWNER_PAYS_AND_CHARGES', 'SPLIT_AMONG_MEMBERS');

CREATE TABLE app_user (
  id           TEXT PRIMARY KEY,
  -- 1:1 con la identidad de login de Better Auth. Referencia lógica (sin FK
  -- hard): esa tabla es propiedad de la librería de auth, no la versiona este
  -- schema. La fila app_user se crea en un hook transaccional al signup.
  auth_user_id TEXT NOT NULL UNIQUE,
  email        TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  -- Obligatorio y único global. Se asigna random no-usado al crear la cuenta;
  -- el usuario puede editarlo (única regla: no colisionar). Se libera para
  -- reuso SOLO al borrar la cuenta — salir de un place no lo libera.
  handle       TEXT NOT NULL UNIQUE,
  avatar_url   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE place (
  id               TEXT PRIMARY KEY,
  slug             TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  description      TEXT,
  theme_config     JSONB NOT NULL DEFAULT '{}',
  opening_hours    JSONB NOT NULL DEFAULT '{}',
  billing_mode     billing_mode NOT NULL,
  enabled_features JSONB NOT NULL DEFAULT '["conversations","events","members"]',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at      TIMESTAMPTZ
);

-- Custom domains. El subdomain {slug}.place.community NO se almacena (deriva
-- de place.slug); acá solo viven los dominios propios que configura el place.
CREATE TABLE place_domain (
  id              TEXT PRIMARY KEY,
  place_id        TEXT NOT NULL REFERENCES place(id),
  domain          TEXT NOT NULL UNIQUE,    -- ej. community.empresa.com
  -- Espeja el estado de Vercel: se setea cuando Vercel reporta verified + SSL
  -- emitido (alta y verificación vía Vercel Domains API, ver multi-tenancy.md).
  verified_at     TIMESTAMPTZ,
  -- OIDC client confidencial propio de este dominio (Relying Party). Referencia
  -- lógica al client gestionado por el plugin OIDC de Better Auth; se provisiona
  -- al verificarse el dominio y se revoca al archivarlo.
  oauth_client_id TEXT UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at     TIMESTAMPTZ
);

CREATE TABLE membership (
  id        TEXT PRIMARY KEY,
  user_id   TEXT NOT NULL REFERENCES app_user(id),
  place_id  TEXT NOT NULL REFERENCES place(id),
  -- Sin columna role: owner se deriva de place_ownership; si no, es miembro.
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at   TIMESTAMPTZ,
  UNIQUE (user_id, place_id)
);

CREATE TABLE place_ownership (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES app_user(id),
  place_id   TEXT NOT NULL REFERENCES place(id),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, place_id)
);

CREATE TABLE invitation (
  id         TEXT PRIMARY KEY,
  place_id   TEXT NOT NULL REFERENCES place(id),
  email      TEXT NOT NULL,
  invited_by TEXT NOT NULL,
  accepted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  token      TEXT NOT NULL UNIQUE
);
```

## Invariantes del dominio

Reglas que el código debe enforzar. No son validaciones UI — son invariantes estructurales que viven en el modelo o en domain services.

- **Máximo 150 miembros por place.** Al intentar agregar el miembro 151, el modelo rechaza con error estructural.
- **Mínimo 1 owner por place activo.** Un place no puede quedar sin owner. Si un owner quiere irse, debe transferir primero.
- **Transferencia de ownership requiere que el target sea miembro actual.** No se puede transferir a alguien externo al place.
- **No se pueden mezclar billing modes.** Un place tiene un solo modo activo. Cambiar de modo requiere flow explícito. (Estrategia de pagos concreta: TBD.)
- **Slug inmutable.** Ver `multi-tenancy.md`.
- **Un usuario no puede tener dos memberships activas en el mismo place.** Enforzado por unique constraint `(user_id, place_id)`.
- **Un dominio mapea a lo sumo a un place.** Enforzado por `place_domain.domain UNIQUE`. El routing por hostname (ver `multi-tenancy.md`) resuelve **solo dominios verificados** (`verified_at IS NOT NULL`, `archived_at IS NULL`).
- **Un humano = un `app_user`.** Relación 1:1 con la identidad de login de Better Auth (`app_user.auth_user_id UNIQUE`), sin importar por qué dominio entró. El SSO cross-domain no crea identidades nuevas.
- **Rol derivado, no almacenado.** Un usuario es owner de un place si existe fila en `place_ownership`; si solo tiene `membership`, es miembro. No existe rol `admin`: la administración delegada será una feature futura de grupos con permisos granulares.
- **Handle obligatorio y único global.** `app_user.handle NOT NULL UNIQUE`. Auto-asignado random no-usado al crear la cuenta, editable por el usuario, liberado para reuso **solo al borrar la cuenta** (no al salir de un place).

## Capas de identidad de un usuario

Ver `docs/ontologia/miembros.md` para el detalle ontológico. En el schema:

- **Capa universal** (en `app_user`): email, display_name, handle, avatar_url
- **Capa contextual** (en `membership` + datos derivados por place): rol derivado (owner/miembro), fecha de join, contribuciones acumuladas calculadas por feature
- **Capa privada**: settings del usuario, no expuestos a otros

## Auth y OIDC (Neon Auth / Better Auth)

Place actúa como su propio OIDC Identity Provider. La topología y el flujo SSO son canónicos en `docs/architecture.md` § "Sesión y SSO". En el schema:

- **Tablas de auth propiedad de la librería.** Better Auth gestiona sus propias tablas (identidad de login, sesiones, accounts, verification) y el plugin OIDC Provider las suyas (OAuth clients, tokens, consents). **No se hand-spec-ean acá**: las crea y migra la librería; documentar sus internals los vuelve stale. Se versionan vía las migraciones de Better Auth.
- **Integración con `app_user` (decidido: separada, 1:1).** `app_user` es la capa de identidad universal del producto y vive **separada** de la tabla de login de Better Auth, con link 1:1 vía `app_user.auth_user_id UNIQUE`. Razón: la anonimización del derecho al olvido opera sobre `app_user` sin tocar las tablas de auth, y el modelo de dominio no se acopla al schema de la librería. La fila `app_user` se crea en un hook transaccional al signup.
- **Clients OIDC = solo custom domains (decidido: uno por dominio).** `*.place.community` (subdomains + inbox) comparten la cookie cross-subdomain y **no son RPs**. Cada custom domain es un RP con su **propio client confidencial**, provisionado al verificarse el dominio y revocado al archivarlo; el link vive en `place_domain.oauth_client_id`. Topología canónica en `architecture.md` § "Sesión y SSO".
- **TBD acotado restante:** firma de ID tokens (RS256 vs EdDSA) — detalle de implementación, no afecta el modelo.

## Derecho al olvido

Cuando un usuario deja un place (`membership.left_at` se setea):

- El contenido que creó (mensajes, temas, eventos) queda en el place
- Durante 365 días ese contenido sigue atribuido a su nombre (trazabilidad)
- Pasados los 365 días, un job periódico reemplaza el user reference por un placeholder "ex-miembro"
- Su presencia, lecturas y actividad se borran inmediatamente al salir

**Salir de un place ≠ borrar la cuenta.** Lo de arriba es per-place (`membership.left_at`); el usuario sigue siendo el mismo `app_user` con su handle en los otros places. **Borrar la cuenta** es la operación universal: ahí sí se libera el `handle` para reuso y se desliga la identidad de login (capa universal).

Esta política se implementa en `features/members/` con un cron job o scheduled function.

## Convenciones

- IDs son opacos y no secuenciales (cuid o uuid), no autoincrementales. Razón: no exponer conteos de places o users vía URLs secuenciales.
- Soft delete vía `archived_at` o `left_at` en lugar de `DELETE` físico. Los hard deletes son operación explícita.
- Timestamps siempre en UTC (`TIMESTAMPTZ`). La conversión a timezone del usuario es responsabilidad del cliente.
