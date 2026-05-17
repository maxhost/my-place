// Schema del core en `public`, expresión Drizzle de docs/data-model.md.
// `neon_auth` NO se versiona acá (lo gestiona Neon Auth). Sin RLS (es S2).
import { sql } from "drizzle-orm";
import {
  jsonb,
  pgEnum,
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
export const appUser = pgTable("app_user", {
  id: id(),
  authUserId: text("auth_user_id").notNull().unique(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  handle: text("handle").notNull().unique(),
  avatarUrl: text("avatar_url"),
  lastActiveAt: tstz("last_active_at").notNull().defaultNow(),
  tombstonedAt: tstz("tombstoned_at"),
  createdAt: tstz("created_at").notNull().defaultNow(),
});

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
});

// El subdomain {slug}.place.community NO se almacena (deriva de place.slug);
// acá solo los dominios propios verificados vía Vercel.
export const placeDomain = pgTable("place_domain", {
  id: id(),
  placeId: text("place_id")
    .notNull()
    .references(() => place.id),
  domain: text("domain").notNull().unique(),
  verifiedAt: tstz("verified_at"),
  oauthClientId: text("oauth_client_id").unique(),
  createdAt: tstz("created_at").notNull().defaultNow(),
  archivedAt: tstz("archived_at"),
});

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
  (t) => [unique().on(t.userId, t.placeId)],
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
  (t) => [unique().on(t.userId, t.placeId)],
);

export const invitation = pgTable("invitation", {
  id: id(),
  placeId: text("place_id")
    .notNull()
    .references(() => place.id),
  email: text("email").notNull(),
  invitedBy: text("invited_by").notNull(),
  acceptedAt: tstz("accepted_at"),
  expiresAt: tstz("expires_at").notNull(),
  token: text("token").notNull().unique(),
});

export type { EnabledFeature, OpeningHours, ThemeConfig } from "./json-shapes";
