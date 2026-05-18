ALTER TABLE "app_user" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invitation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "membership" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "place" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "place_domain" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "place_ownership" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "au_self" ON "app_user" AS PERMISSIVE FOR ALL TO "app_system" USING ((select app.current_user_id()) = "app_user"."auth_user_id") WITH CHECK ((select app.current_user_id()) = "app_user"."auth_user_id");--> statement-breakpoint
CREATE POLICY "invitation_all" ON "invitation" AS PERMISSIVE FOR ALL TO "app_system" USING (EXISTS (SELECT 1 FROM place_ownership po
              JOIN app_user au ON au.id = po.user_id
              WHERE po.place_id = "invitation"."place_id"
                AND au.auth_user_id = (select app.current_user_id()))) WITH CHECK (EXISTS (SELECT 1 FROM place_ownership po
              JOIN app_user au ON au.id = po.user_id
              WHERE po.place_id = "invitation"."place_id"
                AND au.auth_user_id = (select app.current_user_id())));--> statement-breakpoint
CREATE POLICY "membership_sel" ON "membership" AS PERMISSIVE FOR SELECT TO "app_system" USING (EXISTS (SELECT 1 FROM place_ownership po
              JOIN app_user au ON au.id = po.user_id
              WHERE po.place_id = "membership"."place_id"
                AND au.auth_user_id = (select app.current_user_id())));--> statement-breakpoint
CREATE POLICY "membership_upd" ON "membership" AS PERMISSIVE FOR UPDATE TO "app_system" USING (EXISTS (SELECT 1 FROM place_ownership po
              JOIN app_user au ON au.id = po.user_id
              WHERE po.place_id = "membership"."place_id"
                AND au.auth_user_id = (select app.current_user_id())));--> statement-breakpoint
CREATE POLICY "membership_del" ON "membership" AS PERMISSIVE FOR DELETE TO "app_system" USING (EXISTS (SELECT 1 FROM place_ownership po
              JOIN app_user au ON au.id = po.user_id
              WHERE po.place_id = "membership"."place_id"
                AND au.auth_user_id = (select app.current_user_id())));--> statement-breakpoint
CREATE POLICY "place_sel" ON "place" AS PERMISSIVE FOR SELECT TO "app_system" USING (EXISTS (SELECT 1 FROM place_ownership po
              JOIN app_user au ON au.id = po.user_id
              WHERE po.place_id = "place"."id"
                AND au.auth_user_id = (select app.current_user_id())));--> statement-breakpoint
CREATE POLICY "place_upd" ON "place" AS PERMISSIVE FOR UPDATE TO "app_system" USING (EXISTS (SELECT 1 FROM place_ownership po
              JOIN app_user au ON au.id = po.user_id
              WHERE po.place_id = "place"."id"
                AND au.auth_user_id = (select app.current_user_id())));--> statement-breakpoint
CREATE POLICY "place_del" ON "place" AS PERMISSIVE FOR DELETE TO "app_system" USING (EXISTS (SELECT 1 FROM place_ownership po
              JOIN app_user au ON au.id = po.user_id
              WHERE po.place_id = "place"."id"
                AND au.auth_user_id = (select app.current_user_id())));--> statement-breakpoint
CREATE POLICY "place_domain_all" ON "place_domain" AS PERMISSIVE FOR ALL TO "app_system" USING (EXISTS (SELECT 1 FROM place_ownership po
              JOIN app_user au ON au.id = po.user_id
              WHERE po.place_id = "place_domain"."place_id"
                AND au.auth_user_id = (select app.current_user_id()))) WITH CHECK (EXISTS (SELECT 1 FROM place_ownership po
              JOIN app_user au ON au.id = po.user_id
              WHERE po.place_id = "place_domain"."place_id"
                AND au.auth_user_id = (select app.current_user_id())));--> statement-breakpoint
CREATE POLICY "po_sel" ON "place_ownership" AS PERMISSIVE FOR SELECT TO "app_system" USING (EXISTS (SELECT 1 FROM app_user au WHERE au.id = "place_ownership"."user_id" AND au.auth_user_id = (select app.current_user_id())));--> statement-breakpoint
CREATE POLICY "po_upd" ON "place_ownership" AS PERMISSIVE FOR UPDATE TO "app_system" USING (EXISTS (SELECT 1 FROM app_user au WHERE au.id = "place_ownership"."user_id" AND au.auth_user_id = (select app.current_user_id())));--> statement-breakpoint
CREATE POLICY "po_del" ON "place_ownership" AS PERMISSIVE FOR DELETE TO "app_system" USING (EXISTS (SELECT 1 FROM app_user au WHERE au.id = "place_ownership"."user_id" AND au.auth_user_id = (select app.current_user_id())));--> statement-breakpoint
-- ADR-0012 §1: place/place_ownership/membership NO tienen policy de INSERT →
-- el INSERT directo ya queda denegado por RLS. El REVOKE es defense-in-depth
-- explícito (drizzle-kit no modela REVOKE; se versiona a mano, como los GRANT
-- de 0000). Idempotente: revocar un grant inexistente es no-op. La creación
-- va SOLO por app.create_place (S3). app_system conserva SELECT/UPDATE/DELETE.
REVOKE INSERT ON TABLE "place", "place_ownership", "membership" FROM "app_system";