-- Feature E — Invite Accept Flow V1.2 · Sesión D.fix.3 (ADR-0046 §"Addendum
-- operacional — Sesión D.fix.3", 2026-05-27).
--
-- Lookup ANONYMOUS de la identidad mínima (email + name) del user identificado
-- por `neon_auth.user.id` (== `claims.sub` del JWT, ambos en apex y en custom
-- domain — ADR-0032 §6 garantiza continuidad: el `sub` del local session JWT
-- === el `sub` del Neon Auth JWT que el apex verificó en `sso-issue`).
--
-- Habilita la lectura UNIFICADA de identidad zone-aware desde Server Actions
-- y RSCs: helper `getCurrentUserIdentityForRequest`
-- (`src/shared/lib/current-user-identity.ts`) consume este lookup via
-- `getAuthenticatedDbForRequest` (ADR-0034 coordinator). Funciona idéntico en
-- apex/subdomain/inbox (cookie Neon Auth) y en custom domain (cookie SSO
-- local), cerrando el gap del último callsite de `getAuth().getSession()` con
-- riesgo zone-aware: `acceptInvitationAction` (D.fix.3.b).
--
-- ## Por qué este lookup existe (bug B confirmado smoke V1.2 Sesión D)
--
-- Smoke matriz 2x2 V1.2 2026-05-27 reveló bug B: en place CON custom domain,
-- el invite page render OK (D.fix.2 cerró el reader), pero al hacer click en
-- "Aceptar invitación" → action retorna "Algo salió mal". Causa raíz:
-- `acceptInvitationAction` (`src/features/invitations/actions/accept-
-- invitation.ts:66-71`) leía identidad via `getAuth().getSession()` —
-- mismo gap arquitectónico que D.fix.1 cerró para el reader RSC, ahora
-- replicado en una Server Action que ejecuta desde custom domain.
--
-- ## Por qué un DEFINER nuevo (no extender 0023)
--
-- 0023 retorna SOLO email (text escalar). Si extendiéramos 0023 a retornar
-- `{email, name}` jsonb, romperíamos el contrato del wrapper `lookupUser
-- EmailById` (Zod parse text → falla parse jsonb). Pattern 0023 + 0024 sigue
-- canon de "DEFINER específico por superficie" (precedente 0009 vs 0010 vs
-- 0022 — cada lookup anónimo es su propia función con shape ajustado a su
-- caller). D.fix.3.b DELETE de 0023 y su wrapper (supersede por 0024) cuando
-- el integrator `getCurrentUserEmailForRequest` migra a usar 0024 via el
-- nuevo integrator `getCurrentUserIdentityForRequest`.
--
-- ## Por qué DEFINER (no GRANT direct sobre neon_auth.user)
--
-- Mismo razonamiento que 0023 (verificado empíricamente 2026-05-27): `app_
-- system` por default NO tiene GRANTs sobre `neon_auth.user`. DEFINER wrapper
-- en `app` schema mantiene paridad con 0022/0023 + defense-in-depth (expone
-- SÓLO email + name, no banned/role/image/emailVerified/createdAt — no GRANT
-- amplio). El DEFINER está owned by `neondb_owner` (dueño del DB, tiene
-- SELECT sobre `neon_auth.user` por acceso administrativo) y ejecuta con
-- privs del owner, NO del caller `app_system`.
--
-- ## Espejo estructural de 0023 + 0009
--
-- Pattern DEFINER + payload jsonb (no text escalar): difiere de 0023 sólo
-- en el shape del payload (2 campos `email`+`name` en lugar de 1 escalar
-- `email`). Paridad con 0009 (jsonb shape `{place_id, slug, default_locale}`):
--   - input: `uuid` (igual que 0023).
--   - tabla base: `neon_auth."user"` (igual que 0023, schema managed externo).
--     Quoted identifier `"user"` obligatorio (reserved word PG).
--   - search_path: `neon_auth, pg_temp` (igual que 0023).
--   - return type: jsonb (igual que 0009) en lugar de text escalar (0023).
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
--    paralelo a 0010/0022/0023 + cubre drift histórico ante restore parcial.
-- 5. **Payload jsonb `{email, name}`**: shape estable. Wrapper TS
--    (`src/shared/lib/user-identity-by-id-lookup.ts`) parsea con Zod
--    `z.object({email: z.string().min(1), name: z.string()})` — defense-in-
--    depth ante drift de schema. El `name` es NOT NULL en `neon_auth.user`
--    (Better Auth schema), por eso `z.string()` sin `.nullable()`.
-- 6. **EXECUTE concedido SÓLO a `app_system`** (REVOKE FROM PUBLIC + GRANT
--    TO app_system): rol PUBLIC nunca puede invocarla. `app_system` es el rol
--    runtime canon (ADR-0011) — ya tiene USAGE sobre schema app desde 0000.
-- 7. **id inexistente → NULL** (no exception): la query interna `SELECT
--    jsonb_build_object(...) FROM "user" WHERE id = p_id LIMIT 1` retorna
--    0 filas si no hay match → función retorna NULL. Caller (`user-identity-
--    by-id-lookup.ts`) trata NULL = "no hay user con ese id" → integrator
--    (`current-user-identity.ts`) propaga null → caller (Server Action o
--    RSC) decide la semántica del null (unauthenticated para action, variant
--    "unauth" para invite page reader). Cero leak sobre existencia del user.
-- 8. **NO expone columnas adicionales** (`banned`, `role`, `image`,
--    `emailVerified`, `createdAt`, `updatedAt`): el caller obtiene SÓLO email
--    + name. Si futura feature necesita `banned` o `role`, agregar DEFINER
--    específico (NO extender éste, NO dar GRANT amplio).
--
-- ## Reverse SQL (rollback puntual)
--
--   REVOKE EXECUTE ON FUNCTION app.lookup_user_identity_by_id(uuid) FROM "app_system";
--   DROP FUNCTION IF EXISTS app.lookup_user_identity_by_id(uuid);
--
-- Sin caveats: la función es read-only, no deja efecto residual.
CREATE OR REPLACE FUNCTION app.lookup_user_identity_by_id(p_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = neon_auth, pg_temp
AS $$
  SELECT jsonb_build_object(
    'email', email,
    'name', name
  )
  FROM "user"
  WHERE id = p_id
  LIMIT 1;
$$;--> statement-breakpoint
-- EXECUTE solo `app_system` (no PUBLIC): la lookup nunca es invocable por
-- un rol no previsto. Idempotente (drizzle re-aplica en cada branch nuevo).
REVOKE EXECUTE ON FUNCTION app.lookup_user_identity_by_id(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.lookup_user_identity_by_id(uuid) TO "app_system";
