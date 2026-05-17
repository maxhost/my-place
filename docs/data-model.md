# Modelo de datos base

Schema del core del producto, expresado en **SQL (Postgres) ORM-agnóstico**. El método de acceso (ORM/query builder/SQL plano) está TBD; el modelo no depende de esa decisión. Cada feature agrega sus propias tablas respetando este core.

> _Última actualización: 2026-05-17._ Documento vivo: si un cambio de código altera el schema o un invariante, se actualiza **en la misma sesión** y se ajusta la fecha. El detalle de dominio es canónico en `docs/ontologia/`; este doc es su expresión en schema.

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

-- Lifecycle del place por la suscripción del owner (ver ADR-0003). El borrado
-- a los 12m es purga física, no un estado. Mecanismo de cobro: Pagos TBD.
CREATE TYPE place_subscription_status AS ENUM (
  'ACTIVE', 'PAYMENT_PENDING', 'INACTIVATION_PROCESS', 'INACTIVE'
);

CREATE TABLE app_user (
  id           TEXT PRIMARY KEY,
  -- 1:1 con la identidad de login de Neon Auth (neon_auth.user). Referencia
  -- lógica (sin FK hard): esa tabla es library-owned, no la versiona este
  -- schema. app_user se provisiona por orquestación app-side (nuestro Server
  -- Action de signup) + guard JIT idempotente ensureAppUser — NO por hook ni
  -- trigger (Neon Auth es gestionado, sin webhooks). Canónico: ADR-0006.
  auth_user_id TEXT NOT NULL UNIQUE,
  email        TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  -- Obligatorio y único global. Se asigna random no-usado al crear la cuenta;
  -- el usuario puede editarlo (única regla: no colisionar). Se libera para
  -- reuso SOLO al borrar la cuenta — salir de un place no lo libera.
  handle       TEXT NOT NULL UNIQUE,
  avatar_url   TEXT,
  -- Resetea con cualquier login. Driver de la escala de inactividad de cuenta
  -- (6m inactivo / 12m eliminación) — solo aplica si NO exento (ver invariantes).
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Fin irreversible: scrub de PII + handle liberado; la fila queda como cáscara
  -- "ex-miembro" para preservar FKs de contenido (tombstone, ver ADR-0003).
  tombstoned_at  TIMESTAMPTZ,
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
  -- Suscripción del owner → plataforma (ver ADR-0003). ACTIVE por default;
  -- al impago avanza por los estados. La eliminación a 12m es purga física.
  subscription_status   place_subscription_status NOT NULL DEFAULT 'ACTIVE',
  subscription_past_due_at TIMESTAMPTZ,  -- vencimiento impago que abrió el ciclo
  -- Trial de 30 días seteado al crear el place (ADR-0005): now()+30d. El place
  -- es 100% usable durante el trial. Al expirar sin pago → entra al flujo
  -- PAYMENT_PENDING (paywall, ADR-0003). Mecanismo de cobro: Pagos TBD.
  trial_ends_at         TIMESTAMPTZ,
  -- Solo lista las zonas OPCIONALES habilitadas. Discusiones está siempre
  -- activa (es el primitivo, no se puede desactivar) y NO aparece acá.
  -- Miembros no es una zona toggleable. Valores posibles: "events", "library".
  -- Default: ambas OFF — un place nace solo con Discusiones; el owner
  -- activa Eventos y/o Biblioteca desde /settings cuando las quiere.
  enabled_features JSONB NOT NULL DEFAULT '[]',
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

## Shapes JSON canónicos (ADR-0005)

Las columnas `JSONB` no son libres: tienen un shape canónico validado con Zod en el código.

**`place.theme_config`** — paleta acotada. El owner setea **solo 3 tokens**; el producto **deriva** el resto en render (no se persisten los derivados). Default = paleta "Papel" de marca (mismos valores que la landing).

```jsonc
{
  "colors": {
    "accent": "#C4632F",  // acento de marca del place (CTA, kickers)
    "bg":     "#FAF7F0",  // fondo papel
    "ink":    "#1C1B22"   // texto principal
  }
}
// Derivados en render (NO persistidos): --surface, --muted, --border,
// --accent-strong, --accent-ink. --accent-strong se deriva para cumplir el
// contraste WCAG (igual que en la landing). Guardrail = auto-ajustar + avisar
// al owner (ADR-0005 §8): nunca se persiste/aplica un par que falle contraste
// sin corrección + aviso.
```

**`place.opening_hours`** — horario del place (gate de horario, `architecture.md` + `docs/ontologia/conversaciones.md` es canónico para el comportamiento; acá solo el shape).

```jsonc
{
  "timezone": "America/Argentina/Buenos_Aires",  // IANA tz del owner
  "weekly": {                                     // [] = cerrado ese día
    "mon": [{ "open": "09:00", "close": "20:00" }],
    "tue": [{ "open": "09:00", "close": "20:00" }],
    "wed": [{ "open": "09:00", "close": "20:00" }],
    "thu": [{ "open": "09:00", "close": "20:00" }],
    "fri": [{ "open": "09:00", "close": "20:00" }],
    "sat": [{ "open": "09:00", "close": "20:00" }],
    "sun": [{ "open": "09:00", "close": "20:00" }]
  }
}
// DEFAULT al crear el place (ADR-0007): 09:00–20:00 todos los días en el
// timezone del owner. Rangos en hora local del `timezone`.
// El LLM del onboarding NO propone horario (ADR-0007). El owner lo edita
// después en /settings (gateado por email verificado). El owner es la
// excepción al gate (accede fuera de horario, architecture.md).
```

`place.enabled_features` ya documentado arriba (lista de zonas opcionales: `"events"`, `"library"`).

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
- **Discusiones es la zona no-desactivable.** Es el primitivo del que derivan eventos y biblioteca; siempre está activa. Eventos y Biblioteca son zonas **opcionales** que el owner activa/desactiva desde `/settings/*` (`enabled_features`). Miembros no es una zona toggleable: los miembros existen siempre.
- **Handle obligatorio y único global.** `app_user.handle NOT NULL UNIQUE`. Auto-asignado random no-usado al crear la cuenta, editable por el usuario, liberado para reuso **solo al borrar la cuenta** (no al salir de un place).
- **Exención de la escala de inactividad.** La escala 6m/12m de cuenta NO corre mientras el usuario sea owner de ≥1 place activo O tenga ≥1 pago activo. Es una condición evaluada, no un flag permanente: al dejar de cumplir ambas, la cuenta entra a la escala. Ver ADR-0003.
- **Alta owner-first: cuenta y place se crean juntos (saga, no transacción única).** El alta del apex crea `app_user` (+ identidad Better Auth) y luego `place` + `place_ownership` + `membership` vía la función atómica `app.create_place` (ADR-0005, refinado por ADR-0012 — INSERT directo denegado por RLS). Una cuenta queda sin place solo si falla ese último paso (reintento, no error fatal). Excepción de diseño: alta desde invitación o "join" del directorio crea cuenta + `membership` sin crear place.
- **Place requiere suscripción del owner activa.** Sin pago, el place avanza por `subscription_status` hasta purga a los 12m. La eliminación/tombstone de un usuario que es único owner de un place activo se bloquea: primero transferir ownership o cerrar el place (extiende "mínimo 1 owner").

## Capas de identidad de un usuario

Ver `docs/ontologia/miembros.md` para el detalle ontológico. En el schema:

- **Capa universal** (en `app_user`): email, display_name, handle, avatar_url
- **Capa contextual** (en `membership` + datos derivados por place): rol derivado (owner/miembro), fecha de join, contribuciones acumuladas calculadas por feature
- **Capa privada**: settings del usuario, no expuestos a otros

## Auth y OIDC (Neon Auth / Better Auth)

Place actúa como su propio OIDC Identity Provider. La topología y el flujo SSO son canónicos en `docs/architecture.md` § "Sesión y SSO". En el schema:

- **Tablas de auth propiedad de la librería, en el schema `neon_auth`.** Verificado (2026-05-16, ADR-0005): Neon Auth provisionado con `auth_provider: better_auth`; tablas en el schema **`neon_auth`** (`user, session, account, verification, jwks` + plugin organization: `organization, member, invitation`). El core del producto va en **`public`**. El link `app_user.auth_user_id` → `neon_auth.user.id` es **referencia lógica cross-schema, sin FK hard**. **No se hand-spec-ean acá** ni se versionan en nuestras migraciones (Drizzle modela solo `public`; las gestiona Neon Auth). **No** usamos el plugin organization de Better Auth para modelar `place` — `place` vive en `public` (este schema); `neon_auth.organization/member/invitation` se ignoran para el dominio.
- **Integración con `app_user` (decidido: separada, 1:1).** `app_user` es la capa de identidad universal del producto y vive **separada** de la tabla de login de Better Auth, con link 1:1 vía `app_user.auth_user_id UNIQUE`. Razón: la anonimización del derecho al olvido opera sobre `app_user` sin tocar las tablas de auth, y el modelo de dominio no se acopla al schema de la librería. `app_user` se provisiona por orquestación app-side (Server Action de signup) + guard JIT idempotente `ensureAppUser`, **no** por hook/trigger (Neon Auth gestionado, sin webhooks) — canónico en ADR-0006.
- **Clients OIDC = solo custom domains (decidido: uno por dominio).** `*.place.community` (subdomains + inbox) comparten la cookie cross-subdomain y **no son RPs**. Cada custom domain es un RP con su **propio client confidencial**, provisionado al verificarse el dominio y revocado al archivarlo; el link vive en `place_domain.oauth_client_id`. Topología canónica en `architecture.md` § "Sesión y SSO".
- **RLS base (ADR-0006/0010/0011).** El aislamiento entre places se enforcea en Postgres RLS por-operación, no solo en código. Identidad vía función propia `app.current_user_id()` (ADR-0011, no Neon RLS). Base: `app_user` solo accesible por su dueño (`app.current_user_id() = auth_user_id`); tablas con `place_id` solo por el owner del place (vía `place_ownership`). Acceso de miembros = por-feature encima de la base. Rol custom no-admin + JWT verificado por JWKS; sin Data API ni `anon`. Spec operativa: `docs/multi-tenancy.md` § RLS.
- **TBD acotado restante:** firma de ID tokens (RS256 vs EdDSA) la gestiona Neon Auth (`neon_auth.jwks` presente) — detalle de implementación, no afecta el modelo.

## Derecho al olvido

Decidido en **ADR-0003** (reemplaza la regla previa de 365 días por-place). Dos lifecycles independientes:

**Salir de un place** (`membership.left_at`): el contenido que creó queda en el place atribuido a su nombre (es del place); su presencia, lecturas y actividad en ese place se borran inmediatamente. Salir de un place **no** anonimiza ni libera el handle — sigue siendo el mismo `app_user` en los otros places.

**Lifecycle de cuenta** (escala de inactividad, basada en `last_active_at`):

- **6 meses** sin login → `inactivo` (solo estado derivado; sin efecto adicional).
- **12 meses** sin login → **tombstone** (`tombstoned_at`): scrub de PII (`email`, `display_name`, `avatar_url`), `handle` liberado, identidad de login de Better Auth borrada; la fila `app_user` queda como cáscara anónima "ex-miembro" para preservar los FKs de contenido. **Irreversible.** Todo su contenido (incluidos DMs) pasa a "ex-miembro"; si ambas partes de un DM están tombstoned, la conversación se elimina.
- Avisos email 30d/7d/final; login resetea `last_active_at`.
- **Exención:** la escala NO corre mientras el usuario sea owner de ≥1 place activo O tenga ≥1 pago activo (ver invariante).

**Lifecycle del place** (suscripción del owner, `subscription_status`): `ACTIVE` → `PAYMENT_PENDING` (owner no entra; solo transferir/cerrar/regularizar; avisos d0/+2/+7) → `INACTIVATION_PROCESS` (email a todos los miembros) → 20 días → `INACTIVE` → 12 meses sin regularizar → purga física del place (contenido y memberships; los DMs sobreviven en el inbox universal).

Implementado en `features/members/` y `features/places/` con cron/scheduled functions. El borrado de cuenta es operación de dos sistemas (scrub `app_user` + borrado de identidad Better Auth), ordenada. Schema de tiers por miembro y mecanismo de cobro: diferidos (ver ADR-0003 / Pagos TBD en `stack.md`).

## Convenciones

- IDs opacos, **aleatorios** y no secuenciales: `gen_random_uuid()` (UUID v4, generado por Postgres) como default de PK. No autoincrementales. Razón de seguridad: no exponer conteos de places/users ni permitir enumeración vía URLs.
- Soft delete vía `archived_at` o `left_at` en lugar de `DELETE` físico. Los hard deletes son operación explícita.
- Timestamps siempre en UTC (`TIMESTAMPTZ`). La conversión a timezone del usuario es responsabilidad del cliente.
