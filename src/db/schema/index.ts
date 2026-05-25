// Schema del core en `public`, expresión Drizzle de docs/data-model.md.
// `neon_auth` NO se versiona acá (lo gestiona Neon Auth).
// RLS por-operación: ADR-0010 refinado por ADR-0012 (multi-tenancy.md § RLS).
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  integer,
  jsonb,
  pgEnum,
  pgPolicy,
  pgRole,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type {
  EnabledFeature,
  OpeningHours,
  ThemeConfig,
} from "./json-shapes";

// IDs opacos no secuenciales: TEXT con default gen_random_uuid() (PG17,
// sin extensión). data-model.md § Convenciones.
const id = () =>
  text("id")
    .primaryKey()
    .default(sql`(gen_random_uuid())::text`);

const tstz = (name: string) => timestamp(name, { withTimezone: true });

// Rol de runtime de queries de dominio (S0; NO-admin, sin BYPASSRLS).
// `.existing()`: drizzle-kit no lo gestiona (CREATE ROLE) — ya existe.
const appSystem = pgRole("app_system").existing();

// Predicado owner-only (ADR-0010): la fila pertenece a un place del que el
// caller es owner. El sub-SELECT sobre place_ownership aplica la policy
// no-recursiva de esa tabla (vía app_user) → termina. `placeRef` es la
// columna de la fila que apunta al place (place.id ó <tabla>.place_id).
const ownerOnly = (placeRef: AnyPgColumn) =>
  sql`EXISTS (SELECT 1 FROM place_ownership po
              JOIN app_user au ON au.id = po.user_id
              WHERE po.place_id = ${placeRef}
                AND au.auth_user_id = (select app.current_user_id()))`;

// Estrategia de pagos TBD; el enum se conserva como invariante de dominio.
export const billingMode = pgEnum("billing_mode", [
  "OWNER_PAYS",
  "OWNER_PAYS_AND_CHARGES",
  "SPLIT_AMONG_MEMBERS",
]);

// Lifecycle del place por la suscripción del owner (ADR-0003).
export const placeSubscriptionStatus = pgEnum("place_subscription_status", [
  "ACTIVE",
  "PAYMENT_PENDING",
  "INACTIVATION_PROCESS",
  "INACTIVE",
]);

// 1:1 lógico con la identidad de login de Neon Auth (sin FK hard).
export const appUser = pgTable(
  "app_user",
  {
    id: id(),
    authUserId: text("auth_user_id").notNull().unique(),
    email: text("email").notNull().unique(),
    displayName: text("display_name").notNull(),
    handle: text("handle").notNull().unique(),
    avatarUrl: text("avatar_url"),
    lastActiveAt: tstz("last_active_at").notNull().defaultNow(),
    tombstonedAt: tstz("tombstoned_at"),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  // self-only FOR ALL: incluye su INSERT (sin chicken-egg — ADR-0012 §1).
  // au_peer_member_read FOR SELECT (ADR-0038, migration 0021): extiende
  // SELECT con peer-read — el caller puede leer la fila de OTRO user si
  // ambos comparten membership activa en algún place. Postgres OR-ea ambas
  // policies para SELECT (caller lee su propia fila vía au_self + filas de
  // peers vía au_peer_member_read). INSERT/UPDATE/DELETE siguen self-only
  // porque au_peer_member_read es FOR SELECT — no aplica a mutaciones.
  // Owners ven a todos los miembros activos de su place por invariante
  // ADR-0035 §2 (owners son siempre miembros). Sin esta policy, Feature E
  // (members list + invitations) sería imposible sin DEFINER ad-hoc.
  (t) => [
    pgPolicy("au_self", {
      for: "all",
      to: appSystem,
      using: sql`(select app.current_user_id()) = ${t.authUserId}`,
      withCheck: sql`(select app.current_user_id()) = ${t.authUserId}`,
    }),
    pgPolicy("au_peer_member_read", {
      for: "select",
      to: appSystem,
      using: sql`EXISTS (
        SELECT 1
          FROM membership my_m
          JOIN app_user my_au ON my_au.id = my_m.user_id
          JOIN membership other_m ON other_m.user_id = ${t.id}
                                 AND other_m.place_id = my_m.place_id
         WHERE my_au.auth_user_id = (select app.current_user_id())
           AND my_m.left_at IS NULL
           AND other_m.left_at IS NULL
      )`,
    }),
  ],
);

export const place = pgTable("place", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  // Founder slot único, inmutable salvo `app.transfer_founder_ownership`
  // (ADR-0035 §2). Referencia lógica a `app_user.id` sin FK hard (mismo
  // criterio que `app_user.auth_user_id`, ADR-0006). Back-fill determinístico
  // `MIN(granted_at).user_id` per place en migration 0012; `app.create_place`
  // lo setea en el INSERT desde S5.
  founderUserId: text("founder_user_id").notNull(),
  // Idioma del chrome del place, editable por owner (ADR-0022, feature
  // `settings`). 6 locales operativos (ADR-0024); el CHECK constraint es
  // defense-in-depth — el zod del wizard ya valida el enum cerrado, pero la
  // DB asegura invariantes aún si el caller saltea la app layer.
  defaultLocale: text("default_locale").notNull().default("es"),
  themeConfig: jsonb("theme_config")
    .$type<ThemeConfig>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  openingHours: jsonb("opening_hours")
    .$type<OpeningHours>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  billingMode: billingMode("billing_mode").notNull(),
  subscriptionStatus: placeSubscriptionStatus("subscription_status")
    .notNull()
    .default("ACTIVE"),
  subscriptionPastDueAt: tstz("subscription_past_due_at"),
  trialEndsAt: tstz("trial_ends_at"),
  enabledFeatures: jsonb("enabled_features")
    .$type<EnabledFeature[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  createdAt: tstz("created_at").notNull().defaultNow(),
  archivedAt: tstz("archived_at"),
  // Cupo configurable de invitaciones por miembro (ADR-0037 §1, migration
  // 0017). V1 schema-only: la columna existe pero no se consume en runtime
  // (gate de `app.create_invitation` queda hardcoded owner-only V1, ADR-0037
  // §4). V2+ agrega UI editor + counter `membership.invitations_used` + gate.
  // DEFAULT 0 preserva el comportamiento histórico pre-ADR-0037. El CHECK
  // `>= 0` es defense-in-depth — el zod del UI V2+ ya validará no-negativo,
  // pero la DB asegura el invariante aún si el caller saltea la app layer.
  memberInviteQuota: integer("member_invite_quota").notNull().default(0),
},
  // INSERT: sin policy (denegado por construcción + REVOKE en la migración —
  // la creación va por app.create_place, ADR-0012 §1). SELECT/UPDATE/DELETE
  // owner-only.
  (t) => [
    pgPolicy("place_sel", { for: "select", to: appSystem, using: ownerOnly(t.id) }),
    pgPolicy("place_upd", { for: "update", to: appSystem, using: ownerOnly(t.id) }),
    pgPolicy("place_del", { for: "delete", to: appSystem, using: ownerOnly(t.id) }),
    check(
      "place_default_locale_check",
      sql`${t.defaultLocale} IN ('es', 'en', 'fr', 'pt', 'de', 'ca')`,
    ),
    check(
      "place_member_invite_quota_nonneg_chk",
      sql`${t.memberInviteQuota} >= 0`,
    ),
  ],
);

// El subdomain {slug}.place.community NO se almacena (deriva de place.slug);
// acá solo los dominios propios verificados vía Vercel.
//
// ADR-0026 (2026-05-21): la unicidad de `domain` es PARCIAL — sólo aplica a
// filas activas (`archived_at IS NULL`). Habilita que un dominio archivado
// pueda volver a registrarse (mismo place tras "remover", u otro place del
// mismo owner en un cambio de marca), sin perder el invariante "a lo sumo un
// dominio activo por valor". El index `place_domain_domain_active_unq` es
// contractual con la Server Action `registerCustomDomain` (S3): la UNIQUE
// violation (PG `23505`) se mapea a `RegisterError.domain_taken`.
export const placeDomain = pgTable(
  "place_domain",
  {
    id: id(),
    placeId: text("place_id")
      .notNull()
      .references(() => place.id),
    domain: text("domain").notNull(),
    verifiedAt: tstz("verified_at"),
    oauthClientId: text("oauth_client_id").unique(),
    createdAt: tstz("created_at").notNull().defaultNow(),
    archivedAt: tstz("archived_at"),
  },
  // owner-only FOR ALL (place+ownership ya existen → sin chicken-egg).
  // Entra al conjunto owner-only por ADR-0012 §2.
  (t) => [
    pgPolicy("place_domain_all", {
      for: "all",
      to: appSystem,
      using: ownerOnly(t.placeId),
      withCheck: ownerOnly(t.placeId),
    }),
    uniqueIndex("place_domain_domain_active_unq")
      .on(t.domain)
      .where(sql`archived_at IS NULL`),
  ],
);

// Sin columna role: owner se deriva de place_ownership; si no, es miembro.
export const membership = pgTable(
  "membership",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => appUser.id),
    placeId: text("place_id")
      .notNull()
      .references(() => place.id),
    joinedAt: tstz("joined_at").notNull().defaultNow(),
    leftAt: tstz("left_at"),
    // Bio contextual opcional per place (ADR-0036, migration 0017). Refina
    // ontologia/miembros.md §"Identidad contextual (capa 2)" — el corazón
    // de la identidad sigue siendo la contribución; el headline es un
    // complemento opcional ≤280 chars. Edición SELF-ONLY: el owner NO edita
    // headlines ajenos (ADR-0036 §3). El UPDATE va vía DEFINER
    // `app.update_my_headline` (spec.md §"Decisión operativa" — column
    // exposure isolation), NO vía UPDATE directo.
    headline: text("headline"),
  },
  // INSERT: sin policy (denegado + REVOKE — vía app.create_place, ADR-0012 §1).
  (t) => [
    unique().on(t.userId, t.placeId),
    pgPolicy("membership_sel", { for: "select", to: appSystem, using: ownerOnly(t.placeId) }),
    pgPolicy("membership_upd", { for: "update", to: appSystem, using: ownerOnly(t.placeId) }),
    pgPolicy("membership_del", { for: "delete", to: appSystem, using: ownerOnly(t.placeId) }),
    check(
      "membership_headline_length_chk",
      sql`${t.headline} IS NULL OR length(${t.headline}) <= 280`,
    ),
  ],
);

export const placeOwnership = pgTable(
  "place_ownership",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => appUser.id),
    placeId: text("place_id")
      .notNull()
      .references(() => place.id),
    grantedAt: tstz("granted_at").notNull().defaultNow(),
  },
  // WORM-via-DEFINER (ADR-0035 §3 + §4, migration 0012): toda mutación
  // (INSERT/UPDATE/DELETE) está denegada por REVOKE explícito a `app_system`
  // y canalizada por las 4 funciones DEFINER (`app.create_place`,
  // `app.elevate_to_owner`, `app.revoke_ownership`,
  // `app.transfer_founder_ownership`). Sólo `po_sel` via helper
  // `app.current_user_owns_place` SECURITY DEFINER (anti-recursión: el
  // sub-SELECT a `place_ownership` desde una policy sobre la propia tabla
  // daría `infinite recursion`; el DEFINER bypassa la propia RLS).
  (t) => [
    unique().on(t.userId, t.placeId),
    pgPolicy("po_sel", {
      for: "select",
      to: appSystem,
      using: sql`app.current_user_owns_place(${t.placeId})`,
    }),
  ],
);

export const invitation = pgTable(
  "invitation",
  {
    id: id(),
    placeId: text("place_id")
      .notNull()
      .references(() => place.id),
    email: text("email").notNull(),
    invitedBy: text("invited_by").notNull(),
    acceptedAt: tstz("accepted_at"),
    expiresAt: tstz("expires_at").notNull(),
    token: text("token").notNull().unique(),
  },
  // 100% owner-only FOR ALL (ADR-0010 §2): el owner crea/lista/revoca; la
  // ACEPTACIÓN no pasa por esta RLS (función SECURITY DEFINER aparte, S6).
  (t) => [
    pgPolicy("invitation_all", {
      for: "all",
      to: appSystem,
      using: ownerOnly(t.placeId),
      withCheck: ownerOnly(t.placeId),
    }),
  ],
);

export type { EnabledFeature, OpeningHours, ThemeConfig } from "./json-shapes";
