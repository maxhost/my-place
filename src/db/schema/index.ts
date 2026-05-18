// Schema del core en `public`, expresión Drizzle de docs/data-model.md.
// `neon_auth` NO se versiona acá (lo gestiona Neon Auth).
// RLS por-operación: ADR-0010 refinado por ADR-0012 (multi-tenancy.md § RLS).
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  jsonb,
  pgEnum,
  pgPolicy,
  pgRole,
  pgTable,
  text,
  timestamp,
  unique,
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
  (t) => [
    pgPolicy("au_self", {
      for: "all",
      to: appSystem,
      using: sql`(select app.current_user_id()) = ${t.authUserId}`,
      withCheck: sql`(select app.current_user_id()) = ${t.authUserId}`,
    }),
  ],
);

export const place = pgTable("place", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
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
},
  // INSERT: sin policy (denegado por construcción + REVOKE en la migración —
  // la creación va por app.create_place, ADR-0012 §1). SELECT/UPDATE/DELETE
  // owner-only.
  (t) => [
    pgPolicy("place_sel", { for: "select", to: appSystem, using: ownerOnly(t.id) }),
    pgPolicy("place_upd", { for: "update", to: appSystem, using: ownerOnly(t.id) }),
    pgPolicy("place_del", { for: "delete", to: appSystem, using: ownerOnly(t.id) }),
  ],
);

// El subdomain {slug}.place.community NO se almacena (deriva de place.slug);
// acá solo los dominios propios verificados vía Vercel.
export const placeDomain = pgTable(
  "place_domain",
  {
    id: id(),
    placeId: text("place_id")
      .notNull()
      .references(() => place.id),
    domain: text("domain").notNull().unique(),
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
  },
  // INSERT: sin policy (denegado + REVOKE — vía app.create_place, ADR-0012 §1).
  (t) => [
    unique().on(t.userId, t.placeId),
    pgPolicy("membership_sel", { for: "select", to: appSystem, using: ownerOnly(t.placeId) }),
    pgPolicy("membership_upd", { for: "update", to: appSystem, using: ownerOnly(t.placeId) }),
    pgPolicy("membership_del", { for: "delete", to: appSystem, using: ownerOnly(t.placeId) }),
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
  // INSERT: sin policy (denegado + REVOKE — vía app.create_place, ADR-0012 §1).
  // SELECT/UPDATE/DELETE recursion-safe: referencian app_user, NUNCA
  // place_ownership (la auto-referencia da `infinite recursion`, ADR-0012 §2).
  (t) => [
    unique().on(t.userId, t.placeId),
    pgPolicy("po_sel", {
      for: "select",
      to: appSystem,
      using: sql`EXISTS (SELECT 1 FROM app_user au WHERE au.id = ${t.userId} AND au.auth_user_id = (select app.current_user_id()))`,
    }),
    pgPolicy("po_upd", {
      for: "update",
      to: appSystem,
      using: sql`EXISTS (SELECT 1 FROM app_user au WHERE au.id = ${t.userId} AND au.auth_user_id = (select app.current_user_id()))`,
    }),
    pgPolicy("po_del", {
      for: "delete",
      to: appSystem,
      using: sql`EXISTS (SELECT 1 FROM app_user au WHERE au.id = ${t.userId} AND au.auth_user_id = (select app.current_user_id()))`,
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
