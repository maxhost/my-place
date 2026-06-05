-- Phase 3.B (tech-debt pre-V1.3) — DB polish: hardening del surface RLS/DEFINER.
-- Tres cambios de defense-in-depth + consistencia, SIN diff de schema (Drizzle
-- no modela FORCE RLS / search_path / volatility → hand-written + entry manual
-- en _journal.json, convención del repo; data-model.md §"Migrations &
-- snapshots"). Idempotente.
--
-- ## Diagnóstico empírico previo (test branch br-withered-darkness-apz87zyz, 2026-06-05)
--
--   · `neondb_owner.rolbypassrls = true` (verificado vía pg_roles). Por eso el
--     FORCE RLS de §1 es INERTE para el owner: el atributo BYPASSRLS gana sobre
--     FORCE → los 18 DEFINER que corren como neondb_owner siguen escribiendo
--     sobre las tablas WORM sin evaluar policies. CERO regresión en los write
--     paths (create_place, accept_invitation, elevate_to_owner, …). El valor de
--     FORCE es future-proofing: si una tabla del core pasara a ser owned por un
--     rol SIN bypassrls (o una futura migration corriera DML como un owner así),
--     RLS seguiría aplicando en vez de bypasearse silenciosamente.
--   · Las 6 tablas del core owned por neondb_owner; `relforcerowsecurity = false`
--     pre-migration (este archivo lo pone true).
--   · `app.current_user_id()` tenía `proconfig = NULL` (sin search_path fijo).
--   · create_place(×2 aridades), invitation_preview, accept_invitation ya eran
--     VOLATILE en runtime (`provolatile = 'v'`, default de plpgsql); §3 lo hace
--     EXPLÍCITO en la historia forward, consistente con los DEFINER 0014+.
--
-- ## Reverse SQL (rollback puntual; drizzle-kit no soporta `down`)
--
--   ALTER TABLE "app_user"        NO FORCE ROW LEVEL SECURITY;
--   ALTER TABLE "invitation"      NO FORCE ROW LEVEL SECURITY;
--   ALTER TABLE "membership"      NO FORCE ROW LEVEL SECURITY;
--   ALTER TABLE "place"           NO FORCE ROW LEVEL SECURITY;
--   ALTER TABLE "place_domain"    NO FORCE ROW LEVEL SECURITY;
--   ALTER TABLE "place_ownership" NO FORCE ROW LEVEL SECURITY;
--   ALTER FUNCTION app.current_user_id() RESET search_path;
--   -- (la volatility ya era 'v' por default; no requiere reverse)

-- AccessExclusiveLock budget canon (data-model.md §"Protocolo para futuras
-- migrations"). Session-local, sin reverse. Los ALTER TABLE FORCE toman
-- AccessExclusiveLock breve; los ALTER FUNCTION toman lock trivial.
SET lock_timeout = '5s';--> statement-breakpoint

-- ── §1. FORCE ROW LEVEL SECURITY en las 6 tablas del core ──────────────────
-- Defense-in-depth contra una futura migration o rol que escriba como table
-- owner sin BYPASSRLS. Inerte hoy (owner = neondb_owner CON el atributo).
-- Idempotente: re-FORCE sobre tabla ya forzada es no-op.
ALTER TABLE "app_user"        FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invitation"      FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "membership"      FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "place"           FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "place_domain"    FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "place_ownership" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- ── §2. search_path fijo en app.current_user_id() (def. en migration 0000) ──
-- Es SECURITY INVOKER + STABLE SQL y referencia SÓLO built-ins de pg_catalog
-- (nullif, current_setting, cast ::jsonb, operador ->>) → `pg_catalog, pg_temp`
-- es el anti-hijack más ajustado: ningún schema de usuario puede sombrear los
-- built-ins, y pg_temp va último para que objetos temporales no shadoween.
-- NO incluye `public` a propósito (la función no referencia nada de public).
-- ALTER (no CREATE OR REPLACE) → cambia sólo el atributo, sin re-declarar el
-- cuerpo: cero riesgo de drift vs el canon de 0000.
ALTER FUNCTION app.current_user_id() SET search_path = pg_catalog, pg_temp;--> statement-breakpoint

-- ── §3. VOLATILE explícito en los 4 DEFINER de la era 0002/0003/0007/0013 ───
-- Cuerpos canónicos actuales: create_place (×2 aridades) en 0013; las de
-- invitación en 0003. Ya eran VOLATILE por el default de plpgsql; el ALTER lo
-- hace explícito en la historia forward, consistente con los DEFINER 0014+ que
-- lo declaran en su CREATE. Runtime no-op (`provolatile` ya = 'v'); cero drift
-- de cuerpo (ALTER toca sólo el flag, no re-pega los ~80 LOC del body).
ALTER FUNCTION app.create_place(text,text,text,jsonb,jsonb)      VOLATILE;--> statement-breakpoint
ALTER FUNCTION app.create_place(text,text,text,jsonb,jsonb,text) VOLATILE;--> statement-breakpoint
ALTER FUNCTION app.invitation_preview(text)                      VOLATILE;--> statement-breakpoint
ALTER FUNCTION app.accept_invitation(text)                       VOLATILE;
