# 0032 — Custom Domain SSO: Signed Ticket cross-domain (refina ADR-0001 §1, supersede §3, supersede ADR-0027 futura)

- **Fecha:** 2026-05-22
- **Estado:** Aceptada
- **Alcance:** auth cross-domain (custom domains que no comparten cookie con el apex `place.community`) · módulo nuevo `src/shared/lib/sso/` (sub-cap LOC 800 propio) · 4 endpoints API nuevos (`/api/auth/sso-init`, `/api/auth/sso-issue`, `/api/auth/sso-redeem`, `/api/auth/sso-jwks`) · migration 0011 (función `app.consume_sso_jti` + tabla `app.sso_jti_used`) · 2 cookies nuevas (`__Host-place_sso_state` + `__Host-place_sso_session`) · componente nuevo `<SsoFallbackPanel>` del slice existente `custom-domain-routing` · adaptación de `getSessionTokenForZone` + `getPlaceForZone` (single-callers locales) · 6 env vars nuevos (`PLACE_SSO_SIGNING_KEY`, `PLACE_SSO_SIGNING_KEY_KID`)
- **Habilita:** que el owner autenticado en `place.community` que visita su custom domain (`nocodecompany.co/settings`, `nocodecompany.co/settings/domain`) reciba sesión local automática sin redirect manual al subdomain canónico — cerrando el "auth gap" estructural que Feature B dejó explícito con `<AuthGateForCustomDomain>` educativo · que el visitante en custom domain pueda ejecutar acciones de owner (editar locale, registrar dominio, etc.) sin abandonar la URL pública de su comunidad · cierre operativo definitivo del modelo "dos mundos de sesión" anticipado en ADR-0001 §1.
- **Refina:** ADR-0001 §1 — la topología "dos mundos de sesión" (apex con cookie cross-subdomain + custom domains con sesión local propia) se mantiene intacta; **cómo se conectan los dos mundos NO es OIDC formal** (Place no es OIDC IdP canónico) sino **Signed Ticket pattern**: el apex emite JWTs ES256 short-lived (TTL 60s) que el custom domain redeems en un endpoint dedicado para emitir su propia cookie host-only. ADR-0001 §1 sigue vigente en lo descriptivo (dos mundos), no en lo prescriptivo (OIDC canónico).
- **Supersede:** ADR-0001 §3 ("Un OIDC client confidencial por custom domain, provisionado por el backend en el flujo de verificación del dominio (`place_domain.oauth_client_id`)") — **no se provisiona client OIDC per dominio**. La columna `place_domain.oauth_client_id` queda NULL indefinidamente; se preserva nullable como deuda forward-compat (si V2 alguna vez vuelve a OIDC canónico, la columna se reutiliza). · ADR-0027 (futura, nunca escrita) — el "script idempotente de provisioning retroactivo del `oauth_client_id`" que ADR-0026 §"OIDC client provisioning" anticipaba YA no se necesita; Signed Ticket no requiere provisioning per dominio (el `aud` claim del ticket = host del custom domain, validado contra `place_domain.verified_at IS NOT NULL` directo). ADR-0026 §4 + ADR-0031 §11 reciben banner de obsolescencia parcial.
- **No supersede:** ADR-0001 §1 lo descriptivo (dos mundos se mantienen) · ADR-0001 §2 (identidad `app_user` separada de Better Auth, 1:1 vía `auth_user_id`) — el `sub` del JWT del Signed Ticket = `neon_auth.user.id` = mismo `sub` del JWT apex → continuidad RLS sin refactor de policies · ADR-0001 §4 (Vercel Domains API como SoT de verificación + SSL — sin cambio) · ADR-0010/0011/0012 (RLS base, `app.current_user_id()`, `app.create_place` — sin cambio) · ADR-0017 (provisioning por migraciones — migration 0011 sigue el patrón) · ADR-0018 (`auth.token()` como adquisición JWT del apex — no cambia; el ticket usa el `sub` extraído de ese JWT) · ADR-0022 (i18n DB-based del place — el `<SsoFallbackPanel>` consume `place.default_locale` igual que `<AuthGateForCustomDomain>`) · ADR-0026/0028/0029/0030/0031 (slices `custom-domain`, `custom-domain-verification`, `custom-domain-routing` — slice C agrega componente nuevo sin tocar los previos).
- **Difiere a planes posteriores:**
  - **V2 multi-key rotation zero-downtime**: V1 = single-key (`PLACE_SSO_SIGNING_KEY` + `PLACE_SSO_SIGNING_KEY_KID`). Rotación manual cada 90 días con downtime ≤60s (TTL del ticket). V2 = env var array (`PLACE_SSO_SIGNING_KEYS_JSON`) parseable como `[{kid, key}, ...]` para overlap rotation; el handler `/api/auth/sso-jwks` retorna todas las pubkeys; `verifySsoTicket` matchea por `kid` del JWS header.
  - **V2 rate limiting `/api/auth/sso-issue`**: V1 sin rate limit (el endpoint ya está gated por sesión Neon Auth válida + `aud` verified). V2 = `@upstash/ratelimit` o equivalent con threshold `100 tickets/min/sub` (proteger contra ticket flooding).
  - **V2 logout cascade**: V1 logout del custom domain = borrar cookie `__Host-place_sso_session` solamente (no afecta sesión apex). V2 = signal cross-domain (e.g. BroadcastChannel via iframe del apex, o backend-tracked session_id) para invalidar la cookie del custom domain cuando el owner hace logout en el apex.
  - **V2 OIDC canónico**: si en futuro Place necesita external Relying Parties (third-party apps que se autentican vs Place como IdP), evaluar `oidc-provider` (panva) con Postgres adapter custom — **estimado real ~1500-2000 LOC adapter solo** según validación 2026-05-22. La capa Signed Ticket actual sigue sirviendo como bridge interno; los endpoints OIDC standard (`/.well-known/openid-configuration`, `/authorize`, `/token`) se agregarían paralelos sin reescribir el SSO interno.
  - **V1.1 Cron safety net `*/15` para `place_domain.verified_at` stale** (#103, ADR-0026 §1, ADR-0031 §"Forward-compat con cron safety net"): post-C su importancia técnica aumenta otra vez — si el owner hace silent SSO a un dominio cuyo DNS se rompió post-verify, el endpoint `/api/auth/sso-redeem` cae a `sso_error=invalid_audience` y el owner ve `<SsoFallbackPanel>` sin entender que el problema es DNS. El cron lo previene reseteando `verified_at` antes de que el owner intente SSO.

Las ADR son registro histórico: no se editan, se reemplazan con una nueva ADR que la supersede.

## Contexto

ADR-0001 (2026-05-15) cerró las decisiones macro de auth + custom domains:
- Place es su propio **OIDC Identity Provider** (plugin OIDC Provider de Better Auth — asunción canónica del momento).
- Un **OIDC client confidencial por custom domain**, provisionado al verificar.
- Verificación delegada a Vercel Domains API.
- Topología "dos mundos de sesión": apex cookie cross-subdomain + custom domains con sesión local propia, conectados por SSO OIDC silencioso (`prompt=none`).

ADR-0026 (2026-05-21) cerró Feature A V1 (registro + verificación de custom domains) y dejó `place_domain.oauth_client_id` NULL, prometiendo "ADR-0027 (futura) cubrirá el provisioning retroactivo cuando Feature C entre".

ADR-0031 (2026-05-22) cerró Feature B V1 (host routing real) con `<AuthGateForCustomDomain>` educativo: owners en custom domain sin sesión local ven copy explicando que tienen que ir al subdomain canónico. Feature B documenta el gap como "cierre estructural en Feature C: OIDC SSO + cookie host-only del custom domain con JWT propio + silent SSO via `prompt=none`".

**Lo que ADR-0001 asumía y NO se sostuvo al pasar de planning a implementación de Feature C** (validado por 4 rondas de agentes paralelos 2026-05-22):

1. **El plugin `oidcProvider` de Better Auth NO está accesible desde Neon Auth managed.** `NeonAuthConfig` no acepta `plugins`; el servicio hosted no expone `/authorize` ni `/.well-known/openid-configuration` ni `/oauth2/token` (curl 404 verificado contra `${NEON_AUTH_BASE_URL}` desde tres orígenes distintos). Sólo expone `/.well-known/jwks.json` (200, EdDSA Ed25519 key — pero esa key es del **JWT de sesión apex**, no de un IdP OIDC distinto). El "plugin OIDC Provider de Better Auth" existe en self-hosted Better Auth, no en Neon Auth (que es Better Auth managed).

2. **`oidc-provider` (panva) tiene 2 blockers reales contra el stack actual.** (a) Koa-only API: el lib expone un `oidc.callback()` que devuelve un Koa middleware, no un Next.js App Router handler — adapter custom necesario. (b) Vercel Fluid Compute es stateless: cada Lambda warm/cold pierde state in-memory, así que `oidc-provider` requiere Postgres adapter para sus 6 modelos internos (Session, Grant, Interaction, AccessToken, AuthorizationCode, RefreshToken). **No existe Postgres adapter de `oidc-provider` en npm 2026-05-22 (búsqueda exhaustiva)**, lo que implica construir uno desde cero: estimado real **~1500-2000 LOC adapter solo** (sin contar la integración Next.js handler).

3. **La industria de plataformas de comunidades (Place's competitive set) NO usa OIDC canónico para cross-domain SSO.** Survey 2026-05-22:
   - **Circle.so**: usa OAuth2-flavored JWT (custom flow, NO canonical OIDC). Documentado en su `developers.circle.so/docs/sso-overview`.
   - **Discourse**: usa HMAC-SHA256 signed payload + nonce (DiscourseConnect / ex SSO API). Sin OIDC.
   - **Memberstack / HelpSite / Frontegg**: JWT cookies, signed tickets, custom flows. Ninguno OIDC canónico.
   
   El patrón **dominante en este vertical = Signed JWT Ticket pattern**, producción-validated por todas las plataformas comparables.

4. **Para single-tenant + custom domains controlados por Place + sin external RPs en horizonte**, el TCO + mantenibilidad de Signed Ticket gana dimensión a dimensión vs OIDC canónico:
   - LOC runtime: ~600-800 (Signed Ticket) vs ~2000-2500 (OIDC adapter + handlers).
   - Maintenance burden: 1 sub-módulo `shared/lib/sso/` (~700 LOC, sub-cap 800 propio) vs full OIDC server (CVE response, spec compliance, Conformance Suite).
   - Compliance: Signed Ticket = JWT (RFC 7519) + JWS (RFC 7515) + JWK Set (RFC 7517) — specs estables, jose lib (v6.x) ya en deps. OIDC = OAuth2 (RFC 6749) + OIDC Core 1.0 + Discovery 1.0 + JWT Profile + 4-5 specs más, librería incomplete.
   - Operacional: rotación key V1 manual 90d documentada, downtime ≤60s (TTL ticket); OIDC canónico = misma magnitude de operación + más superficie de bugs.

Lo que ADR-0001 NO podía cerrar (la implementación estaba a meses) y esta ADR cierra:

- **El SSO interno NO es OIDC canónico — es Signed Ticket pattern.** ADR-0001 §3 ("OIDC client confidencial por custom domain") se supersede. La columna `place_domain.oauth_client_id` queda NULL indefinidamente como forward-compat. ADR-0027 nunca se escribe.
- **Confiabilidad criptográfica**: ES256 (ECDSA P-256) vs HMAC simple — asymmetric crypto permite que el redeem en custom domain verifique sin compartir secrets con el apex (el endpoint `/api/auth/sso-jwks` expone sólo la public key).
- **Defensa-en-profundidad anti-replay**: cada ticket tiene `jti` único; el redeem lo consume vía `app.consume_sso_jti` (SECURITY DEFINER, INSERT-ON-CONFLICT-DO-NOTHING atómico) — segundo intento del mismo `jti` retorna false → `sso_error=replay`.
- **Defensa-en-profundidad CSRF**: state cookie host-only `__Host-place_sso_state` (HMAC-firmada con HKDF de la signing key) + nonce + audience binding en el ticket.
- **Continuidad RLS sin refactor**: el `sub` del local session JWT === `neon_auth.user.id` original → `app.current_user_id()` retorna el mismo valor en custom domain y en apex; cero refactor de policies, cero migration de identidad.
- **UX: silent SSO server-side**: el owner que visita `nocodecompany.co/settings` con sesión apex válida ve un sub-segundo de redirects browser-native (init → issue → redeem) y aterriza en settings con sesión local. Sin spinner, sin JS, sin parpadeo. Si falla cualquier paso → `<SsoFallbackPanel>` (componente nuevo del slice `custom-domain-routing`) con código de error + retry CTA + fallback al subdomain canon (CTA del componente existente `<AuthGateForCustomDomain>` reusada como helper interno).

Esta ADR cierra las 6 desviaciones (1-6 arriba) antes de empezar la implementación de Feature C.

## Decisión

### 1. Modelo Signed Ticket (no OIDC canónico)

Place implementa **Signed Ticket pattern** para cross-domain SSO entre apex (`place.community`) y custom domains (`nocodecompany.co`, etc.):

- **Apex es el "trusted issuer"**: emite JWTs ES256 short-lived (TTL 60s) en `/api/auth/sso-issue` con `iss=place.community`, `sub=<neon_auth.user.id>`, `aud=<custom_domain_host>`, `nonce`, `state`, `jti`, `iat`, `exp`.
- **Custom domain es el "trusted redeemer"**: verifica el ticket en `/api/auth/sso-redeem` (firma vs JWKS apex, `aud` matches host actual, `exp` válido, `jti` no consumido, state cookie matches state echo, nonce matches). Si todo OK, mintea **session JWT propio** con el mismo `sub`, lo setea como cookie host-only `__Host-place_sso_session` (TTL 7d), redirect a `returnTo`.
- **NO hay client_id / client_secret / authorization_code / refresh_token / OIDC discovery / OIDC userinfo / OIDC end_session.** No es OAuth2 ni OIDC: es un **JWT bilateralmente firmado-y-validado** entre dos endpoints controlados por la misma organización.

**Por qué Signed Ticket y NO OIDC canónico**:
- Place controla ambos lados del trust (apex + custom domains verified en `place_domain`). No hay external RPs en el horizonte de roadmap V1/V2; OIDC añade superficie spec sin beneficio.
- El plugin OIDC Provider de Better Auth NO está accesible desde Neon Auth managed (validated).
- `oidc-provider` (panva) requiere ~1500-2000 LOC de Postgres adapter + Next.js handler bridge (validated).
- Industria de comunidades (Circle, Discourse, Memberstack) usa Signed Ticket — producción-validated en el vertical.

**Por qué ES256 y NO HMAC simple (como Discourse)**:
- Asymmetric crypto: el redeem en custom domain verifica con la public key (vía `/api/auth/sso-jwks`), sin compartir signing secret cross-endpoint. Si un Lambda warm de custom domain se compromete, no compromete la signing key.
- jose v6.x (ya en deps) soporta ES256 + JWS + JWK Set + remote JWKS con cache nativo (`createRemoteJWKSet`).
- Forward-compat con V2 multi-key rotation: el `kid` del JWS header permite rotar sin downtime.

**Por qué NO Ed25519 (EdDSA)**:
- Ed25519 funciona técnicamente con jose, pero ES256 está más establecido en el ecosistema Vercel/Fluid Compute (más ejemplos públicos, mejor tooling de inspección con jwt.io). Decisión de tooling/operacional, no técnica.
- Neon Auth usa EdDSA Ed25519 para su propio JWT — separar el algoritmo evita confusión cross-key.

### 2. Endpoints HTTP nuevos (4)

- **`GET /api/auth/sso-init`** (montado en **custom domain**): entry point del silent SSO. Query: `?returnTo=<path>`.
  1. Valida `returnTo` con `validateReturnTo` (open-redirect guard).
  2. Valida que el host actual es custom-domain verified (`lookupPlaceByDomain(host)` reusa wrapper Feature B).
  3. Genera `state` + `nonce` (`crypto.randomBytes` base64url).
  4. Firma state cookie HMAC + setea `__Host-place_sso_state` (Max-Age=120, HttpOnly, Secure, SameSite=Lax, Path=/).
  5. Redirect 302 a `https://place.community/api/auth/sso-issue?aud=<host>&state=<>&nonce=<>&returnTo=<>`.

- **`GET /api/auth/sso-issue`** (montado en **apex**): emite el ticket. Query: `?aud=<host>&state=<>&nonce=<>&returnTo=<>`.
  1. Parse query con Zod schema strict.
  2. Valida `aud` es verified: `lookupPlaceByDomain(aud)` → null = 400 `invalid_audience` (sin leak detalles).
  3. Valida sesión apex: `getSessionJwt()` → null = redirect a `https://place.community/{locale}/login?returnTo=<encoded sso-issue URL>` (preserva flow tras login).
  4. Verifica JWT apex + extrae `sub`: `verifyAccessToken(jwt)` → falla = 401.
  5. Mintea ticket con `signSsoTicket({iss, sub, aud, nonce, state, jti:randomUUID(), iat, exp:+60s, kid})`.
  6. Re-valida `returnTo` (defense-in-depth: el redeem re-validará una tercera vez).
  7. Redirect 302 a `https://<aud>/api/auth/sso-redeem?ticket=<jwt>&state=<state>&returnTo=<returnTo>`.

- **`GET /api/auth/sso-redeem`** (montado en **custom domain**): redime el ticket. Query: `?ticket=<jwt>&state=<>&returnTo=<>`.
  1. Lee + verifica state cookie con `verifyStateCookie` → null/invalid = redirect `returnTo + '?sso_error=state_invalid'`.
  2. Constant-time comparison del `state` query vs state cookie. Mismatch = `?sso_error=state_mismatch`.
  3. Carga JWKS apex con `createRemoteJWKSet(new URL('https://place.community/api/auth/sso-jwks'))` (jose cachea intra-process por 5min).
  4. `verifySsoTicket(ticket, host, jwks)` → throws con `SsoTicketError` mapeado a `?sso_error=<code>` (`expired`, `signature_invalid`, `aud_mismatch`, `missing_claim`, `signature_invalid`, `iss_wrong`).
  5. Valida `nonce` del ticket === nonce del state cookie.
  6. Re-valida `aud === host` actual (defense-in-depth, jose ya lo hizo).
  7. Consume `jti` vía `consumeSsoJti(jti, exp)` (wrapper TS sobre `app.consume_sso_jti`). False = `?sso_error=replay`.
  8. `mintLocalSession({sub, host})` → cookie `__Host-place_sso_session` (HttpOnly, Secure, SameSite=Lax, Path=/, Max-Age=7d).
  9. Borra state cookie (Max-Age=0).
  10. Re-valida `returnTo` + redirect 302 a path interno.

- **`GET /api/auth/sso-jwks`** (montado en **apex**): JWKS público para que custom domains verifiquen tickets.
  - Retorna `loadPublicJwks()` con `Content-Type: application/jwk-set+json` + `Cache-Control: public, max-age=300, s-maxage=300` (5min).
  - Sin auth — JWKS es público por definición (RFC 7517).
  - Body: `{keys: [{kty:'EC', crv:'P-256', x:'…', y:'…', kid:'<KID>', use:'sig', alg:'ES256'}]}`.

**Decisión: error paths del redeem SIEMPRE redirigen, nunca renderean HTML**. Separación clean — handler = API, page de UI consume `?sso_error=<code>` query y muestra `<SsoFallbackPanel>` ahí. No mezclar handler con view.

**Decisión: el `/api/auth/sso-init` NO requiere sesión apex local (es el primer hop)**. Si el visitor que llega no tiene sesión apex (e.g. logout previo), el flow seguirá hasta `/api/auth/sso-issue` que redirige a apex login con `returnTo` preservado. Owner se loguea, vuelve, ticket emitido, redeem completa.

### 3. Cookies nuevas (2, ambas `__Host-` prefix)

| Cookie | Hosting | TTL | Atributos | Propósito |
|---|---|---|---|---|
| `__Host-place_sso_state` | custom domain (efímera) | 120s (60s ticket exp + 60s buffer) | HttpOnly, Secure, SameSite=Lax, Path=/, **Domain ausente** (host-only) | CSRF + nonce echo del flow `init → issue → redeem` |
| `__Host-place_sso_session` | custom domain (long-lived) | 7d | HttpOnly, Secure, SameSite=Lax, Path=/, **Domain ausente** (host-only) | Sesión local del custom domain (JWT firmado por apex) |

**Por qué `__Host-` prefix (NO `__Secure-` ni unprefixed)**:
- `__Host-` enforce browser-side: cookie DEBE tener `Secure`, `Path=/`, **NO** `Domain` attribute (host-only). Si el handler emite la cookie con cualquier otro shape, el browser la rechaza silently.
- Defense-in-depth contra misconfiguration accidental — si por bug se setea `Path=/api` o `Domain=.example.com`, el navegador no la persiste y el flow falla loud (`sso_error=state_invalid` en próximo redeem), no silently degrade.

**Por qué NO Domain attribute (host-only)**:
- El custom domain es un registrable domain distinto del apex. Setear `Domain=.nocodecompany.co` no afecta cross-domain (la cookie no cruza a `place.community` ni viceversa de todas formas — los browsers la scope por host del Set-Cookie).
- Host-only es más restrictivo y es lo que `__Host-` prefix enforce.

**Por qué SameSite=Lax (NO Strict, NO None)**:
- `Lax` permite que el cookie viaje en navegaciones top-level cross-site (`<a href>`, `window.location`) — necesario para que el redeem reciba state cookie tras venir de `/api/auth/sso-issue` del apex.
- `Strict` bloquearía el flow (el redeem viene de un cross-site redirect del apex; el browser strict-mode no enviaría state cookie).
- `None` requiere `Secure` (OK) pero abre superficie a CSRF (no necesario; `Lax` cubre el caso).

**Sub-decisión: state cookie firma con HMAC SHA-256, key derivada via HKDF de la signing key principal**. No requiere env separada — el HKDF deriva un secret de uso específico (info=`'place_sso_state_hmac_v1'`) que es deterministico y aislado del uso ES256.

### 4. Migration 0011 — `app.consume_sso_jti` + tabla `app.sso_jti_used`

```sql
CREATE TABLE app.sso_jti_used (
  jti          TEXT PRIMARY KEY,
  consumed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX sso_jti_used_expires_at_idx ON app.sso_jti_used (expires_at);
ALTER TABLE app.sso_jti_used ENABLE ROW LEVEL SECURITY;
-- Sin policy → 0 acceso por RLS. La función DEFINER es el único canal.

CREATE OR REPLACE FUNCTION app.consume_sso_jti(p_jti text, p_exp timestamptz)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = app, public, pg_temp
AS $$
DECLARE inserted_rows int;
BEGIN
  -- GC oportunista: cada consume limpia jtis expirados.
  DELETE FROM app.sso_jti_used WHERE expires_at < now();
  INSERT INTO app.sso_jti_used (jti, expires_at) VALUES (p_jti, p_exp)
  ON CONFLICT (jti) DO NOTHING;
  GET DIAGNOSTICS inserted_rows = ROW_COUNT;
  RETURN inserted_rows = 1; -- true = consumido OK, false = replay
END;
$$;
REVOKE EXECUTE ON FUNCTION app.consume_sso_jti(text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.consume_sso_jti(text, timestamptz) TO "app_system";
```

**Justificación del patrón**:
- **SECURITY DEFINER**: anonymous-safe — el redeem corre sin claim de sesión (la cookie session aún no existe; el ticket viene por query). El pattern es el mismo de `app.lookup_place_by_domain` (ADR-0031 §1) y `app.create_place` (ADR-0012 §3).
- **GC oportunista**: cada consume limpia jtis expirados. No requiere cron separado. Volumen esperable MVP = single-digit consumes/min → DELETE micro.
- **ON CONFLICT DO NOTHING + ROW_COUNT**: atomic check-and-set. Race condition (two redeems concurrent del mismo ticket) = exactly one INSERT wins, otro retorna `inserted_rows=0` → false → `sso_error=replay`. Validado con test concurrent `Promise.all([consume(jti), consume(jti)])`.
- **REVOKE PUBLIC + GRANT app_system**: única vía de invocación es el wrapper TS bajo el rol runtime `app_system`. El anonymous role `anon` no recibe grant (consistente con "no usamos Data API ni anon", ADR-0006).

**Reverse SQL manual** (no automatizado — documentado como header en la migration SQL):
```sql
REVOKE EXECUTE ON FUNCTION app.consume_sso_jti(text, timestamptz) FROM "app_system";
DROP FUNCTION IF EXISTS app.consume_sso_jti(text, timestamptz);
DROP TABLE IF EXISTS app.sso_jti_used;
```

### 5. Módulo nuevo `src/shared/lib/sso/` con sub-cap LOC 800 propio

Sub-carpeta del shared/lib con sub-cap LOC 800 propio para evitar contaminación del shared/lib raíz (que ya tiene ~600 LOC tras Features A+B y debe quedar ≤800 del cap global).

```
src/shared/lib/sso/
├── index.ts              # barrel — exports públicos
├── sso-keys.ts           # ~120 LOC — loadSigningKey() + loadPublicJwks()
├── sso-ticket.ts         # ~150 LOC — signSsoTicket() + verifySsoTicket() + types
├── sso-state.ts          # ~180 LOC — state cookie HMAC + nonce + returnTo validation
├── sso-session.ts        # ~150 LOC — mintLocalSession() + verifyLocalSession()
├── sso-jti-consume.ts    # ~30  LOC — wrapper anonymous-safe sobre app.consume_sso_jti
├── db-with-verifier.ts   # ~80  LOC — getAuthenticatedDbWithVerifier (RLS bridge)
└── __tests__/...
```

**Total proyectado**: ~710 LOC + barrel ~20 LOC = ~730 LOC. Sub-cap 800 → dentro con margen.

**Por qué sub-cap propio (no extender shared/lib global)**: ADR-0028 §"Sub-carpetas dentro de shared/lib pueden tener sub-caps cuando agrupan cohesivamente" se aplica acá. El sub-módulo `sso/` es cohesivo (todas funciones del Signed Ticket flow) y se beneficia de un cap aislado.

**Por qué NO un slice `src/features/custom-domain-sso/`**: los helpers (`signSsoTicket`, `verifySsoTicket`, `mintLocalSession`, etc.) son consumidos desde 3 surfaces distintas: `/api/auth/sso-init`, `/api/auth/sso-issue`, `/api/auth/sso-redeem` (3 route handlers en `src/app/`) + `getSessionTokenForZone` (zone-place internal lib) + `<SsoFallbackPanel>` (slice `custom-domain-routing`). Los Server Actions y la UI del flow NO existen como concepto cohesivo (no hay form que renderear; el flow es server-side redirect cadena). Un slice acá sería ceremonia sin beneficio. Decision documented.

#### Addendum 2026-05-23 — sub-cap subido de 800 a 1000 LOC

Tras cerrar S2 (sso-keys + sso-ticket) y S3 (sso-state), los actuals del sub-módulo divergen del estimate ex-ante: **647 LOC consumidos vs ~470 LOC proyectados**. Desglose:

| Archivo | Proyectado | Actual | Δ |
|---|---|---|---|
| `sso-keys.ts` | 120 | 154 | +28% |
| `sso-ticket.ts` | 150 | 270 | +80% |
| `sso-state.ts` | 180 | 208 | +16% |
| `index.ts` (barrel) | 20 | 15 | −25% |
| **Total post-S3** | **470** | **647** | **+38%** |

**Por qué el overage**: el code-density refleja el mandato "production-minded desde el día uno" del user (memoria-de-feedback `production_minded`, reforzada en review pre-S0): comentarios canónicos extensos, JSDoc completo, header blocks que documentan invariantes/decisiones por archivo. El estimate ex-ante asumió doc-density ~30% (típico de scaffold); el actual es ~50-60% en `sso-ticket.ts` (decisión consciente — toda la criptografía + mapeo de errores jose merece justificación inline). NO es bloat: cada bloque de comentarios documenta una decisión o un invariante con consecuencias de seguridad.

**Proyección post-Feature C** (con LOC actuales + estimates restantes):
- S4 (sso-session + db-with-verifier): ~280-310 LOC siguiendo el overage milder (+16-28%) que sso-keys/sso-state — sso-ticket fue outlier por densidad de mapeo cripto.
- S8 (sso-jti-consume wrapper): ~30 LOC (sin overage esperado — wrapper anonymous-safe trivial).
- **Total proyectado post-Feature C**: ~957 LOC con ~43 LOC margen vs cap 1000.

**Decisión**: subir sub-cap a **1000 LOC** (de 800). Justificación de los +200:
1. **Cap original era estimate, no constraint constitucional**. El número 800 vino del shared/lib raíz cap global aplicado por simetría sin medir el doc-density real del flow criptográfico. Ahora que hay actuals, el cap se calibra a la realidad.
2. **Concentración cohesiva justifica concentración LOC**. ADR-0028 §"sub-carpetas pueden tener sub-caps cuando agrupan cohesivamente" da el principio; el aplicación práctica es elegir el sub-cap calibrado al sub-módulo (1000 acá vs 800 raíz). El sub-módulo `sso/` agrupa TODA la criptografía Signed Ticket — la alternativa sería diluir entre `shared/lib/` raíz y otros lugares, perdiendo cohesión.
3. **+25% sobre cap raíz** es congruente con el "+38% LOC actual vs proyectado" — la familia de archivos cripto pide más densidad doc por unidad de funcionalidad.
4. **Margen para growth controlado**: si una hipotética S4+S8 hace overshoot adicional, se vuelve a pausar y se eleva otra vez (NO se baja la guardia). El cap es elástico bajo justificación documentada, no abandonable.

**Lo que NO cambia**:
- Cap shared/lib raíz: **800** (intacto). Este sub-cap es ortogonal; no extiende el global.
- Otros sub-módulos `shared/lib/<name>/` futuros heredan **800** por default, no 1000. Cualquier excepción require ADR addendum equivalente (no precedente automatic).
- Caps por archivo (300) y por función (60): **intactos**. Esta decisión sólo toca el cap agregado del sub-módulo.

**Pre-S4 verification baseline**: 647 LOC (medido con `wc -l src/shared/lib/sso/*.ts | grep -v test`). Tag de save point pre-addendum: `baseline/feature-c-s3-done`.

#### Addendum 2026-05-23 (later) — sub-cap subido de 1000 a 1100 LOC

Trigger: smoke production T1.1 de S11 detectó `sso_error=signature_invalid` aunque la firma del ticket era matemáticamente válida (postmortem operativo completo en `docs/gotchas/jose-jwks-redirect-manual.md`). Root cause: el JWKS apex responde HTTP 307 apex→www por config Vercel platform-level, y jose v6 hardcodea `redirect: 'manual'` en `createRemoteJWKSet` (`node_modules/jose@6.2.3/dist/webapi/jwks/remote.js` línea 19) — el redirect benigno se interpreta como respuesta inválida y throws, que el pipeline mapea (correctamente) a `signature_invalid`. El fix Opción D (ver §12 abajo) requirió un archivo nuevo en el sub-módulo: `src/shared/lib/sso/sso-jwks-fetcher.ts` (~140 LOC de source, sin tests).

**LOC measurement antes del fix**: `wc -l src/shared/lib/sso/*.ts | grep -v test` → **1000 LOC exactos** (cap saturated, 0 margen residual). Post-fix: **~1140 LOC**. Bump justificado de **1000 → 1100 LOC**, con margen pequeño negativo residual (~40 LOC over en la primera medición; el cap se calibra a la realidad medida + buffer estricto: si futuras fixes del sub-módulo agregan más, se vuelve a pausar y se eleva otra vez con addendum equivalente. **Mismo principio que el bump previo 800→1000**: el cap es elástico bajo justificación documentada, NO abandonable).

**Por qué +100 y no más**: el helper `sso-jwks-fetcher.ts` es ortogonal — un solo concern bien delimitado (JWKS fetch con safe redirect policy). No abre la puerta a más concerns en el sub-módulo. Si futuras fixes de seguridad demandan capacidad LOC adicional, cada bump pasa por addendum dedicado (no precedente automatic; no hay "presupuesto de growth" implícito).

**Lo que NO cambia** (consistente con el bump previo 800→1000):
- Cap shared/lib raíz: **800** (intacto). Este sub-cap es ortogonal.
- Sub-cap por archivo: **300** (intacto). `sso-jwks-fetcher.ts` queda ~140 LOC, dentro.
- Cap por función: **60** (intacto). `makeSafeRedirectFollowingFetch` queda ~50 LOC.
- Otros sub-módulos `shared/lib/<name>/` futuros heredan **800** por default. Cualquier excepción requiere ADR addendum equivalente.

**Pre-fix verification baseline**: 1000 LOC. Tags de save point:
- Pre-fix: `baseline/pre-s11-fix-jwks-redirect`.
- Post-fix code: `baseline/feature-c-s11.1-code`.

### 6. Local session JWT (custom domain)

Claims del JWT seteado en `__Host-place_sso_session`:

```typescript
type LocalSessionClaims = {
  iss: 'place.community';       // emitido por el apex (mismo signer ES256)
  sub: string;                  // === neon_auth.user.id (continuidad RLS)
  host: string;                 // === custom domain del cookie (defense-in-depth)
  iat: number;
  exp: number;                  // iat + 7d
  kid: string;                  // JWS header kid (rotation forward-compat)
};
```

**Continuidad RLS**: el `sub` del local session JWT === `sub` del JWT apex original → `app.current_user_id()` retorna el mismo valor en cualquier zona. Cero refactor de policies.

**`host` claim**: defense-in-depth contra robo cross-custom-domain. Si un atacante roba el cookie de `nocodecompany.co` y lo inyecta en `otrosplace.com`, el verify del session falla porque `host claim !== host actual`. jose `jwtVerify` no soporta `audience` por host, pero validación manual post-verify cubre.

**TTL 7d**: balance entre UX (no re-SSO frecuente) y seguridad (rotación natural si Neon Auth invalida la sesión apex, el próximo silent SSO falla → user re-loguea). V2 considera shorter TTL + refresh, pero V1 ship simple.

### 7. RLS bridge — `getAuthenticatedDbWithVerifier`

`getAuthenticatedDb` (existing, Feature A) verifica el JWT vs Neon Auth JWKS. Para custom domain con session local, el verifier es distinto (la cookie es un JWT firmado por nuestro apex, no por Neon Auth).

**Decisión: NO modificar `src/shared/lib/db.ts`**. Crear `src/shared/lib/sso/db-with-verifier.ts` con `getAuthenticatedDbWithVerifier<T>(token, verifier, fn)`:

```typescript
type TokenVerifier = (token: string) => Promise<{sub: string}>;
export async function getAuthenticatedDbWithVerifier<T>(
  token: string,
  verifier: TokenVerifier,
  fn: (db: Drizzle) => Promise<T>
): Promise<T> {
  const { sub } = await verifier(token);
  return pool.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('request.jwt.claims', ${JSON.stringify({sub})}, true)`);
    return fn(drizzle(tx));
  });
}
```

**Por qué NO modificar `db.ts`**:
- Preserva invariante de Feature B: el `db.ts` raíz sirve al apex (Neon Auth JWKS). Custom domain usa módulo nuevo.
- Sub-cap LOC: `db.ts` queda ≤300 (actual 88 LOC).
- Locked file declarado a parallel agents en S4 + S9 (decisión bloquea drift).

**Wrapper conveniente para `getPlaceForZone`**: `getCustomDomainDb(sessionToken, fn)` envuelve `getAuthenticatedDbWithVerifier(sessionToken, verifyLocalSession, fn)`.

### 8. UX silent SSO + `<SsoFallbackPanel>`

**Happy path** (owner con sesión apex válida visita `nocodecompany.co/settings`):
1. Layout custom-domain ve `hostZone.zone === 'custom-domain'` + sin sesión local → `redirect('/api/auth/sso-init?returnTo=/settings')`.
2. Browser navega init → state cookie set + redirect 302 a apex issue.
3. Apex issue verifica sesión apex válida → ticket firmado + redirect 302 a redeem custom domain.
4. Custom domain redeem verifica + setea cookie session local + redirect 302 a `/settings`.
5. Browser navega a `/settings` → layout ve cookie session válida → page render normal.

**Total: 4 redirects HTTP 302**. Sub-segundo en redes normales. Sin spinner, sin JS, sin parpadeo perceptible. Cero requirement de JavaScript habilitado (server-side redirect chain funciona en cualquier browser).

**Failure path**:
- Cualquier error en init/issue/redeem → redirect `returnTo + '?sso_error=<code>'`.
- Layout ve cookie session ausente + `searchParams?.sso_error` presente → render `<SsoFallbackPanel>` (componente nuevo del slice `custom-domain-routing`).
- `<SsoFallbackPanel>` muestra: title localizado, body con error code (en `<details>` para debug), CTA "Ir a {slug} en place.community" (reusa `buildSubdomainCanonicalUrl` de Feature B), CTA "Reintentar" (link a `/api/auth/sso-init?returnTo=<...>`).

**Sin loop automático V1**: si retry falla, owner ve fallback de nuevo. No counter de attempts (decision: V1 simple; V2 podría track `sso_attempts` cookie y bloquear tras N para evitar tight loops si owner clicked accidentally).

**Decisión: NO mostrar `<AuthGateForCustomDomain>` como branch primario sin-sesión**. Feature B introdujo `<AuthGateForCustomDomain>` como CTA-link al subdomain canon. Feature C lo **mantiene locked** (no se modifica) pero ya NO es el branch primario — ahora se dispara silent SSO primero, y `<AuthGateForCustomDomain>` queda accesible vía el CTA del `<SsoFallbackPanel>` (mismo destino: `https://{slug}.place.community/{locale}{returnPath}`).

### 9. Logging estructurado de eventos de seguridad

Cada error path del redeem loggea (vía `console.log` JSON-stringified — Vercel structured logs lo parsea):

```typescript
console.log(JSON.stringify({
  event: 'sso_redeem_error',
  code: 'state_mismatch' | 'aud_mismatch' | 'expired' | 'signature_invalid' | 'replay' | 'state_invalid' | 'jti_db_error',
  host: req.headers.get('host'),
  jti: ticket?.jti ?? null,       // sólo si parseo del ticket llegó hasta extraer jti
  timestamp: new Date().toISOString(),
}));
```

**NUNCA loggear**:
- `PLACE_SSO_SIGNING_KEY` (PEM completo).
- El ticket raw (contiene `sub`).
- El session token raw.
- El state cookie value completo.

**Test guard**: gotcha + test mock de `console.error/log` que falla si el output contiene patterns de signing key (`-----BEGIN`, `kty.*x`, etc.). Cubierto en S2 `sso-keys.test.ts`.

### 10. Env vars nuevas (Vercel-only, NUNCA `.env.local` committed)

- **`PLACE_SSO_SIGNING_KEY`** — ES256 PKCS8 PEM private key. Generada con:
  ```bash
  openssl ecparam -name prime256v1 -genkey -noout -out tmp.pem
  openssl pkcs8 -topk8 -nocrypt -in tmp.pem -out signing-pkcs8.pem
  # contenido de signing-pkcs8.pem → Vercel env var
  rm tmp.pem signing-pkcs8.pem   # NO commitear
  ```
- **`PLACE_SSO_SIGNING_KEY_KID`** — string corto (e.g. `2026-05-23-r1`) usado en JWS header `kid` para forward-compat con rotation V2 multi-key.

**Setear en**: Vercel dashboard, environments **production + preview** (preview branches del PR pipeline necesitan testear el flow).

**NUNCA en**: `.env.local` committed, GitHub repo, logs, comentarios de PR, screenshots.

**Operational rotation procedure (V1, manual cada 90 días)**:
1. Generate new keypair: `openssl ecparam... ; openssl pkcs8...`.
2. Update Vercel env `PLACE_SSO_SIGNING_KEY` con nuevo PEM (production + preview).
3. Update `PLACE_SSO_SIGNING_KEY_KID` con timestamp nuevo (e.g. `2026-08-21-r2`).
4. Trigger redeploy.
5. **Downtime**: ≤60s = TTL del ticket. Tickets emitidos antes del cutover y consumed después fallarán `signature_invalid`. Owner ve `<SsoFallbackPanel>` con retry → próximo SSO usa nueva key. Acceptable downtime para una rotación 90d (planificable fuera de horario peak).

V2 multi-key rotation (deferido): env `PLACE_SSO_SIGNING_KEYS_JSON=[{kid,key}, ...]`, `signSsoTicket` usa el primer key (newest), `verifySsoTicket` matchea por `kid` del JWS header contra cualquier key del array. Zero downtime.

### 11. Sin afectación de Feature A / Feature B en código (sólo docs)

Feature A (slices `custom-domain` + `custom-domain-verification`) y Feature B (slice `custom-domain-routing` + proxy + lookup + layout) quedan **intactos en código**. Feature C agrega capa encima:

- `place_domain.oauth_client_id` column: **queda NULL indefinidamente**. Schema delta = comentario SQL actualizado (deprecated forward-compat); migration NO DROP.
- `<AuthGateForCustomDomain>` (Feature B): **locked**, accesible vía CTA del `<SsoFallbackPanel>` nuevo.
- `app.lookup_place_by_domain` + `lookupPlaceByDomain` wrapper: **reusados** en sso-init (validar host), sso-issue (validar aud), sso-redeem (validar host actual). 3 callers nuevos via función existente.
- Proxy matcher (`src/proxy.ts:matcher`): el matcher actual `"/((?!api|_next|_vercel|.*\\..*).*)"` excluye `/api/*` correctamente. **Verify-only en S5**, NO modificación. Si hipotéticamente hubiera un bug, fix en S5; si no (esperado), `git diff` post-S5 sobre `src/proxy.ts` empty.
- `getSessionTokenForZone` (Feature B internal lib): adaptado en S9 — return shape evolve de `string | null` a `{token: string; source: 'neon-auth' | 'sso-local'} | null`. Single owner del cambio (yo en S9, sin agentes paralelos) — 3 callers locked (`settings/page.tsx`, `settings/domain/page.tsx`, `getPlaceForZone`).

### 12. Same-registrable-domain redirect policy (customFetch al JWKS apex)

#### Addendum 2026-05-23 — síntoma diagnosticado en smoke production T1.1

Smoke production T1.1 del cierre de S11 detectó el siguiente síntoma reproducible:

- Owner real autenticado en apex visita `nocodecompany.co/settings` (custom domain verified).
- Silent SSO arranca: init → issue → redeem. El ticket emitido por `/api/auth/sso-issue` es matemáticamente válido (verificado offline con scripts `verify-ticket.mjs` y `verify-ticket-www.mjs` desde shell — misma firma, misma key, mismo `aud`).
- Redeem en custom domain aterriza en `?sso_error=signature_invalid` consistentemente.
- Diagnóstico cross-host: `verify-ticket.mjs` fetcheando JWKS de `https://place.community/api/auth/sso-jwks` → fail; fetcheando JWKS de `https://www.place.community/api/auth/sso-jwks` → pass.
- Root cause: el JWKS apex responde HTTP 307 → `https://www.place.community/api/auth/sso-jwks` por configuración Vercel platform-level apex→www (SEO + canonical URL, decisión arquitectónica de marketing).
- `jose v6 createRemoteJWKSet` internamente llama `fetchJwks(url, headers, signal, fetchImpl)` con `redirect: 'manual'` **hardcodeado** en `node_modules/jose@6.2.3/dist/webapi/jwks/remote.js` línea 19. Ve el 307 como respuesta inválida (esperaba 200) y throws.
- El pipeline del redeem mapea cualquier JWKS fetch fail a `sso_error=signature_invalid` (defense-in-depth correcta: no leak al cliente de qué exactamente falló).

#### Por qué jose hardcodea `redirect: 'manual'`

Defensa anti JWKS-hijack: un atacante en path del DNS (o en una CDN intermedia) podría redirigir el JWKS a un endpoint controlado con su propia public key. Tickets forjados por el atacante verificarían contra esa key falsa y el redeem mintea sesión local válida. La defensa de jose es **correcta y deliberada**.

El problema: choca con el redirect platform-level de Vercel apex→www, que es benigno y arquitectónico (no es ataque; es config canonical URL del marketing). No hay knob de jose v6 default para distinguir "redirect benigno same-registrable" vs "redirect malicioso cross-registrable" — el default conservador rechaza todo.

#### Decisión: customFetch + same-registrable-domain allowlist (Opción D)

jose v6 exporta `customFetch` como Symbol export: escape hatch oficial para casos que necesitan policy custom sin perder la abstracción de `createRemoteJWKSet` (cache intra-process, key rotation handling, JWK Set parsing). Wire-up:

```typescript
import { customFetch, createRemoteJWKSet } from 'jose';
createRemoteJWKSet(url, { [customFetch]: myFetch })
```

Helper `makeSafeRedirectFollowingFetch` en `src/shared/lib/sso/sso-jwks-fetcher.ts` sigue redirects **sólo** bajo policy estricta:
1. **Same-registrable-domain** check (last-two-labels heuristic; naive para gTLDs, NO maneja ccTLDs con sufijo público multi-label tipo `*.co.uk`, `*.com.ar` — los trataría como single registrable). Documentado en header del archivo. Place actualmente sólo deploya bajo gTLDs (apex `place.community` verificado 2026-05-23 como gTLD).
2. **`https:` only** — NO downgrade a `http:` aunque la redirect Location header lo indique.
3. **≤3 hops** — Vercel apex→www es 1 hop real; +2 buffer para casos benignos sin riesgo de loop.

Cualquier violación → throw `SsoJwksRedirectError` con código discriminado (`protocol_downgrade` | `cross_registrable_domain` | `too_many_redirects`) → jose envuelve en `JOSEError` → redeem cae en `sso_error=signature_invalid` (misma semántica que un fallo JWKS genérico — el cliente NO aprende nada nuevo del modo de falla, defense-in-depth preserved).

**Restaura funcionalidad sin perder defense-in-depth**: redirect a host fuera del registrable se sigue rechazando, igual que jose default. Sólo se permite el caso benigno empíricamente medido (apex→www same-registrable + https).

#### Tabla comparativa: 9 opciones evaluadas, D elegida

| Opción | Descripción | Por qué descartada / elegida |
|---|---|---|
| A | Cambiar `NEXT_PUBLIC_APP_URL` a `https://www.place.community` | High blast radius: `rootDomain()` lo usa para cookie scoping cross-subdomain (Feature B) — cambiarlo rompe cookies existentes y la topología "dos mundos" canon. |
| B | Hardcode `www.place.community` en JWKS URL del redeem | Frágil: rompe dev local (`localhost` no tiene www); ata el código al deploy actual; un futuro cambio Vercel rompería silently sin que ningún test lo detecte. |
| C | Custom fetch que sigue redirects sin validar target | Pierde la defensa anti-hijack que jose puso por buena razón — un MITM podría redirigir JWKS a su propio endpoint. Anti-pattern de security. |
| **D** | **customFetch + allowlist same-registrable + https + ≤3 hops** | **Elegida** — restaura funcionalidad sin perder defense-in-depth; alineado con escape hatch oficial de jose v6; ortogonal al resto del módulo (single concern). |
| E | Deshabilitar redirect Vercel apex→www | Pierde SEO + impacto fuera del scope SSO; rompe expectations del marketing y de canonical URL del apex. |
| F | Vercel rewrite exception sobre `/api/auth/sso-jwks` | Risky platform interaction; el behavior de rewrites vs redirects sobre paths específicos no está bien documentado y depende de orden interno de evaluación. |
| G | Embed JWK pública como env var, skip fetch | Complica rotation (env var change en cada rotación 90d, requiere redeploy sincrónico) y rompe arquitectura del JWKS endpoint público (que existe precisamente para permitir rotation transparente). |
| H | Build-time prefetch del JWKS, embed en bundle | Frágil vs rotation (cada rotación requiere re-deploy) y rompe contract de JWKS como endpoint dinámico (RFC 7517 implícito). |
| I | Usar Vercel deployment URL directo (no apex) | Frágil: deployment URLs son ephemeral; cambian en cada deploy preview/production y rompen verifier de tickets ya emitidos. |

#### Tests + ubicación de defensas

- **10 unit tests** en `src/shared/lib/sso/__tests__/sso-jwks-fetcher.test.ts` cubren cada policy violation + happy paths: same-host pass, apex→www same-registrable pass, cross-registrable reject, http downgrade reject, >3 hops reject, 3xx sin Location header passthrough (deja que jose decida), 3xx con Location relative resuelto correctamente, default `maxRedirects=3` honored, custom `maxRedirects` honored, AbortSignal propagado en cada hop.
- **Gotcha doc completo** en `docs/gotchas/jose-jwks-redirect-manual.md` — postmortem operativo del síntoma + repro steps + diagnostic flowchart; complementa este addendum (que documenta la decisión arquitectónica) sin duplicarlo (gotcha = "lo que muerde de nuevo si lo olvidás", ADR = "por qué decidimos así").
- **Wire-up** en `src/app/api/auth/sso-redeem/route.ts` con import `customFetch` Symbol de jose + uso en options de `createRemoteJWKSet` dentro del singleton `getApexJwks()` (lazy, cacheado intra-process).

#### Consecuencias forward

- **Si jose v7+ acepta `redirect` configurable**: este helper puede simplificarse o eliminarse — revisar simultáneamente este addendum y la gotcha en cada bump major de jose. Tracking implícito en `docs/gotchas/jose-jwks-redirect-manual.md`.
- **Si Place deploya bajo ccTLD multi-label** (`*.co.uk`, `*.com.ar`, `*.com.br`, etc.): el `getTwoLabelRoot` necesita reemplazarse por una PSL lib (ej. `tldts` o `psl`). Documentado en header del helper como invariante de evolución. La API pública (`makeSafeRedirectFollowingFetch`) es estable — el cambio es interno.
- **Cron safety net #103 gana importancia** (ya documentado en §"Forward-compat con cron safety net" de Consecuencias arriba, y reforzado acá): si el JWKS endpoint cae o devuelve algo no parseable, el silent SSO rompe transparentemente desde la perspectiva del owner — el cron `*/15` permite detección proactiva del stale state antes de que el owner intente SSO.

## Alternativas rechazadas

### A1. OIDC canónico con `oidc-provider` (panva) + Postgres adapter custom

Discutido + validado con 4 rondas de agentes paralelos 2026-05-22. Blockers:
1. **Koa-only API**: `oidc.callback()` devuelve middleware Koa, no Next.js handler. Adapter custom necesario (~200 LOC bridge).
2. **Postgres adapter inexistente en npm**: build-it-ourselves ~1500-2000 LOC adapter solo (6 modelos: Session, Grant, Interaction, AccessToken, AuthorizationCode, RefreshToken).
3. **Vercel Fluid Compute stateless**: cada Lambda warm/cold pierde state in-memory. Sin Postgres adapter, OIDC server no funciona en serverless.
4. **CVE response surface**: oidc-provider tiene historia de CVEs (last in 2025); maintenance burden ongoing.

**TCO 3-year horizon** (validated):
- OIDC: ~2000-2500 LOC + CVE response + spec compliance (OIDC Core 1.0 + Discovery + JWT Profile + ...).
- Signed Ticket: ~700 LOC + jose lib (mantenido por panva mismo, mejor track record) + rotation manual 90d.

Signed Ticket gana dimension a dimension.

### A2. OIDC canónico con plugin `oidcProvider` de Better Auth (Stack Auth managed)

Stack Auth es el successor de Neon Auth y expone Better Auth OIDC Provider plugin nativamente. Pricing TBD 2026-05-22 (no documentado público). Validation:
- Switch de Neon Auth → Stack Auth = migration de provider auth + re-provisioning de todos los Neon Auth users + change de JWKS endpoint. Refactor masivo (~50+ files tocados).
- Stack Auth no soporta `place.community/api/auth/[...path]` first-party route handler pattern todavía (Neon Auth sí — verificado, ADR-0006).
- "Switch provider para resolver SSO de custom domains" es swatting a fly with a sledgehammer.

Rechazado por scope creep + cost de provider migration desproporcionado al problema.

### A3. Managed SSO providers (Ory, Auth0, Logto, Clerk, Stytch)

Survey 2026-05-22 con pricing real:
- **Ory Network**: $770/year + complejidad de operar OIDC custom domain (cada custom domain como RP separado en Ory = setup manual por dominio).
- **Auth0**: $35+/mo, MAU-based — cost growth con escala de places.
- **Logto**: $0-72/mo, dominio custom como organization (modelo no encaja a single-tenant Place).
- **Clerk**: enterprise-only para custom domains SSO.
- **Stytch**: Connected Apps beta — feature inmadura.

Todos requieren setup manual per custom domain (no se integra con `place_domain.verified_at` automático). El "ahorro" de no escribir 700 LOC se paga con (a) setup ops manual por dominio + (b) vendor lock-in + (c) cost growth. Rechazados por mismatch de modelo (Place es plataforma, no apps multi-tenant tradicionales).

### A4. HMAC SHA-256 signed payload (DiscourseConnect pattern)

Pattern Discourse: payload `base64(userInfo) + sig=HMAC(payload, secret)`. Simple pero:
- HMAC = symmetric key shared apex ↔ redeem. Si Lambda warm del custom domain se compromete, signing key se filtra → atacante mintea sus propios payloads.
- jose ES256 asymmetric: el redeem verifica con public key vía JWKS, sin tener acceso al signing key. Si custom domain Lambda se compromete, el atacante puede leer cookies pero no mintear tickets.

ES256 gana en compromise resistance + forward-compat de rotation. HMAC se descartó.

### A5. Compartir cookie cross-domain via `Domain=.place.community` + `Domain=.nocodecompany.co`

No funciona. RFC 6265: cookie `Domain` debe ser un suffix del host del Set-Cookie. Apex no puede setear cookie con `Domain=.nocodecompany.co` (browser rechaza). Cookies son per-registrable-domain. Esto fue lo que motivó toda la arquitectura cross-domain SSO desde ADR-0001.

### A6. Persistir tickets emitidos en DB (no jti consumption — full ticket lifecycle tracked)

Patrón "issued_tickets" table con `consumed_at`. Más simple anti-replay (mismo SELECT-UPDATE) pero:
- Cada issue = 1 INSERT extra (apex DB). Volumen N tickets/sec de owners → N inserts.
- Storage growth linear (jti's no purge si no expire-based GC).
- jti consume con GC oportunista = simpler + más eficiente.

Rechazado por overhead innecesario. jti consume es equivalente cryptographically + más barato.

### A7. Audience binding implícito (sin `aud` claim, sólo cookie scope)

Sin `aud` claim, un ticket emitido para `nocodecompany.co` podría ser usado en `otrocustomdomain.com` (atacante intercepta ticket de un host + lo redeems en otro). Cookie scope no protege (la cookie `__Host-place_sso_session` se setea en el host del redeem; pero el atacante sólo necesita exchange el ticket en SU host).

Audience binding (`aud` claim + redeem valida `aud === host actual`) cierra el gap. jose `jwtVerify({audience})` lo hace automático + re-check manual = defense-in-depth.

### A8. Single endpoint `/api/auth/sso` que multiplexea init/issue/redeem según query

Más conciso pero peor para:
- Mounting: init y redeem en custom domain, issue en apex. Single endpoint requiere lógica de "soy apex o soy custom domain" interna. Ramifica los 3 paths en 1 file → más LOC que 3 files cohesivos.
- Logging: distinguir paths por log structured field requiere parsear query siempre.
- Tests: matrix de query × scenario más confusa que 3 files cada uno con sus tests.

Rechazado por DRY-violation falso (los 3 endpoints son distintos en mounting + intent + side effects). 3 endpoints separados son canónicos en pattern (Circle, Discourse, etc.).

### A9. State cookie firmada con env var separada (`PLACE_SSO_STATE_HMAC_SECRET`)

Más env var. Rechazado: HKDF de la signing key principal con `info=` de uso específico es deterministico, seguro, y reduce la cantidad de env vars a gestionar. Pattern documented in RFC 5869 + standard practice in jose ecosystem.

### A10. Local session JWT NO incluye `host` claim

Sin `host` claim, un atacante con acceso al cookie de `nocodecompany.co` puede inyectarlo en `otrocustomdomain.com` (mismo signer apex, mismo `sub`, mismo `exp`). `verifyLocalSession` no detectaría el robo.

Con `host` claim + validación manual contra host del request actual: defense-in-depth. Rechazado el approach sin host claim.

### A11. Mover `<AuthGateForCustomDomain>` del slice `custom-domain-routing` a `custom-domain-sso/`

Tentación de "agrupar lo de SSO en un lugar". Rechazado:
- `<AuthGateForCustomDomain>` es de Feature B; consumer existing (Feature B settings pages) lo importa de `custom-domain-routing/public.ts`.
- Mover = breaking change a Feature B internal API + churn de import paths.
- El componente sigue siendo "fallback CTA cuando SSO falla", semánticamente del slice `custom-domain-routing` (que orquesta el routing UX).
- `<SsoFallbackPanel>` se monta también en el slice `custom-domain-routing` por cohesión (mismo dominio: UX cuando custom domain visitor falla auth).

Rechazado por preservar contratos públicos de slices existentes.

### A12. Endpoint `/api/auth/sso-redeem` renderea HTML directo (no redirect a page UI)

Más conciso (1 file route handler con render). Rechazado:
- Mezcla handler con view (anti-pattern de separation of concerns).
- Tests del handler requieren parseo de HTML response (más frágil).
- Cache headers + redirect statuses son más diagnostic-friendly que HTML payloads.
- Pattern existente en repo: handlers redirect, pages render. Consistente.

## Consecuencias

### Inmediatas (al cerrar S11 de Feature C)

- `nocodecompany.co/settings` con owner autenticado en apex → silent SSO completa < 1s + render settings normal. Promesa de ADR-0001 §1 "SSO silencioso cross-domain" cumplida.
- `nocodecompany.co/settings` sin sesión apex → redirect a apex login con `returnTo=/api/auth/sso-issue?...` preservado → tras login → SSO completa.
- Cualquier error de SSO (state mismatch, jti replay, expired, etc.) → `<SsoFallbackPanel>` con código + retry CTA + canon fallback CTA. UX honesta + recoverable.
- Subdomain canónico `mi-place.place.community/settings` → comportamiento idéntico pre-C (no regresión).
- Apex `place.community` → comportamiento idéntico pre-C salvo el nuevo `/api/auth/sso-jwks` endpoint público.

### Forward-compat con cron safety net (#103 — importancia AUMENTA de nuevo post-C)

ADR-0026 §1 + ADR-0031 §"Forward-compat con cron safety net" ya documentan que el cron `*/15` gana importancia post-B. **Post-C la importancia técnica del cron sube de nuevo**:

- **Escenario post-C que se vuelve problemático**: owner verifica dominio → 2 meses después DNS se rompe → `verified_at IS NOT NULL` queda stale. Owner intenta SSO desde apex → silent SSO arranca → sso-issue valida `aud` via `lookupPlaceByDomain(aud)`. Cuando ADR-0029 ya garantiza que un `getCustomDomainStatus` posterior detectaría el DNS roto y resetearía `verified_at`, **el silent SSO no dispara `getCustomDomainStatus`** (es zona-routing, no zona-management). Resultado: ticket válido emitido, redeem en custom domain con SSL Vercel roto → fallo de red, no `sso_error`. Owner ve "este sitio no se puede alcanzar".

- **Mitigation V1 (post-C)**: documentar el risk en este ADR (acá) + sugerir #103 como follow-up necesario post-C. Si en producción se observa una sola instancia del escenario, activar #103.

Cron sigue NO siendo blocker de C, pero post-C se acumula deuda operativa con cada feature.

### Cost budget post-C

- Apex `/api/auth/sso-issue`: 1 query Neon iad1 (`lookup_place_by_domain` deduped intra-request si llamada otra vez) + 1 sign operation jose ES256 (~5ms). p95 < 50ms.
- Apex `/api/auth/sso-jwks`: 0 queries (pure compute, key cached singleton). 5min cache header. p95 < 5ms.
- Custom domain `/api/auth/sso-init`: 1 query (`lookup_place_by_domain` deduped). p95 < 30ms.
- Custom domain `/api/auth/sso-redeem`: 1 fetch JWKS (jose intra-process cache 5min — segundo request del mismo Lambda warm = 0 fetch) + 1 verify operation + 1 query `consume_sso_jti` + 1 sign (mint local session). p95 < 80ms cold, < 30ms warm.

**Total user-perceived**: 3-4 redirects HTTP × p95 50-100ms each = ≤400ms end-to-end. Sub-second.

### Backwards compat

- **Stale tabs pre-deploy**: cookie session local no existe pre-Feature C → page redirige a sso-init → flow funciona. No regression.
- **`oauth_client_id` column legacy**: queda nullable + deprecated comment + forward-compat documentado en `data-model.md`. No DROP V1 (idempotente migration en proceso, no destructive).
- **`<AuthGateForCustomDomain>` (Feature B)**: locked, accesible vía CTA del fallback panel. Owner que tenía bookmarked el flow educativo lo sigue viendo si SSO falla.

### Topología "dos mundos" se mantiene

ADR-0001 §1 lo descriptivo:
- `*.place.community` (subdomains + inbox): cookie cross-subdomain `Domain=.place.community` (Neon Auth managed).
- Custom domains: sesión local propia (cookie `__Host-place_sso_session`, JWT firmado por apex).

**Cómo se conectan los dos mundos** evolve:
- ADR-0001 §1 (descriptivo): "SSO silencioso vía auth code, sin compartir cookies cross-domain" → mantained.
- ADR-0001 §3 (prescriptivo): "Un OIDC client confidencial por custom domain" → **supersede**: Signed Ticket no requiere client per dominio.

### `app_user` sin cambio

ADR-0001 §2 ("identidad de producto separada de la de login, 1:1 vía `app_user.auth_user_id UNIQUE`") sigue intacta. El Signed Ticket pasa el `sub` (= `neon_auth.user.id`); el redeem mintea local session con el mismo `sub`; `app.current_user_id()` retorna el mismo valor; `ensureAppUser` ya corrió en signup del owner originalmente.

**Edge case**: si por bug un `sub` viene del ticket pero el `app_user` no existe (e.g. owner se tombstoned post-signup pero la sesión apex sigue válida por unos ms), RLS retorna 0 rows en `app_user` → la página owner-only ve `notFound()` o data null. No es vulnerabilidad, es null safety. Test S4/S9 lo cubre.

## Detalle operativo canónico

- **ADR canónica de Feature C (este archivo)**: `docs/decisions/0032-custom-domain-sso-signed-ticket.md` (S0).
- **Spec del slice nuevo**: `docs/features/custom-domain-sso/spec.md` (S0). Incluye flow técnico, copy localizado del fallback panel, security checklist final.
- **Tests checklist**: `docs/features/custom-domain-sso/tests.md` (S0). ~80 tests proyectados.
- **Plan-sesiones (write-back)**: `docs/features/custom-domain-sso/plan-sesiones.md` (S0 esqueleto, S11 close).
- **Banners de refinement**:
  - `docs/decisions/0001-auth-oidc-custom-domains.md` recibe banner "Refinada por ADR-0032 (Signed Ticket, no OIDC canónico)" (S0).
  - `docs/decisions/0026-custom-domain-v1-lazy-verification.md` recibe banner "ADR-0027 OBSOLETA — Signed Ticket no requiere provisioning per-domain" (S0).
  - `docs/decisions/0031-custom-domain-routing-v1.md` recibe banner "§11 obsoleta — Feature C cierra el gap con Signed Ticket" (S0).
  - `docs/decisions/README.md` agrega entry 0032 + notas refinamiento (S0).
- **Reescritura legacy en docs canónicos**:
  - `docs/stack.md` línea 16 reescrita: "Place implementa SSO cross-domain via Signed Ticket pattern (ADR-0032)" + §env vars con `PLACE_SSO_SIGNING_KEY` + KID (S0).
  - `docs/data-model.md` líneas 95-98 (comentario SQL `oauth_client_id`) + línea 115 + §"Auth y OIDC" 220-226 reescritas (S0).
  - `docs/architecture.md` §"Sesión y SSO" líneas 45/50/52/54 reescritas (S0).
  - `docs/multi-tenancy.md` líneas 87/108/110 reescritas (S0).
- **Gotchas nuevos** (S0):
  - `docs/gotchas/host-prefix-cookie-path.md` — `__Host-` prefix obliga `Path=/`.
  - `docs/gotchas/sso-signing-key-no-log.md` — `PLACE_SSO_SIGNING_KEY` nunca en logs.
  - `docs/gotchas/README.md` índice updated.
- **Migration 0011** (S1): `src/db/migrations/0011_sso_jti_consume.sql` + `_journal.json` entry idx=11.
- **Tests RLS de la migration** (S1): `src/db/__tests__/consume-sso-jti.test.ts`.
- **Helpers puros sso/** (S2-S4):
  - `src/shared/lib/sso/sso-keys.ts` (S2 — loadSigningKey, loadPublicJwks).
  - `src/shared/lib/sso/sso-ticket.ts` (S2 — signSsoTicket, verifySsoTicket, types).
  - `src/shared/lib/sso/sso-state.ts` (S3 — CSRF cookie HMAC + returnTo validation).
  - `src/shared/lib/sso/sso-session.ts` (S4 — local session JWT mint+verify).
  - `src/shared/lib/sso/db-with-verifier.ts` (S4 — RLS bridge).
  - `src/shared/lib/sso/sso-jti-consume.ts` (S8 — wrapper anonymous-safe).
  - `src/shared/lib/sso/index.ts` (S2 — barrel).
- **JWKS endpoint** (S5): `src/app/api/auth/sso-jwks/route.ts`.
- **i18n keys nuevos** (S6): `customDomainRouting.sso.{loading, failureTitle, failureBody, fallbackCta, retry}` × 6 locales (`es/en/fr/pt/de/ca`).
- **Componente nuevo** (S6): `src/features/custom-domain-routing/ui/sso-fallback-panel.tsx`. Public barrel `src/features/custom-domain-routing/public.ts` extendido con export.
- **Issuer apex** (S7): `src/app/api/auth/sso-issue/route.ts`.
- **Init + Redeem custom domain** (S8): `src/app/api/auth/sso-init/route.ts` + `src/app/api/auth/sso-redeem/route.ts`.
- **Wire `getSessionTokenForZone`** (S9): adaptación de `src/app/(app)/place/[placeSlug]/_lib/get-place-for-zone.ts` (return shape evolve) + 3 callers updated.
- **Silent SSO trigger en settings** (S10): branches en `src/app/(app)/place/[placeSlug]/settings/page.tsx` + `settings/domain/page.tsx`.
- **Smoke + push** (S11): smoke E2E local + production + tag `baseline/feature-c-done`.

## Env vars (canónicas, Vercel-only)

```
# Custom Domain SSO (Feature C, ADR-0032) — NUNCA en .env.local committed.
# Generación: openssl ecparam -name prime256v1 -genkey -noout -out tmp.pem
#             openssl pkcs8 -topk8 -nocrypt -in tmp.pem -out signing-pkcs8.pem
#             (contenido de signing-pkcs8.pem → Vercel env)
PLACE_SSO_SIGNING_KEY=          # ES256 PKCS8 PEM private key
PLACE_SSO_SIGNING_KEY_KID=      # short string, e.g. "2026-05-23-r1"
```

Rotación manual cada 90 días; downtime ≤60s (TTL ticket). V2 multi-key rotation diferido.

## Pointers

- **ADR original que estableció topología "dos mundos"**: ADR-0001 §1 (refinada por esta ADR; §3 superseded).
- **ADR que difirió OIDC client provisioning**: ADR-0026 §4 (banner obsolescencia en S0).
- **ADR que documentó auth gap UX V1 (gate educativo)**: ADR-0031 §4 + §11 (§11 obsoleta banner en S0).
- **ADRs del slice anfitrión `custom-domain-routing`**: ADR-0031 (`<AuthGateForCustomDomain>` locked + reusado vía CTA del fallback panel).
- **ADRs RLS + identidad**: ADR-0006 (rol `app_system`), ADR-0010 (RLS por-operación), ADR-0011 (`app.current_user_id()`), ADR-0012 (pattern SECURITY DEFINER).
- **ADRs i18n**: ADR-0022 (DB-based del place), ADR-0024 (fallback deep-merge).
- **Cap LOC**: `CLAUDE.md` §"Límites de tamaño" — sub-módulo `src/shared/lib/sso/` con sub-cap 800 propio.
- **Driver Neon (ws)**: ADR-0018 §"Driver = neon-serverless" — `consume_sso_jti` wrapper sigue el patrón.
- **`React.cache()` dedup**: precedente en `src/app/(app)/place/[placeSlug]/_lib/get-place-for-zone.ts` — `getSessionTokenForZone` mantiene wrapping post-S9.
- **JWT primitives (jose)**: `src/shared/lib/jwt.ts` (existing, Neon Auth-only — **locked en Feature C**). Sso uses jose directly desde sub-módulo `sso/`.
- **Industry survey 2026-05-22**: Circle.so (`developers.circle.so/docs/sso-overview`) · Discourse (`meta.discourse.org/t/discourseconnect`) · Memberstack (`docs.memberstack.com/hc/en-us/articles/sso`) — referencia público-validada del pattern Signed Ticket.
