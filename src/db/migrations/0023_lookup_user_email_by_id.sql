-- Feature E — Invite Accept Flow V1.2 · Sesión D.fix (ADR-0046 §"Addendum
-- operacional — Sesión D", 2026-05-27).
--
-- Lookup ANONYMOUS del email del user identificado por `neon_auth.user.id`
-- (== `claims.sub` del JWT, ambos en apex y en custom domain — ADR-0032 §6
-- garantiza continuidad: el `sub` del local session JWT === el `sub` del
-- Neon Auth JWT que el apex verificó en `sso-issue`). Habilita la lectura
-- de identidad RSC zone-aware: helper `getCurrentUserEmailForRequest`
-- (`src/shared/lib/current-user-email.ts`) consume este lookup via
-- `getAuthenticatedDbForRequest` (ADR-0034 coordinator) — funciona idéntico
-- en apex/subdomain/inbox (cookie Neon Auth) y en custom domain (cookie SSO
-- local), cerrando el gap de la única RSC pre-Sesión-D que leía Neon Auth
-- SDK directo (`invite/[token]/page.tsx:74`).
--
-- ## Por qué este lookup existe (bug E2E V1.2 detectado 2026-05-27)
--
-- Smoke matriz 2x2 V1.2 reveló bug: invite flow en place CON custom domain
-- completa la cadena SSO chain (init→issue→redeem mintea cookie local en
-- `nocodecompany.co`) pero el invite page renderiza variant "unauth" (CTAs
-- login/signup) en lugar de variant "match" (CTA Aceptar). Causa raíz:
-- `getCurrentUserEmail()` del page (pre-D.fix) usaba `getAuth().getSession()`
-- (Neon Auth SDK) que SOLO lee la cookie cross-subdomain `Domain=.place.
-- community` — NO la cookie local SSO `__Host-place_sso_session`. En custom
-- domain → null → render "unauth". ADR-0046 §D6 verificó el path de la
-- ACTION (`acceptInvitationAction` usa coordinator ADR-0034) pero NO el path
-- del READER del page RSC; ese gap se cerró en D.fix con un helper RSC
-- zone-aware que consume este DEFINER.
--
-- ## Por qué DEFINER (no GRANT direct sobre neon_auth.user)
--
-- Verificado empíricamente 2026-05-27 que `app_system` por default NO tiene
-- GRANTs sobre `neon_auth.user` (managed por Neon Auth). Dos opciones para
-- habilitar el lookup desde `app_system`:
--   - GRANT direct: `GRANT SELECT (id, email) ON neon_auth.user TO app_system`.
--     Simple (2 LOC) pero rompe el invariante implícito "DB access cross-
--     schema usa DEFINER" del codebase (precedente: 0009/0010/0022). Además
--     riesgo de revoke por futuras migraciones del Neon Auth managed schema.
--   - DEFINER wrapper en `app` schema (este archivo): paridad de pattern con
--     0022 (Sesión A) que cerró el mismo tipo de gap para cross-schema lookup
--     anónimo (place→domain). El DEFINER está owned by `neondb_owner` (dueño
--     del DB), que TIENE SELECT sobre `neon_auth.user` (acceso administrativo);
--     ejecuta con privs del owner, NO del caller `app_system`. Aislado de
--     cambios futuros en Neon Auth managed schema.
--
-- D.fix.1 eligió DEFINER por paridad con 0022 + defense-in-depth (sólo
-- expone id → email, no banned/role/image/createdAt — no GRANT amplio).
--
-- ## Espejo estructural de 0010 (`app.lookup_place_locale_by_slug`)
--
-- Pattern DEFINER + payload text escalar (NO jsonb). Difiere de 0010 sólo en:
--   - input: `uuid` (el `neon_auth.user.id` es UUID por design Better Auth)
--     en lugar de text slug.
--   - tabla base: `neon_auth."user"` (managed externo) en lugar de `public.
--     place`. Quoted identifier `"user"` obligatorio (reserved word PG).
--   - search_path: `neon_auth, pg_temp` (no `public`) — la tabla `user`
--     vive en schema `neon_auth`; el search_path canónico de la función
--     resuelve "user" → `neon_auth.user` sin schema prefix en el body.
--
-- ## Invariantes
--
-- 1. **search_path fijo** (`neon_auth, pg_temp`): anti-hijack obligatorio en
--    DEFINER. Si un caller cambia el search_path, la ref `"user"` sin schema
--    sigue apuntando a `neon_auth.user`.
-- 2. **STABLE**: no modifica DB, sólo lee. Habilita inlining del optimizer.
-- 3. **`id = p_id` (UUID match)**: igualdad directa, no normalización. UUID
--    no tiene casing (representación canónica lowercase + dashes); el formato
--    es enforced por el tipo `uuid` PG (parse error si p_id no es UUID válido).
-- 4. **LIMIT 1**: defense-in-depth. `neon_auth.user.id` es PRIMARY KEY → ≤1
--    fila por id garantizado por constraint. LIMIT 1 = redundante explícito
--    paralelo a 0010/0022 + cubre drift histórico ante restore parcial.
-- 5. **Payload `text` escalar**: shape de 1 valor (email). Wrapper TS
--    (`src/shared/lib/user-email-by-id-lookup.ts`) parsea con Zod
--    `z.string().min(1)` — defense-in-depth ante NULL inesperado o tipo no-
--    string. Renombre NO aplica (no hay snake_case en text escalar).
-- 6. **EXECUTE concedido SÓLO a `app_system`** (REVOKE FROM PUBLIC + GRANT
--    TO app_system): rol PUBLIC nunca puede invocarla, ni siquiera si Neon
--    agregara un nuevo rol de tercero. `app_system` es el rol runtime canon
--    (ADR-0011) — ya tiene USAGE sobre schema app desde 0000.
-- 7. **id inexistente → NULL** (no exception): caller (`user-email-by-id-
--    lookup.ts`) trata NULL = "no hay user con ese id" → integrator
--    (`current-user-email.ts`) propaga null → invite page renderiza variant
--    "unauth" (mismo UX que pre-D.fix para apex anónimo). Defense-in-depth:
--    NO distingue "id no existe" de "sesión vencida" desde afuera (cero leak
--    sobre existencia del user).
-- 8. **NO expone columnas adicionales** (`banned`, `role`, `image`,
--    `emailVerified`, `createdAt`): el caller obtiene SÓLO email. Si futura
--    feature necesita `banned` o `role`, agregar DEFINER específico (NO
--    extender éste, NO dar GRANT amplio).
--
-- ## Reverse SQL (rollback puntual)
--
--   REVOKE EXECUTE ON FUNCTION app.lookup_user_email_by_id(uuid) FROM "app_system";
--   DROP FUNCTION IF EXISTS app.lookup_user_email_by_id(uuid);
--
-- Sin caveats: la función es read-only, no deja efecto residual.
CREATE OR REPLACE FUNCTION app.lookup_user_email_by_id(p_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = neon_auth, pg_temp
AS $$
  SELECT email
  FROM "user"
  WHERE id = p_id
  LIMIT 1;
$$;--> statement-breakpoint
-- EXECUTE solo `app_system` (no PUBLIC): la lookup nunca es invocable por
-- un rol no previsto. Idempotente (drizzle re-aplica en cada branch nuevo).
REVOKE EXECUTE ON FUNCTION app.lookup_user_email_by_id(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.lookup_user_email_by_id(uuid) TO "app_system";
