# Modelo de datos base

Schema del core del producto, expresado en **SQL (Postgres) ORM-agnóstico**. El método de acceso (ORM/query builder/SQL plano) está TBD; el modelo no depende de esa decisión. Cada feature agrega sus propias tablas respetando este core.

## Schema base

```sql
-- IDs opacos no secuenciales (cuid/uuid generado por la app o gen_random_uuid()).
-- Razón: no exponer conteos de places/users vía URLs secuenciales.

CREATE TYPE membership_role AS ENUM ('MEMBER', 'ADMIN');

-- billing_mode: estrategia de pagos TBD. Se conserva el enum como invariante
-- de dominio (un place tiene un solo modo). Las columnas Stripe-específicas se
-- removieron del core hasta decidir proveedor de pagos.
CREATE TYPE billing_mode AS ENUM ('OWNER_PAYS', 'OWNER_PAYS_AND_CHARGES', 'SPLIT_AMONG_MEMBERS');

CREATE TABLE app_user (
  id           TEXT PRIMARY KEY,
  email        TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  handle       TEXT UNIQUE,
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

CREATE TABLE membership (
  id        TEXT PRIMARY KEY,
  user_id   TEXT NOT NULL REFERENCES app_user(id),
  place_id  TEXT NOT NULL REFERENCES place(id),
  role      membership_role NOT NULL DEFAULT 'MEMBER',
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

## Capas de identidad de un usuario

Ver `docs/ontologia/miembros.md` para el detalle ontológico. En el schema:

- **Capa universal** (en `app_user`): email, display_name, handle, avatar_url
- **Capa contextual** (en `membership` + datos derivados por place): role, fecha de join, contribuciones acumuladas calculadas por feature
- **Capa privada**: settings del usuario, no expuestos a otros

## Derecho al olvido

Cuando un usuario deja un place (`membership.left_at` se setea):

- El contenido que creó (mensajes, temas, eventos) queda en el place
- Durante 365 días ese contenido sigue atribuido a su nombre (trazabilidad)
- Pasados los 365 días, un job periódico reemplaza el user reference por un placeholder "ex-miembro"
- Su presencia, lecturas y actividad se borran inmediatamente al salir

Esta política se implementa en `features/members/` con un cron job o scheduled function.

## Convenciones

- IDs son opacos y no secuenciales (cuid o uuid), no autoincrementales. Razón: no exponer conteos de places o users vía URLs secuenciales.
- Soft delete vía `archived_at` o `left_at` en lugar de `DELETE` físico. Los hard deletes son operación explícita.
- Timestamps siempre en UTC (`TIMESTAMPTZ`). La conversión a timezone del usuario es responsabilidad del cliente.
