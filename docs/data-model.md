# Modelo de datos base

Schema del core del producto, expresado en **SQL (Postgres) ORM-agnóstico**. El método de acceso (ORM/query builder/SQL plano) está TBD; el modelo no depende de esa decisión. Cada feature agrega sus propias tablas respetando este core.

> _Última actualización: 2026-05-28 (Phase 1.A tech-debt closure — migrations 0025 FK indexes + canon `SET lock_timeout = '5s'` en migrations DDL, 0026 DROP zombie `app.lookup_user_email_by_id` superseded por 0024)._ Documento vivo: si un cambio de código altera el schema o un invariante, se actualiza **en la misma sesión** y se ajusta la fecha. El detalle de dominio es canónico en `docs/ontologia/`; este doc es su expresión en schema.

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
  description      TEXT,  -- ADR-0020 (2026-05-19): nullable y *dormida* en el MVP. No se setea desde el wizard ni se edita desde ningún UI activo; forward-compat para `/settings` futuro (mismo patrón que `opening_hours` por ADR-0007).
  -- Idioma del chrome del place (navegación, labels, mensajes del sistema). El
  -- owner lo elige al crear y lo edita en /settings; todos los miembros ven el
  -- place en este idioma sin importar cómo navegaron la zona pública. Canónico:
  -- ADR-0022 (2026-05-20). Modo "DB-based" de i18n; detalle en architecture.md
  -- § "i18n: dos modos de resolución de locale".
  default_locale   TEXT NOT NULL DEFAULT 'es'
                     CHECK (default_locale IN ('es','en','fr','pt','de','ca')),
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
  -- Slot único del owner-fundador (creador del place o quien recibió transfer
  -- de ownership). NOT NULL post back-fill de migration 0012 (ADR-0035).
  -- Inmutable salvo por `app.transfer_founder_ownership` (SECURITY DEFINER).
  -- Referencia lógica a app_user.id (sin FK hard, mismo criterio que
  -- app_user.auth_user_id → neon_auth.user.id).
  founder_user_id  TEXT NOT NULL,
  -- Cupo máximo de invitaciones concurrentes que cada miembro NO-owner del
  -- place puede crear. Owner está exento (helper `app.current_user_owns_place`
  -- bypasea el chequeo). Default 0 = comportamiento histórico ADR-0010:
  -- sólo owner invita. ADR-0037 V1 SHIP SCHEMA-ONLY — la columna existe pero
  -- `app.create_invitation` (Feature E S2, migration 0018) la ignora y mantiene
  -- gate hardcoded owner-only; V2+ agrega UI editor + counter en `membership`
  -- + gate en cuerpo de `create_invitation` + decremento on cancel/expire.
  member_invite_quota INT NOT NULL DEFAULT 0
                       CHECK (member_invite_quota >= 0),
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
  -- DEPRECATED post-ADR-0032 (Signed Ticket SSO). Queda nullable indefinidamente
  -- como deuda forward-compat: si V2 vuelve a OIDC canonical, esta columna se
  -- reutiliza. NULL en todas las filas V1 — Signed Ticket no requiere client_id
  -- per dominio (el `aud` claim del ticket = host del custom domain, validado
  -- contra `verified_at IS NOT NULL` directo).
  oauth_client_id TEXT UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at     TIMESTAMPTZ
);
```

**Cambio V1.1 (ADR-0026 + migration 0008):** el constraint `place_domain.domain UNIQUE` se reemplaza por un **partial unique index** que sólo aplica a filas activas:

```sql
ALTER TABLE place_domain DROP CONSTRAINT IF EXISTS place_domain_domain_unique;
CREATE UNIQUE INDEX place_domain_domain_active_unq
  ON place_domain (domain)
  WHERE archived_at IS NULL;
```

**Invariante:** un dominio mapea a lo sumo a un place **activo** (`archived_at IS NULL`). Filas archived liberan el dominio para re-registro por el mismo o distinto owner. El history archived queda en DB para auditoría futura; la UI nunca lo muestra (page filtra `archived_at IS NULL`).

**Estado post-ADR-0032: `oauth_client_id` queda NULL indefinidamente.** Feature C (Signed Ticket SSO, ADR-0032) **NO requiere** client OIDC per dominio — el `aud` claim del ticket ES256 = host del custom domain, validado contra `place_domain.verified_at IS NOT NULL AND archived_at IS NULL` directo en `lookupPlaceByDomain`. **ADR-0027 (prometida en ADR-0026) nunca se escribirá** — se supersede por ADR-0032 que clausura la deuda con decisión arquitectónica distinta (signed ticket en lugar de OIDC). La columna se preserva nullable como forward-compat: si V2 alguna vez vuelve a OIDC canonical (por aparición de external RPs), se reutiliza sin migration.

```sql
CREATE TABLE membership (
  id        TEXT PRIMARY KEY,
  user_id   TEXT NOT NULL REFERENCES app_user(id),
  place_id  TEXT NOT NULL REFERENCES place(id),
  -- Sin columna role: owner se deriva de place_ownership; si no, es miembro.
  -- Headline opcional ≤280 chars (ADR-0036): texto personal corto del miembro
  -- en ESTE place específico (capa 2 contextual — no viaja entre places). NULL
  -- por default; sólo el propio miembro lo edita (UPDATE acotado por
  -- user_id = caller en la Server Action `updateMyHeadlineAction`). El owner
  -- del place NO edita el headline de otros (es identidad personal, no
  -- curaduría del lugar). Render condicional en UI: bloque desaparece cuando
  -- NULL (no hay placeholder forzado). Migration 0017 (Feature E S1).
  headline  TEXT CHECK (headline IS NULL OR length(headline) <= 280),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at   TIMESTAMPTZ,
  UNIQUE (user_id, place_id)
);

-- WORM-via-DEFINER (ADR-0035 §4, Feature D V1 close 2026-05-24): tabla
-- write-once-read-many vía SECURITY DEFINER. La RLS policy `po_sel` permite
-- SELECT a los owners del place (via helper `app.current_user_owns_place`);
-- INSERT/UPDATE/DELETE están REVOKED a `app_system` (defense-in-depth) →
-- toda mutación pasa por 4 funciones `SECURITY DEFINER` que validan
-- invariantes en cuerpo:
--   - app.create_place                (CU1, migration 0013) — INSERT founder
--   - app.elevate_to_owner            (CU2, migration 0014) — INSERT co-owner
--   - app.revoke_ownership            (CU3, migration 0015) — DELETE co-owner
--   - app.transfer_founder_ownership  (CU4, migration 0016) — UPDATE founder
--                                                            + DELETE caller
-- Síntoma de drift (mutación directa por código de feature): `ERROR:
-- permission denied for table place_ownership`. Ver gotcha `docs/gotchas/
-- place-ownership-defining-functions-only.md` (a crear en S6).
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
- **Mínimo 1 owner por place activo (enforce DB-side via DEFINER).** Un place no puede quedar sin owner. Enforce vía las funciones `app.revoke_ownership` y `app.transfer_founder_ownership` (`SECURITY DEFINER`, RAISE EXCEPTION en cuerpo) + `REVOKE INSERT, UPDATE, DELETE ON place_ownership FROM "app_system"` (defense-in-depth: ninguna ruta TS llega directo a SQL). Canónico: ADR-0035 §4.
- **Founder slot único por place, no-delete por otro owner.** `place.founder_user_id` es el `app_user.id` del owner-fundador (creador o quien recibió transfer). Inmutable salvo por `app.transfer_founder_ownership` (`SECURITY DEFINER`, sólo el founder actual puede transferirlo a un owner pre-existente). Canónico: ADR-0035 §2.
- **Transfer founder requiere target owner pre-existente.** El target de `app.transfer_founder_ownership` debe ser owner actual (≥2 owners pre-transfer); si N=1 (founder solo), el caller debe elevar primero a alguien vía `app.elevate_to_owner`. Bloqueado con RAISE EXCEPTION explícito. Canónico: ADR-0035 §2/§4.
- **Multi-owner desde V1; co-owners se elevan desde miembros pre-existentes.** Un place tiene N owners simultáneos (N filas en `place_ownership` con mismo `place_id`); todos comparten poder operativo (CRUD owner-only vía policies de `place`/`membership`/`invitation`/`place_domain`). La asimetría es de origen (founder vs co-owner). `app.elevate_to_owner` requiere que el target sea miembro activo (`membership.left_at IS NULL`) del mismo place — no se puede elevar a externos. Canónico: ADR-0035 §1/§2.
- **No se pueden mezclar billing modes.** Un place tiene un solo modo activo. Cambiar de modo requiere flow explícito. (Estrategia de pagos concreta: TBD.)
- **Slug inmutable.** Ver `multi-tenancy.md`.
- **Un usuario no puede tener dos memberships activas en el mismo place.** Enforzado por unique constraint `(user_id, place_id)`.
- **Un dominio mapea a lo sumo a un place activo** (`archived_at IS NULL`). Enforzado post-V1.1 (ADR-0026 + migration 0008) por un **partial unique index** `place_domain_domain_active_unq ON place_domain (domain) WHERE archived_at IS NULL`. Filas archived liberan el dominio para re-registro. El routing por hostname (ver `multi-tenancy.md`) resuelve **solo dominios verificados** (`verified_at IS NOT NULL`, `archived_at IS NULL`).
- **Un humano = un `app_user`.** Relación 1:1 con la identidad de login de Better Auth (`app_user.auth_user_id UNIQUE`), sin importar por qué dominio entró. El SSO cross-domain no crea identidades nuevas.
- **Rol derivado, no almacenado.** Un usuario es owner de un place si existe fila en `place_ownership`; si solo tiene `membership`, es miembro. No existe rol `admin`: la administración delegada será una feature futura de grupos con permisos granulares.
- **Discusiones es la zona no-desactivable.** Es el primitivo del que derivan eventos y biblioteca; siempre está activa. Eventos y Biblioteca son zonas **opcionales** que el owner activa/desactiva desde `/settings/*` (`enabled_features`). Miembros no es una zona toggleable: los miembros existen siempre.
- **`place.default_locale` editable por el owner, fijo para todos los miembros (ADR-0022).** Default `es` al crear; el owner puede cambiarlo en `/settings` a uno de los 6 locales operativos (`es/en/fr/pt/de/ca`, enforzado por `CHECK`). NO existe locale por-miembro: todos los miembros ven el chrome del place en `place.default_locale`. La zona pública (marketing, Hub) sigue el locale del path del visitante — son dos modos distintos canónicos en `architecture.md` § "i18n: dos modos de resolución de locale".
- **Handle obligatorio y único global.** `app_user.handle NOT NULL UNIQUE`. Auto-asignado random no-usado al crear la cuenta, editable por el usuario, liberado para reuso **solo al borrar la cuenta** (no al salir de un place).
- **Exención de la escala de inactividad.** La escala 6m/12m de cuenta NO corre mientras el usuario sea owner de ≥1 place activo O tenga ≥1 pago activo. Es una condición evaluada, no un flag permanente: al dejar de cumplir ambas, la cuenta entra a la escala. Ver ADR-0003. **Post-ADR-0035:** "owner de ≥1 place activo" se interpreta literal post-multi-owner — cualquier owner (founder o co-owner) extiende la exención mientras el place esté `subscription_status IN ('ACTIVE','PAYMENT_PENDING','INACTIVATION_PROCESS')`. La revocación de ownership re-evalúa la condición.
- **Alta owner-first: cuenta y place se crean juntos (saga, no transacción única).** El alta del apex crea `app_user` (+ identidad Better Auth) y luego `place` + `place_ownership` + `membership` vía la función atómica `app.create_place` (ADR-0005, refinado por ADR-0012 — INSERT directo denegado por RLS). Una cuenta queda sin place solo si falla ese último paso (reintento, no error fatal). Excepción de diseño: alta desde invitación o "join" del directorio crea cuenta + `membership` sin crear place.
- **Place requiere suscripción del owner activa.** Sin pago, el place avanza por `subscription_status` hasta purga a los 12m. La eliminación/tombstone de un usuario que es único owner de un place activo se bloquea: primero transferir ownership o cerrar el place (extiende "mínimo 1 owner").
- **`membership.headline` ≤ 280 caracteres (ADR-0036).** Texto personal corto, opcional, contextual al place (NO viaja entre places — vive en capa 2 de identidad). Enforce DB-side vía `CHECK (headline IS NULL OR length(headline) <= 280)` + zod del action `updateMyHeadlineAction` (defense-in-depth ante drift app-side). Sólo el propio miembro lo edita (`user_id = caller`); el owner del place NO edita el headline de otros. Render condicional en UI: bloque desaparece cuando NULL.
- **`place.member_invite_quota` ≥ 0 (ADR-0037, V1 schema-only).** Cupo máximo de invitaciones concurrentes por miembro no-owner del place. Owner exento vía `app.current_user_owns_place` (cualquiera de los N owners por ADR-0035 §1). Default 0 = sólo owner invita (comportamiento histórico ADR-0010). V1 (Feature E): la columna existe pero `app.create_invitation` la IGNORA — gate hardcoded `caller is owner`. V2+ agregará UI editor + counter `membership.invitations_used` + gate por cupo en cuerpo de `create_invitation` + decremento on cancel/expire (cita literal user: "si la invitacion no fue aceptada el miembro podra eliminarla o cancelarla y volver a usarla para invitar a alguien mas").

## Capas de identidad de un usuario

Ver `docs/ontologia/miembros.md` para el detalle ontológico. En el schema:

- **Capa universal** (en `app_user`): email, display_name, handle, avatar_url
- **Capa contextual** (en `membership` + datos derivados por place): rol derivado (owner/miembro), fecha de join, contribuciones acumuladas calculadas por feature
- **Capa privada**: settings del usuario, no expuestos a otros

## Auth y SSO (Neon Auth + Signed Ticket cross-domain)

Place usa **Neon Auth** (sobre Better Auth managed) para el apex `*.place.community` y **Signed Ticket pattern** (ADR-0032, refina ADR-0001 §1) para SSO desde custom domains. NO somos OIDC IdP canónico — el plugin OIDC Provider de Better Auth no está accesible desde Neon Auth managed; `oidc-provider` (panva) requeriría ~1500-2000 LOC adapter custom (validado 2026-05-22). La topología y el flujo SSO completo son canónicos en `docs/architecture.md` § "Sesión y SSO" + `docs/decisions/0032-custom-domain-sso-signed-ticket.md`. En el schema:

- **Tablas de auth propiedad de la librería, en el schema `neon_auth`.** Verificado (2026-05-16, ADR-0005): Neon Auth provisionado con `auth_provider: better_auth`; tablas en el schema **`neon_auth`** (`user, session, account, verification, jwks` + plugin organization: `organization, member, invitation`). El core del producto va en **`public`**. El link `app_user.auth_user_id` → `neon_auth.user.id` es **referencia lógica cross-schema, sin FK hard**. **No se hand-spec-ean acá** ni se versionan en nuestras migraciones (Drizzle modela solo `public`; las gestiona Neon Auth). **No** usamos el plugin organization de Better Auth para modelar `place` — `place` vive en `public` (este schema); `neon_auth.organization/member/invitation` se ignoran para el dominio.
- **Integración con `app_user` (decidido: separada, 1:1).** `app_user` es la capa de identidad universal del producto y vive **separada** de la tabla de login de Better Auth, con link 1:1 vía `app_user.auth_user_id UNIQUE`. Razón: la anonimización del derecho al olvido opera sobre `app_user` sin tocar las tablas de auth, y el modelo de dominio no se acopla al schema de la librería. `app_user` se provisiona por orquestación app-side (Server Action de signup) + guard JIT idempotente `ensureAppUser`, **no** por hook/trigger (Neon Auth gestionado, sin webhooks) — canónico en ADR-0006.
- **SSO cross-domain via Signed Ticket (ADR-0032, post-2026-05-22).** `*.place.community` (subdomains + inbox) comparten la cookie cross-subdomain `Domain=.place.community` (Neon Auth managed) y **no requieren SSO** entre ellos. Custom domains tienen **sesión local propia**: cookie host-only `__Host-place_sso_session` con JWT ES256 (firmado por apex, TTL 7d, claims `{iss:'place.community', sub:<neon_auth.user.id>, host:<custom_domain>, kid}`). El flow init → issue → redeem usa 4 endpoints (`/api/auth/sso-init`, `/api/auth/sso-issue`, `/api/auth/sso-redeem`, `/api/auth/sso-jwks`) + tabla `app.sso_jti_used` (single-use anti-replay, GC oportunista, función `app.consume_sso_jti` SECURITY DEFINER) + cookie efímera `__Host-place_sso_state` (CSRF + nonce echo, TTL 120s, HMAC firmada con HKDF de signing key). **NO** se provisiona OIDC client per dominio — la columna `place_domain.oauth_client_id` queda NULL indefinidamente (forward-compat). Audience binding (`aud` claim del ticket vs host del redeem) + jti single-use + state cookie CSRF + open-redirect validation triple (init, issue, redeem) = defense-in-depth. Continuidad RLS: `sub` del local session = `neon_auth.user.id` → `app.current_user_id()` retorna el mismo valor cross-domain, cero refactor de policies. Topología canónica + spec detallada en `architecture.md` § "Sesión y SSO" + ADR-0032.
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

## Migrations & snapshots (convención del repo)

Las migrations viven en `src/db/migrations/*.sql` numeradas secuencialmente (`0000_*.sql` … `0026_*.sql` al momento de este doc). El runner es **drizzle-kit migrate** (script `pnpm db:migrate`), que se ejecuta automáticamente en cada production deploy via `scripts/maybe-migrate.mjs` (canon ADR-0017).

**Dos tipos de migrations conviven**:

1. **Schema-generated** (`pnpm db:generate` desde `src/db/schema/index.ts`): producen tanto el `.sql` como un snapshot en `meta/000N_snapshot.json`. Cobertura típica: `CREATE TABLE`, `ALTER TABLE`/`COLUMN`, constraints simples. Históricamente las migrations **0000-0008** se generaron así.

2. **Hand-written custom SQL**: archivos `.sql` escritos a mano + entry agregada manualmente a `meta/_journal.json`. **NO tienen snapshot** asociado en `meta/`. Cobertura típica: `CREATE POLICY` (RLS), `CREATE FUNCTION ... SECURITY DEFINER`, `GRANT`/`REVOKE`, índices custom, partial unique indexes complejos, anti-replay tables del schema `app`. Estas tomas son las **0009-0024** (y todas las futuras de este tipo). Drizzle-kit NO modela estos primitivos en su schema TS, por lo que no podría snapshotearlos de manera útil aunque se intentara.

**Esta asimetría es INTENCIONAL, no un bug**. Los snapshots ausentes 0009-0024 son consistentes con el pattern del proyecto: el ORM trackea schema-as-types (tablas + columnas + tipos), las primitivas de seguridad (policies + DEFINERs + GRANTs) viven en SQL canónico que el dev controla directamente.

### Protocolo para futuras migrations

- **Si la migration es solo cambios de tablas/columnas** (sin policies/DEFINERs/GRANTs): correr `pnpm db:generate` desde el repo root. Drizzle-kit produce el `.sql` + el snapshot + agrega entry a `_journal.json` automáticamente. Revisar el SQL generado antes de commitear (a veces hace `DROP COLUMN` inesperado).

- **Si la migration incluye RLS policies, DEFINERs, GRANTs, o SQL complejo**: escribir el `.sql` a mano (idempotente con `IF EXISTS`/`IF NOT EXISTS` donde aplique), agregar entry a `_journal.json` con el siguiente `idx` libre + `tag` matching el nombre del archivo (sin extension), `when` con timestamp ms, `version: "7"`, `breakpoints: true`. Por convención NO crear snapshot manual — el ausencia es la señal de "custom SQL, no generado".

- **Migrations destructivas** (`DROP COLUMN`, `DROP TABLE`, `ALTER COLUMN ... TYPE` que pierde datos): incluir reverse SQL en comentario al inicio del archivo (precedente: `0008_place_domain_partial_unique.sql`).

- **Canon `SET lock_timeout = '5s'` en migrations DDL**: toda migration que tome AccessExclusiveLock sobre tablas con tráfico potencial (`CREATE INDEX`, `ALTER TABLE ADD COLUMN`, `ALTER TABLE ALTER COLUMN`, `ALTER TABLE ADD CONSTRAINT` validando filas existentes, etc.) DEBE prefijarse con `SET lock_timeout = '5s';--> statement-breakpoint`. Establecido como canon transversal en migration 0025 (Phase 1.A tech-debt closure 2026-05-28). Rationale: 5s es el budget máximo aceptable por AccessExclusiveLock antes de fail-fast → evita stalls indefinidos por lock contention silenciosa (long-running query bloqueando deploy). Si la migration excede el budget, falla con SQLSTATE `55P03` (lock_not_available) → operator corre off-hours o reformula con `CREATE INDEX CONCURRENTLY`. El timeout es session-local (no requiere reverse SQL). DEFINER-only migrations (`CREATE FUNCTION`, sin DDL en tablas) no requieren el SET — el lock que toman es trivial.

- **Verify post-apply**: cada migration debería tener su integration test correspondiente en `src/db/__tests__/*.test.ts` (cobertura DEFINER ~95%, ver inventario en §"Catálogo DEFINER" abajo cuando exista — pendiente Phase 2.D).

### Rollback de migration

Drizzle-kit NO soporta rollback automático (no hay `down` migrations en el design). Para revertir:

1. **Production**: aplicar migration nueva con el SQL inverso (NO modificar la migration original ya aplicada).
2. **Dev branch Neon**: opción de reset desde parent branch via Neon dashboard (`neon branch reset`) o vía MCP.

El reverse SQL recomendado vive en comentario al inicio del `.sql` original (precedente: `0008_place_domain_partial_unique.sql:38-43`).
