-- ADR-0011: función de identidad RLS PROPIA (no Neon RLS), ahora versionada.
-- Idempotente (IF NOT EXISTS / CREATE OR REPLACE): ya existe en dev/test desde
-- S0; esto la materializa en la migración para que dev→prod la lleve consigo.
-- Corre como neondb_owner (DATABASE_URL_MIGRATE), nunca el runtime app_system.
CREATE SCHEMA IF NOT EXISTS "app";--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub' $$;--> statement-breakpoint
GRANT USAGE ON SCHEMA "app" TO "app_system";--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.current_user_id() TO "app_system";--> statement-breakpoint
CREATE TYPE "public"."billing_mode" AS ENUM('OWNER_PAYS', 'OWNER_PAYS_AND_CHARGES', 'SPLIT_AMONG_MEMBERS');--> statement-breakpoint
CREATE TYPE "public"."place_subscription_status" AS ENUM('ACTIVE', 'PAYMENT_PENDING', 'INACTIVATION_PROCESS', 'INACTIVE');--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"auth_user_id" text NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"handle" text NOT NULL,
	"avatar_url" text,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tombstoned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_user_auth_user_id_unique" UNIQUE("auth_user_id"),
	CONSTRAINT "app_user_email_unique" UNIQUE("email"),
	CONSTRAINT "app_user_handle_unique" UNIQUE("handle")
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"place_id" text NOT NULL,
	"email" text NOT NULL,
	"invited_by" text NOT NULL,
	"accepted_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	CONSTRAINT "invitation_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "membership" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"user_id" text NOT NULL,
	"place_id" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	CONSTRAINT "membership_user_id_place_id_unique" UNIQUE("user_id","place_id")
);
--> statement-breakpoint
CREATE TABLE "place" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"theme_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"opening_hours" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"billing_mode" "billing_mode" NOT NULL,
	"subscription_status" "place_subscription_status" DEFAULT 'ACTIVE' NOT NULL,
	"subscription_past_due_at" timestamp with time zone,
	"trial_ends_at" timestamp with time zone,
	"enabled_features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "place_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "place_domain" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"place_id" text NOT NULL,
	"domain" text NOT NULL,
	"verified_at" timestamp with time zone,
	"oauth_client_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "place_domain_domain_unique" UNIQUE("domain"),
	CONSTRAINT "place_domain_oauth_client_id_unique" UNIQUE("oauth_client_id")
);
--> statement-breakpoint
CREATE TABLE "place_ownership" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"user_id" text NOT NULL,
	"place_id" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "place_ownership_user_id_place_id_unique" UNIQUE("user_id","place_id")
);
--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_place_id_place_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."place"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_place_id_place_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."place"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_domain" ADD CONSTRAINT "place_domain_place_id_place_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."place"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_ownership" ADD CONSTRAINT "place_ownership_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_ownership" ADD CONSTRAINT "place_ownership_place_id_place_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."place"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Runtime usa el rol no-admin `app_system` (S0). Grants explícitos por tabla
-- del core: la migración es self-contained, no depende del timing de DEFAULT
-- PRIVILEGES por-branch. Idempotente. RLS por-operación se agrega en S2.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "app_user", "invitation", "membership", "place", "place_domain", "place_ownership" TO "app_system";