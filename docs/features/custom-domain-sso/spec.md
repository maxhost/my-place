# Custom Domain SSO — Spec

> _Spec creado 2026-05-22 · Last-updated 2026-05-23 (S11.3.D close). **Status: V1 CERRADA end-to-end — T1.1 + T1.2 + T1.3 (cold-start M1) deployed + smoke production verde** ✅. Implementación cierra el sub-módulo `src/shared/lib/sso/` (sub-cap LOC 1400 propio, ver ADR-0032 §5 addenda) + 4 endpoints API (`/api/auth/sso-{init,issue,redeem,jwks}`) + 1 componente nuevo `<SsoFallbackPanel>` montado en el slice existente `custom-domain-routing` + sub-sesión S11.1 (fix JWKS redirect Opción D, ADR-0032 §12) + sub-sesión S11.2 (fix zone-cookie unawareness Opción B: nuevo helper `getAuthenticatedDbForRequest` zone-aware en `src/shared/lib/db-for-request.ts`/`-decision.ts` + migración de 4 Server Actions broken-on-custom-domain) + sub-sesión S11.3 (fix cold-start M1, ADR-0033: helper PURE `validateLoginReturnTo` + wire-up minimal en `page.tsx` apex + `AccessFlow` cliente; `useAccessForm` intacto). Decisiones canónicas en [ADR-0032](../../decisions/0032-custom-domain-sso-signed-ticket.md) + [ADR-0033](../../decisions/0033-apex-login-honors-returnto.md). Plan ejecutado (sesiones + write-back con SHAs reales) en [`./plan-sesiones.md`](./plan-sesiones.md). Baseline pre-implementación: `baseline/pre-feature-c` (= `baseline/feature-b-done` = `d20ab00`). Baseline S11.2: `baseline/feature-c-s11.2-done` = `17b5df5`. Baseline S11.3 pre-fix: `baseline/pre-s11.3-fix-returnto` = `17b5df5` (= S11.2-done). Baseline final S11.3: `baseline/feature-c-s11.3-done` (close commit de este write-back)._

## Contexto

Feature B (slice `custom-domain-routing`, deploy `1dea7b5`/`a1d354f`, 2026-05-22) cerró el routing real custom-domain → place: el visitante en `nocodecompany.co/` ve el contenido del place servido sin cambiar la URL del browser. Feature B documentó explícitamente el **auth gap V1**: la cookie de sesión Neon Auth está scopeada a `Domain=.place.community`, así que los owners autenticados en `place.community` no tienen sesión local en su custom domain. El componente `<AuthGateForCustomDomain>` (Feature B) ofrece copy educativo + CTA al subdomain canónico — UX honesta pero requiere click extra.

Feature C cierra ese gap **estructuralmente**. ADR-0001 §1 anticipó "SSO silencioso cross-domain"; ADR-0001 §3 prescribió "OIDC client confidencial por custom domain provisioned al verificar". Cuatro rondas de agentes paralelos (2026-05-22) validaron que la prescripción §3 NO se sostiene contra el stack actual: el plugin `oidcProvider` de Better Auth no está accesible desde Neon Auth managed; `oidc-provider` (panva) requiere ~1500-2000 LOC de Postgres adapter custom + Koa→Next bridge; la industria comparable (Circle, Discourse, Memberstack) usa **Signed JWT Ticket pattern**, no OIDC canónico.

ADR-0032 supersede ADR-0001 §3: Feature C implementa **Signed Ticket**. El apex (`place.community`) mintea JWTs ES256 short-lived (60s) que el custom domain redime para emitir su propia cookie host-only (`__Host-place_sso_session`, 7d). Continuidad RLS sin refactor: el `sub` del local session JWT === `neon_auth.user.id` → `app.current_user_id()` retorna el mismo valor cross-domain.

**Relación con Feature B**. Feature B queda intacta en código: el componente `<AuthGateForCustomDomain>` no se modifica, sigue accesible como CTA fallback dentro del nuevo `<SsoFallbackPanel>`. El proxy matcher ya excluye `/api/*` correctamente — los 4 endpoints nuevos no requieren tocar `src/proxy.ts`. El wrapper `lookupPlaceByDomain` (Feature B) se reusa en 3 callers nuevos (sso-init, sso-issue, sso-redeem) sin modificación.

## Slice

**Nombre canónico**: `custom-domain-sso` (sin slice `src/features/custom-domain-sso/`). El módulo nuevo vive en `src/shared/lib/sso/` con sub-cap LOC 800 propio. Los Server Actions y la UI no existen como concepto cohesivo (el flow es server-side redirect chain, no form interactivo); un slice acá sería ceremonia sin beneficio. Decisión documentada en ADR-0032 §5.

**LOC budget**:

- `src/shared/lib/sso/` sub-cap propio: **800 LOC** (separado del shared/lib raíz). Proyección post-S4: ~680 LOC; post-S8: ~710 LOC + barrel ~20 = ~730 LOC.
- `src/features/custom-domain-routing/ui/sso-fallback-panel.tsx`: ~80 LOC (cuenta hacia el cap 1500 del slice existente).
- Endpoints `/api/auth/sso-*`: ~50 (jwks) + ~150 (issue) + ~120 (init) + ~180 (redeem) = ~500 LOC en `src/app/api/auth/`.

**Dependencies**:

- `jose@^6` (ya en deps, sin upgrade): `importPKCS8`, `exportJWK`, `SignJWT`, `jwtVerify`, `createRemoteJWKSet`.
- `@neondatabase/serverless` (ws driver, ADR-0018): pool para `consume_sso_jti`.
- `next` server primitives: `cookies()`, `headers()`, `NextResponse.redirect`.
- Helpers existentes reusados: `lookupPlaceByDomain` (Feature B), `getSessionJwt` + `verifyAccessToken` (Feature A), `buildApexAuthFallback` (Feature B).

**Public surface (TBD post-S6)**: el barrel `src/shared/lib/sso/index.ts` expone:

```typescript
// Sign/verify (S2)
export { signSsoTicket, verifySsoTicket, SsoTicketError } from './sso-ticket';
export type { SsoTicketClaims } from './sso-ticket';
// Keys (S2)
export { loadSigningKey, loadPublicJwks, SsoKeyConfigError } from './sso-keys';
// State cookie (S3)
export { generateState, generateNonce, signStateCookie, verifyStateCookie } from './sso-state';
export { validateReturnTo, STATE_COOKIE_NAME, STATE_COOKIE_MAX_AGE } from './sso-state';
// Local session (S4)
export { mintLocalSession, verifyLocalSession, LOCAL_SESSION_COOKIE_NAME, LOCAL_SESSION_MAX_AGE } from './sso-session';
// DB bridge (S4)
export { getAuthenticatedDbWithVerifier, getCustomDomainDb } from './db-with-verifier';
export type { TokenVerifier } from './db-with-verifier';
// jti consume (S8)
export { consumeSsoJti } from './sso-jti-consume';
```

El slice `custom-domain-routing` extiende su `public.ts` con `SsoFallbackPanel` + `SsoFallbackLabels` (S6).

## Flow técnico V1

Los 4 endpoints implementan el flow canónico de ADR-0032 §2. Cada step lista propósito + side effects + error paths.

### Step 1 — `GET /api/auth/sso-init` (custom domain)

Entry point del silent SSO. Query: `?returnTo=<path>`.

**Propósito**: generar `state` + `nonce` CSRF, persistirlos en cookie host-only del custom domain, redirigir al apex issuer.

**Side effects**:

1. Parse query con Zod schema strict. `returnTo` default `/`.
2. `validateReturnTo(returnTo)` (open-redirect guard, ver §"Continuidad RLS" y ADR-0032 §3).
3. `lookupPlaceByDomain(host)` (reusa wrapper Feature B, cache `React.cache()` ya activa si proxy ya lo invocó intra-request). Null → 404 (host no verified).
4. `generateState()` + `generateNonce()` (`crypto.randomBytes` base64url, 32 / 16 bytes).
5. `signStateCookie(state, nonce, key)` (HMAC SHA-256 con HKDF de la signing key principal — `info='place_sso_state_hmac_v1'`).
6. Setea `__Host-place_sso_state` con `Max-Age=120`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, sin `Domain`.
7. Redirect 302 a `https://place.community/api/auth/sso-issue?aud=<host>&state=<state>&nonce=<nonce>&returnTo=<returnTo>`.

**Error paths**: lookup null → 404 explícito (no leak); `returnTo` malicioso → reemplazado por `/` (silencioso, no 400). Sin sesión apex en este step (el issue verifica eso).

**Cita**: ADR-0032 §2 step 1.

### Step 2 — `GET /api/auth/sso-issue` (apex)

Issuer del ticket firmado. Query: `?aud=<host>&state=<>&nonce=<>&returnTo=<>`.

**Propósito**: emitir un JWT ES256 short-lived (60s) con `sub=<neon_auth.user.id>` + `aud=<custom_domain>` + `jti` único + nonce/state echo.

**Side effects**:

1. Parse query con Zod schema strict (todos los campos required).
2. `lookupPlaceByDomain(aud)` → null = 400 `invalid_audience` (sin leak detalles).
3. `getSessionJwt()` (apex Neon Auth cookie) → null = redirect a `https://place.community/{locale}/login?returnTo=<encoded sso-issue URL>` (preserva flow tras login).
4. `verifyAccessToken(jwt)` → falla = 401.
5. `signSsoTicket({iss:'place.community', sub:<extracted from JWT>, aud:<host>, nonce, state, jti:randomUUID(), iat:now(), exp:now()+60s, kid:<env KID>})`.
6. Re-validar `returnTo` (defense-in-depth — el redeem re-valida una tercera vez).
7. Redirect 302 a `https://<aud>/api/auth/sso-redeem?ticket=<jwt>&state=<state>&returnTo=<returnTo>`.

**No setea cookies** (las cookies del flow viven en custom domain).

**Error paths**: `aud` no verified → 400 `invalid_audience`; sin sesión apex → redirect a login con returnTo preservado; sesión inválida → 401; `returnTo` malicioso → sanitizado a `/`.

**Cita**: ADR-0032 §2 step 2.

### Step 3 — `GET /api/auth/sso-redeem` (custom domain)

Redime el ticket. Query: `?ticket=<jwt>&state=<>&returnTo=<>`.

**Propósito**: verificar ticket vs JWKS apex + state cookie + jti single-use, emitir local session.

**Side effects**:

1. Lee + verifica state cookie con `verifyStateCookie` → null/invalid = redirect `returnTo + '?sso_error=state_invalid'`.
2. Constant-time comparison del `state` query vs state cookie. Mismatch = `?sso_error=state_mismatch`.
3. Carga JWKS apex con `createRemoteJWKSet(new URL('https://place.community/api/auth/sso-jwks'))` (jose cachea intra-process por 5min).
4. `verifySsoTicket(ticket, host, jwks)` → throws con `SsoTicketError` mapeado a `?sso_error=<code>` (`expired`, `signature_invalid`, `aud_mismatch`, `missing_claim`, `iss_wrong`).
5. Valida `nonce` del ticket === nonce del state cookie.
6. Re-valida `aud === host` actual (defense-in-depth, jose ya lo hizo).
7. Consume `jti` vía `consumeSsoJti(jti, exp)` (wrapper TS sobre `app.consume_sso_jti`). False = `?sso_error=replay`.
8. `mintLocalSession({sub, host})` → cookie `__Host-place_sso_session` (HttpOnly, Secure, SameSite=Lax, Path=/, `Max-Age=7d`).
9. Borra state cookie (`Max-Age=0`).
10. Re-valida `returnTo` + redirect 302 a path interno.

**Error paths SIEMPRE redirigen, nunca renderean HTML**. Separación clean: handler = API; page de UI consume `?sso_error=<code>` query y renderiza `<SsoFallbackPanel>`. Pattern documentado en ADR-0032 §2 + §A12.

**Cita**: ADR-0032 §2 step 3.

### Step 4 — `GET /api/auth/sso-jwks` (apex)

JWKS público para que custom domains verifiquen tickets.

**Propósito**: exponer la public key derivada de `PLACE_SSO_SIGNING_KEY` para verification distribuida sin compartir secrets.

**Side effects**:

1. `loadPublicJwks()` (singleton lazy, deriva `JWK` desde `loadSigningKey()`).
2. Retorna body `{keys: [{kty:'EC', crv:'P-256', x:'…', y:'…', kid:'<KID>', use:'sig', alg:'ES256'}]}` con `Content-Type: application/jwk-set+json` + `Cache-Control: public, max-age=300, s-maxage=300` (5min).

**Sin auth**: JWKS es público por definición (RFC 7517). 0 PII; sólo la curva + coordenadas + kid.

**Cita**: ADR-0032 §2 step 4.

## Cookies del flow

Dos cookies nuevas, ambas `__Host-` prefix. Shape exacto:

| Cookie | Hosting | TTL | Atributos | Propósito |
|---|---|---|---|---|
| `__Host-place_sso_state` | custom domain (efímera) | 120s | `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, **sin `Domain`** | CSRF + nonce echo del flow `init → issue → redeem` |
| `__Host-place_sso_session` | custom domain (long-lived) | 7d | `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, **sin `Domain`** | Sesión local del custom domain (JWT firmado por apex con claim `host`) |

**TTL `__Host-place_sso_state`**: 120s = 60s ticket exp + 60s buffer para latencia browser. Si el flow se demora > 120s (e.g. usuario hace login en apex en otra pestaña + vuelve), la cookie expiró → `sso_error=state_invalid` → retry.

**TTL `__Host-place_sso_session`**: 7d = balance entre UX (no re-SSO frecuente) y seguridad (rotación natural si Neon Auth invalida la sesión apex, el próximo silent SSO falla → user re-loguea). V2 considera shorter TTL + refresh; V1 ship simple.

**Por qué `__Host-` prefix (NO `__Secure-` ni unprefixed)**:

- `__Host-` enforce browser-side: cookie DEBE tener `Secure`, `Path=/`, **NO** `Domain` attribute (host-only). Si el handler emite la cookie con cualquier otro shape, el browser la rechaza silently.
- Defense-in-depth contra misconfiguration accidental — si por bug se setea `Path=/api` o `Domain=.example.com`, el navegador no la persiste y el flow falla loud (`sso_error=state_invalid` en próximo redeem), no silently degrade.

**Por qué `SameSite=Lax` (NO `Strict`, NO `None`)**:

- `Lax` permite que el cookie viaje en navegaciones top-level cross-site (`<a href>`, `window.location`) — necesario para que el redeem reciba state cookie tras venir de `/api/auth/sso-issue` del apex.
- `Strict` bloquearía el flow.
- `None` requiere `Secure` (OK) pero abre superficie a CSRF.

**Cita**: ADR-0032 §3.

## UX silent SSO + fallback

### Happy path

Owner con sesión apex válida visita `nocodecompany.co/settings`:

1. Layout custom-domain detecta `hostZone.zone === 'custom-domain'` + sin sesión local (S9 wire-up) → `redirect('/api/auth/sso-init?returnTo=/settings')`.
2. `init` setea state cookie + redirect 302 a `https://place.community/api/auth/sso-issue?...`.
3. `issue` verifica sesión apex válida + mintea ticket + redirect 302 a `https://nocodecompany.co/api/auth/sso-redeem?...`.
4. `redeem` verifica todo + setea session local + redirect 302 a `/settings`.
5. Browser navega a `/settings` con cookie session → layout ve sesión válida → render normal.

**Total: 4 redirects HTTP 302, sub-segundo**. Server-side redirect chain — funciona en cualquier browser, sin requirement de JavaScript habilitado. Sin spinner, sin parpadeo perceptible.

### Failure path

Cualquier error en init/issue/redeem → redirect a `returnTo + '?sso_error=<code>'`. El page settings ve cookie session ausente + `searchParams?.sso_error` presente → render `<SsoFallbackPanel>` (componente nuevo del slice `custom-domain-routing`).

**`<SsoFallbackPanel>`** props: `{canonicalUrl, labels, errorCode?}`. Renderiza:

- **Title** localizado.
- **Body** con `{slug}` resuelto + raw `**` markdown bold (mismo pattern que `<AuthGateForCustomDomain>`).
- **`errorCode`** en `<details>` colapsable (debug-friendly, no asustar al usuario).
- **CTA primario**: link al subdomain canon (reusa `buildApexAuthFallback` de Feature B). Semánticamente equivalente al CTA del `<AuthGateForCustomDomain>`.
- **CTA secundario**: link "Reintentar" a `/api/auth/sso-init?returnTo=<...>`.

**`<AuthGateForCustomDomain>` (Feature B) queda locked** — no se modifica. Ya NO es el branch primario sin-sesión (ahora se dispara silent SSO primero), pero queda accesible vía el CTA del `<SsoFallbackPanel>` (mismo destino: `https://{slug}.place.community/{locale}{returnPath}`). Decisión documentada en ADR-0032 §8 + §A11.

### Sin loop automático V1

Si retry falla, owner ve fallback de nuevo. No counter de attempts en cookie (V2 podría track `sso_attempts` y bloquear tras N para evitar tight loops si owner clicked accidentally). V1 simple = honestidad + agencia del owner.

### Copy localizado canónico (es)

Namespace nuevo `customDomainRouting.sso.*` × 6 locales (`es/en/fr/pt/de/ca`). Canon `es.json`:

```json
"sso": {
  "loading": "Iniciando sesión…",
  "failureTitle": "No pudimos iniciarte sesión automáticamente",
  "failureBody": "Hubo un inconveniente al verificar tu identidad para **{slug}**. Podés volver a tu URL canónica para iniciar sesión manualmente.",
  "fallbackCta": "Ir a {slug} en place.community",
  "retry": "Reintentar"
}
```

Paridad estricta enforced por `scripts/check-translations.mjs` (0/0 × 5 esperado post-S6).

## Continuidad RLS

El `sub` del local session JWT === `neon_auth.user.id` original → `app.current_user_id()` retorna el mismo valor en cualquier zona. Cero refactor de policies, cero migration de identidad.

**Cómo se logra**:

1. En `/api/auth/sso-issue`, el apex extrae `sub` del JWT Neon Auth de la sesión activa (`verifyAccessToken(jwt)`).
2. Ese `sub` se mintea en el ticket (`signSsoTicket({sub, ...})`).
3. En `/api/auth/sso-redeem`, el custom domain extrae el `sub` del ticket verificado y lo mintea en el local session JWT (`mintLocalSession({sub, host})`).
4. `getSessionTokenForZone` (S9) en zona custom-domain retorna `{token, source:'sso-local'}`.
5. `getPlaceForZone` ramifica el verifier: para `source='sso-local'` usa `getCustomDomainDb(sessionToken, fn)` que internamente llama `getAuthenticatedDbWithVerifier(token, verifyLocalSession, fn)`.
6. El verifier extrae `{sub}` y lo inyecta como `request.jwt.claims` tx-local → `app.current_user_id()` retorna el mismo valor que en apex.

**`app_user` invariante**: ADR-0001 §2 (identidad 1:1 vía `app_user.auth_user_id`) se preserva. El `ensureAppUser` ya corrió en el signup original del owner; el SSO no crea ni modifica `app_user`. Edge case: si el owner fue tombstoned post-signup pero la sesión apex sigue válida por unos ms, RLS retorna 0 rows en `app_user` → page owner-only ve `notFound()` o data null (null safety, no vulnerabilidad). Cubierto por tests S4/S9.

**Cita**: ADR-0032 §6 + §7 ("RLS bridge — `getAuthenticatedDbWithVerifier`").

## Audience binding + jti consume

Defense-in-depth contra dos clases de ataque:

### Audience binding (anti cross-ticket reuse)

Sin `aud` claim, un ticket emitido para `nocodecompany.co` podría ser usado en `otrocustomdomain.com` (atacante intercepta ticket + lo redeems en SU host).

**Cómo se cierra**:

1. El issue setea `aud=<host>` en el ticket.
2. El redeem llama `verifySsoTicket(ticket, host, jwks)` con `host = headers().get('host')` actual. jose `jwtVerify({audience: host})` valida automático.
3. Re-check explícito post-verify: `if (claims.aud !== currentHost) throw new SsoTicketError('aud_mismatch')`.

**Cita**: ADR-0032 §4 + §A7.

### jti consume (anti-replay)

Sin tracking de jtis consumidos, un atacante con red sniff podría re-redimir el mismo ticket dentro de los 60s de TTL.

**Cómo se cierra**:

1. Cada ticket lleva `jti=randomUUID()`.
2. El redeem llama `consumeSsoJti(jti, exp)` → wrapper sobre `app.consume_sso_jti(p_jti, p_exp)` (migration 0011, SECURITY DEFINER, ON CONFLICT DO NOTHING + ROW_COUNT atómico).
3. Primer intento: INSERT OK → retorna `true`.
4. Segundo intento (replay): ON CONFLICT → 0 rows → retorna `false` → `sso_error=replay`.

**GC oportunista**: cada consume hace `DELETE FROM app.sso_jti_used WHERE expires_at < now()` antes del INSERT. No requiere cron separado. Volumen MVP esperado < 10 consumes/min → DELETE micro.

**Race condition**: dos redeems concurrent del mismo ticket = exactly one INSERT wins por `PRIMARY KEY (jti)` + `ON CONFLICT DO NOTHING`. El otro retorna `false`. Cubierto por test S1 concurrent `Promise.all([consume(jti), consume(jti)])`.

**Cita**: ADR-0032 §4 + §A6.

## Setup ops Vercel env vars

Dos env vars nuevas, **Vercel-only**, NUNCA en `.env.local` committed:

```
PLACE_SSO_SIGNING_KEY=          # ES256 PKCS8 PEM private key
PLACE_SSO_SIGNING_KEY_KID=      # short string, e.g. "2026-05-23-r1"
```

**Generación canónica**:

```bash
openssl ecparam -name prime256v1 -genkey -noout -out tmp.pem
openssl pkcs8 -topk8 -nocrypt -in tmp.pem -out signing-pkcs8.pem
# contenido de signing-pkcs8.pem → Vercel dashboard env var PLACE_SSO_SIGNING_KEY
# kid = fecha + revisión (e.g. "2026-05-23-r1") → PLACE_SSO_SIGNING_KEY_KID
rm tmp.pem signing-pkcs8.pem   # NUNCA committed
```

**Setear en**: Vercel dashboard, environments **production + preview** (preview branches del PR pipeline necesitan testear el flow). Confirm con `vercel env ls`.

**NUNCA en**: `.env.local` committed, GitHub repo, logs, comentarios de PR, screenshots, screen recordings.

**Cita**: ADR-0032 §10.

## Rotación operacional V1 (manual cada 90d)

V1 = single-key. Rotación manual cada 90 días con downtime ≤60s.

**Procedure step-by-step**:

1. Generate new keypair:
   ```bash
   openssl ecparam -name prime256v1 -genkey -noout -out tmp.pem
   openssl pkcs8 -topk8 -nocrypt -in tmp.pem -out signing-pkcs8.pem
   ```
2. Update Vercel env `PLACE_SSO_SIGNING_KEY` con nuevo PEM (production + preview).
3. Update `PLACE_SSO_SIGNING_KEY_KID` con timestamp nuevo (e.g. `2026-08-21-r2`).
4. Trigger redeploy desde Vercel dashboard.
5. **Downtime esperado**: ≤60s = TTL del ticket. Tickets emitidos antes del cutover y consumed después fallarán `signature_invalid`. Owners ven `<SsoFallbackPanel>` con retry → próximo SSO usa nueva key. Acceptable downtime para una rotación 90d (planificable fuera de horario peak).
6. Smoke post-rotation: ejecutar curl scenarios 1-10 (ver §"Smoke ejecutado") contra production.
7. `rm tmp.pem signing-pkcs8.pem` (NUNCA committed).

**V2 deferido** (multi-key zero-downtime): env var array `PLACE_SSO_SIGNING_KEYS_JSON=[{kid,key}, ...]` parseable; el handler `/api/auth/sso-jwks` retorna todas las pubkeys; `verifySsoTicket` matchea por `kid` del JWS header. ADR-0032 §"Difiere a planes posteriores".

## Operational risks documented

Riesgos operacionales conocidos V1, con escenario + mitigation:

1. **Race `archived_at` mid-flow**. Escenario: owner archiva su custom domain (Feature A) entre el issue y el redeem del mismo ticket. Comportamiento: `issue` validó `aud` OK (lookup retornaba row), `redeem` re-valida vía `lookupPlaceByDomain(host)` → ahora retorna null (archived filtra) → `sso_error=invalid_audience`. UX: owner ve fallback panel + CTA al subdomain canon. **Mitigation**: aceptado como behavior correcto (archived domain NO debe servir sesión nueva); ningún token leak.

2. **JWKS 500 desde apex**. Escenario: bug en `/api/auth/sso-jwks` (e.g. env key ausente en deploy nuevo). Comportamiento: `verifySsoTicket` falla con `signature_invalid` (jose no puede cargar JWKS) → `sso_error=signature_invalid`. UX: fallback panel. **Mitigation**: monitorear via `getRuntimeLogs` post-deploy; smoke S11 incluye JWKS endpoint.

3. **Signing key leak en logs**. Escenario: por bug, `PLACE_SSO_SIGNING_KEY` se imprime en `console.log/error` (e.g. wrapped en `JSON.stringify(env)`). Comportamiento: cualquier persona con acceso a Vercel logs puede mintear tickets propios. **Mitigation V1**: gotcha `docs/gotchas/sso-signing-key-no-log.md` + test S2 con mock `console.error/log` que falla si output contiene patterns de signing key (`-----BEGIN`, `kty.*x`, etc.). **Mitigation respuesta**: rotación inmediata (procedure arriba) + rotar también todas las cookies session emitidas durante el período de exposure (efectivamente: TTL 7d garantiza que se rotan natural en ≤7d).

4. **Cron safety net `*/15` (#103) gana importancia post-C**. Escenario: owner verifica dominio → 2 meses después DNS se rompe → `verified_at IS NOT NULL` queda stale. Owner intenta SSO desde apex → silent SSO arranca → sso-issue valida `aud` via `lookupPlaceByDomain(aud)` OK. `redeem` falla en TLS handshake (no es `sso_error`, es network error) → owner ve "este sitio no se puede alcanzar" sin entender que el problema es DNS. **Mitigation**: documentado en ADR-0032 §"Consecuencias" + ADR-0031 §"Forward-compat con cron safety net". Si se observa una sola instancia en producción, activar #103.

## OIDC Conformance Suite NO se corre

Decisión consciente: Place implementa **Signed Ticket pattern**, NO OIDC canonical. Los endpoints `/api/auth/sso-{init,issue,redeem,jwks}` NO son OIDC endpoints (no `/authorize`, no `/token`, no `/.well-known/openid-configuration`, no userinfo, no end_session).

**Por qué NO correr OIDC Conformance Suite**:

- Place NO es un OIDC IdP (no hay external RPs en horizonte V1/V2).
- La suite testaría aspectos irrelevantes (PKCE flow, discovery doc, dynamic client registration, etc.) que NO implementamos.
- El test relevante = round-trip ticket sign+verify + replay protection + audience binding. Cubierto por tests TDD de S1-S8 (≥80 tests proyectados).

**Cita**: ADR-0032 §"Decisión 1" + ADR-0032 §A1.

Si en V2 Place necesita external RPs, se evalúa `oidc-provider` (panva) con Postgres adapter custom + OIDC Conformance Suite. ADR-0032 §"Difiere a planes posteriores".

## Browser/Playwright E2E out of scope V1

V1 cobertura E2E: curl scenarios programáticos (S11 §"Smoke ejecutado") + smoke user-driven manual.

**Por qué NO Playwright V1**:

- Setup de Playwright cross-domain requiere `/etc/hosts` + dev certs autosignados + browser context cookie scoping — superficie de bugs del harness > superficie de bugs del producto V1.
- El flow es 100% server-side redirect chain (sin JavaScript necesario en cliente) — curl + cookies replicates el path completo.
- 4 redirects HTTP 302 + cookie host-only scope son verificables sin browser (inspeccionar headers + Set-Cookie + Location).

**V2 follow-up documentado**: cuando Place agregue features client-side al flow (e.g. retry UI con polling, error states animados), Playwright entra como cobertura. Decisión revisable post-feedback de owners reales en producción.

**Cita**: documentado acá; no requiere ADR separada.

## Smoke ejecutado

> **Placeholder vacío hasta S11**. Esta sección se popula al cierre con (a) curl scenarios programáticos (10 escenarios listados en plan de sesiones), (b) smoke production user-driven, (c) verificación pre-push (`pnpm typecheck && pnpm lint && pnpm test && pnpm build`).

Estructura esperada post-S11:

```
| # | Escenario | Esperado | Obtenido |
|---|---|---|---|
| 1 | `GET /api/auth/sso-init?returnTo=/settings` (host=nocodecompany.co) | 302 + state cookie | TBD |
| 2 | `GET /api/auth/sso-issue?aud=&state=&nonce=&returnTo=` con apex cookie | 302 a redeem con ticket | TBD |
| 3 | `GET /api/auth/sso-redeem?ticket=&state=&returnTo=` con state cookie | 302 a `/settings` + session cookie | TBD |
| 4 | `GET /settings` con session cookie | 200 settings HTML (no fallback, no gate) | TBD |
| 5 | Replay #3 con mismo jti | 302 `?sso_error=replay` | TBD |
| 6 | State cookie tampered | `?sso_error=state_invalid` | TBD |
| 7 | Ticket emitido para otro host | `?sso_error=aud_mismatch` | TBD |
| 8 | Open-redirect `returnTo=//attacker.com` | aterriza en `/`, no en attacker | TBD |
| 9 | Apex sin sesión: sso-issue | redirect a apex login con returnTo preservado | TBD |
| 10 | `GET /api/auth/sso-jwks` | 200 + cache headers + JWK Set válido | TBD |
```

**Smoke production user-driven** (post-push autorizado):

- Owner real loguea en apex `place.community`.
- Navega a `nocodecompany.co/settings`.
- Observa silent SSO (URL nunca para >1s en `/api/auth/sso-*`).
- Aterriza en settings con sesión local + acción owner ejecutable (e.g. cambiar locale del place).

## Pointers

- **ADR canónica V1 de Feature C**: [`docs/decisions/0032-custom-domain-sso-signed-ticket.md`](../../decisions/0032-custom-domain-sso-signed-ticket.md).
- **ADR precedente Feature A (registro + verificación lazy)**: [`docs/decisions/0026-custom-domain-v1-lazy-verification.md`](../../decisions/0026-custom-domain-v1-lazy-verification.md) (banner ADR-0027 obsoleta).
- **ADR precedente Feature B (routing real)**: [`docs/decisions/0031-custom-domain-routing-v1.md`](../../decisions/0031-custom-domain-routing-v1.md) (banner §11 obsoleta).
- **ADR macro Auth + OIDC**: [`docs/decisions/0001-auth-oidc-custom-domains.md`](../../decisions/0001-auth-oidc-custom-domains.md) (banner refinement por ADR-0032).
- **Test checklist por sesión**: [`./tests.md`](./tests.md).
- **Plan de sesiones (write-back S11)**: [`./plan-sesiones.md`](./plan-sesiones.md).
- **Spec slice anfitrión `custom-domain-routing` (Feature B)**: [`../custom-domain-routing/spec.md`](../custom-domain-routing/spec.md).
- **Multi-tenancy update post-C**: [`../../multi-tenancy.md`](../../multi-tenancy.md) §"Dominios propios" (reescrita en S0 para reflejar Signed Ticket).
- **Architecture update post-C**: [`../../architecture.md`](../../architecture.md) §"Sesión y SSO" (reescrita líneas 45/50/52/54).
- **Data model update post-C**: [`../../data-model.md`](../../data-model.md) §"Auth y OIDC" + comentario SQL en `place_domain.oauth_client_id` (DEPRECATED).
- **Stack update post-C**: [`../../stack.md`](../../stack.md) línea 16 + §env vars (`PLACE_SSO_SIGNING_KEY` + KID).
- **Gotchas nuevos**: [`../../gotchas/host-prefix-cookie-path.md`](../../gotchas/host-prefix-cookie-path.md), [`../../gotchas/sso-signing-key-no-log.md`](../../gotchas/sso-signing-key-no-log.md), [`../../gotchas/jose-jwks-redirect-manual.md`](../../gotchas/jose-jwks-redirect-manual.md) (S11.1).
- **Módulo nuevo (creado S2-S8)**: `src/shared/lib/sso/` (sub-cap LOC 1100 propio post-S11.1 addendum).
- **Helper zone-aware (creado S11.2.A)**: `src/shared/lib/db-for-request.ts` (integrator) + `src/shared/lib/db-for-request-decision.ts` (PURE) + `src/shared/lib/__tests__/db-for-request.test.ts` (8 tests PURE).
- **Endpoints API (creados S5/S7/S8)**: `src/app/api/auth/sso-{init,issue,redeem,jwks}/route.ts`.
- **Componente nuevo (creado S6)**: `src/features/custom-domain-routing/ui/sso-fallback-panel.tsx`.
- **Migration 0011 (creada S1)**: `src/db/migrations/0011_sso_jti_consume.sql`.
- **Paradigma vertical-slice**: [`../../architecture.md`](../../architecture.md) §17-25.
- **Driver Neon (ws)**: ADR-0018 §"Driver = neon-serverless".
- **`React.cache()` dedup precedente**: `src/app/(app)/place/[placeSlug]/_lib/get-place-for-zone.ts`.
- **Industry survey 2026-05-22**: Circle.so (`developers.circle.so/docs/sso-overview`) · Discourse (`meta.discourse.org/t/discourseconnect`) · Memberstack (`docs.memberstack.com/hc/en-us/articles/sso`).

## Smoke ejecutado 2026-05-23

### Setup

- **Place de prueba**: `nocode` (slug), nombre "NoCode Community", custom domain `nocodecompany.co` (verified vía Feature A/B).
- **Owner**: usuario Neon Auth `sub=5bc2b744-82dd-4aa7-909a-c84a994ebf28`, autenticado en `place.community` pre-smoke.
- **Vercel env vars** seteadas production + preview: `PLACE_SSO_SIGNING_KEY` (PKCS8 PEM ES256) + `PLACE_SSO_SIGNING_KEY_KID=2026-05-23-r1`.
- **Migration 0011** (`app.consume_sso_jti` SECURITY DEFINER + tabla `app.sso_jti_used`) aplicada en branch Neon main.
- **JWKS público verificado** pre-smoke: `https://www.place.community/api/auth/sso-jwks` → 200 + `{"keys":[{"kty":"EC","crv":"P-256","kid":"2026-05-23-r1",...}]}`.

### T1.1 inicial (commit `e61e027`, deploy `dpl_3LHtn6dn...`) — ROJO

Owner real navega a `https://nocodecompany.co/settings`. Silent SSO arranca correctamente (init → issue → redeem), pero el redeem aterriza en `?sso_error=signature_invalid` consistentemente. **No es un bug del ticket ni de la signing key** — el ticket capturado de DevTools es matemáticamente válido (verificado offline con scripts `verify-ticket.mjs` / `verify-ticket-www.mjs`).

**Root cause diagnosticado** (postmortem completo: `docs/gotchas/jose-jwks-redirect-manual.md`):
- jose v6 hardcodea `redirect: 'manual'` en `dist/webapi/jwks/remote.js` línea 19 (defense-in-depth anti JWKS-hijack-via-redirect).
- El JWKS apex `https://place.community/api/auth/sso-jwks` responde HTTP 307 → `https://www.place.community/api/auth/sso-jwks` por config Vercel platform-level apex→www.
- jose ve el 307 como respuesta inválida (esperaba 200) y throws; el pipeline mapea correctamente a `signature_invalid` (no leak al cliente de qué falló).

### S11.1 — fix Opción D (commits `23d4c72` code + `473c3e8` docs)

**Fix production-grade** (validado vs 8 alternativas): nuevo helper `makeSafeRedirectFollowingFetch` en `src/shared/lib/sso/sso-jwks-fetcher.ts` inyectado vía `customFetch` Symbol export de jose al `createRemoteJWKSet`. Sigue redirects sólo bajo policy estricta: **same-registrable-domain + https + ≤3 hops**. Cualquier violación → `SsoJwksRedirectError` → mapea a `signature_invalid` (igual semántica que falla JWKS genérica).

**TDD verde**: 10 tests nuevos en `src/shared/lib/sso/__tests__/sso-jwks-fetcher.test.ts` cubren no-redirect happy, apex→www same-registrable, subdomain↔subdomain, cross-registrable reject, https downgrade reject, max-hops, headers propagan, AbortSignal propaga, manual redirect forced.

**Documentación**: postmortem operativo `docs/gotchas/jose-jwks-redirect-manual.md` + ADR-0032 §12 nuevo "Same-registrable-domain redirect policy" (decisión + tabla 9 alternativas + consecuencias forward) + ADR-0032 §5 addendum sub-cap LOC 1000 → 1100 (helper consumió ~140 LOC).

### T1.1 retry post-fix (commit `473c3e8`, deploy `dpl_5fmp8Lfc7sagPiB8bPaGmJZ2dXM4`) — VERDE ✅

Mismo flow (owner real navega a `https://nocodecompany.co/settings`), pipeline init → issue → redeem termina en `nocodecompany.co/settings` **sin** `sso_error`, con cookie `__Host-place_sso_session` correctamente seteada.

**Evidencia** (cookie JWT decoded del DevTools Network tab):

| Claim | Valor | Verificación |
|---|---|---|
| Header `alg` | `ES256` | ✓ matchea spec |
| Header `kid` | `2026-05-23-r1` | ✓ matchea JWKS público |
| `iss` | `place.community` | ✓ |
| `sub` | `5bc2b744-82dd-4aa7-909a-c84a994ebf28` | ✓ **mismo Neon Auth user.id** → continuidad RLS empíricamente verificada cross-domain |
| `host` | `nocodecompany.co` | ✓ defense-in-depth host claim |
| `iat` | 1779572799 (2026-05-23 16:46:39 UTC) | ✓ |
| `exp` | 1780177599 (2026-05-30 16:46:39 UTC) | ✓ exactos 7d = `LOCAL_SESSION_TTL_SECONDS` |
| Cookie name | `__Host-place_sso_session` | ✓ prefix correcto (Path=/, Secure, HttpOnly enforced por browser) |
| URL final | `https://nocodecompany.co/settings` sin `sso_error` | ✓ |

### T1.2 inicial (deploy `dpl_5fmp8Lfc7sagPiB8bPaGmJZ2dXM4`, post-cookie set) — ROJO

Smoke owner-driven inmediatamente después del T1.1 verde: con cookie `__Host-place_sso_session` ya seteada, owner real navega a:

| Path | Esperado | Obtenido |
|---|---|---|
| `nocodecompany.co/settings` | Form de locale populated con valor actual del place | **Form vacío** — locale no carga |
| `nocodecompany.co/settings/domain` | Sección "Dominio configurado" con `nocodecompany.co` + estado verified | **Sin dominio** — UI muestra como si no hubiera configurado uno |
| `nocodecompany.co/settings` cambiar locale | UPDATE persiste + revalidación cache | **Server Action retorna `status: error`** |

**Root cause diagnosticado**: 4 Server Actions usaban el patrón legacy `requireSessionJwt() + getAuthenticatedDb(token, fn)`. `requireSessionJwt()` lee SÓLO la cookie Neon Auth (`Domain=.place.community`). En `nocodecompany.co` esa cookie **no existe por design del browser (RFC 6265)** — sólo existe la cookie SSO local `__Host-place_sso_session` que esas actions ignoraban. Resultado: `requireSessionJwt()` throws → action devuelve error → UI vacía / acción falla.

**Functions afectadas**:
1. `src/features/place-settings/actions/update-default-locale.ts` (SIMPLE: 1 DB call)
2. `src/features/custom-domain/actions/register-custom-domain.ts` (MULTI-HELPER: 3 internal helpers each token-passing)
3. `src/features/custom-domain/actions/archive-custom-domain.ts` (SIMPLE)
4. `src/features/custom-domain-verification/actions/get-custom-domain-status.ts` (MULTI-HELPER: 3 internal helpers)

### S11.2 — fix Opción B (commits `20b44e8` foundation + `bebfbf4` migration)

**Fix production-grade** (validado vs 5 alternativas en plan v2, single source of truth en `/Users/maxi/.claude/plans/wise-greeting-mccarthy.md`): nuevo helper coordinador `getAuthenticatedDbForRequest(fn)` en `src/shared/lib/db-for-request.ts` (integrator) + `db-for-request-decision.ts` (decisión PURE) que:

1. Detecta `HostZone` del request (apex / subdomain / custom-domain).
2. Lee la cookie correcta según zona (Neon Auth en apex/subdomain, SSO local `__Host-place_sso_session` en custom domain).
3. Dispatcha al primitivo apropiado (`getAuthenticatedDb` Feature A para Neon Auth, `getAuthenticatedDbWithVerifier` Feature C S4 para SSO local).
4. Fail-closed: lanza `NoSessionError` cuando no hay sesión válida en la zona del request.

**Continuidad RLS preservada**: el `sub` del local session JWT === el `sub` del Neon Auth JWT, por lo que `app.current_user_id()` retorna el mismo valor en ambas zonas (ADR-0032 §6 reafirmado).

**TDD verde**: 8 tests PURE nuevos en `src/shared/lib/__tests__/db-for-request.test.ts` cubren `decideAuthBranch` (custom-domain + cookie presente → sso-local; custom-domain + cookie ausente → no-session; zone=place|marketing|inbox → neon-auth-needed; cookie exacta `__Host-place_sso_session` enforced; expectedHost propagado verbatim). El integrador `getAuthenticatedDbForRequest` NO se vitest'ea por convención seam-split del codebase (canon `update-default-locale.ts:13` — cruza `next/headers` + Neon Auth SDK + DB real, correctitud por tipo/build + smoke).

**Migración mecánica** (S11.2.B): las 4 Server Actions dropearon imports `requireSessionJwt` + `getAuthenticatedDb`; los helpers internos dropearon su param `token: string` y llaman `getAuthenticatedDbForRequest` directo; los `try/catch` `requireSessionJwt() catch` + `getAuthenticatedDb catch` se colapsaron en uno alrededor del helper zone-aware (`NoSessionError` cae al outer catch → UX-equivalente al `error`/`generic`/`none` previo).

**Costo aceptable V1**: cada `getAuthenticatedDbForRequest` invocation repite zone resolution + JWT verification + SQL lookup a `app.lookup_place_by_domain` (SECURITY DEFINER STABLE, prepared stmt cached al pool). En multi-helper actions con 3 calls internas = 3× roundtrips. Documentado in-code; V1.1 follow-up si telemetría demanda (memoizar decision con `React.cache` dentro del helper).

### T1.2 retry post-fix (commit `5e62f0d`, deploy `dpl_2vhnAC2REbcjGgureWp85VRqpzj6`) — VERDE ✅

Smoke owner-driven 2026-05-23 post-push (deploy READY en ~42s, alias `nocodecompany.co` mapeado correctamente):

| # | Path | Esperado | Obtenido |
|---|---|---|---|
| 1 | `nocodecompany.co/settings` | Form de locale populated con valor actual del place | ✅ Form populated (locale `es` correcto del place) |
| 2 | `nocodecompany.co/settings/domain` | Sección "Dominio configurado" con `nocodecompany.co` + estado verified | ✅ Dominio configurado visible + verified |
| 3 | `nocodecompany.co/settings` cambiar locale → submit | UPDATE persiste + revalidación cache + UI refleja cambio | ✅ Persiste + revalida |

**Server-side sanity smoke** (no-cookies, plumbing post-deploy intacta):

| # | Endpoint | Esperado | Obtenido |
|---|---|---|---|
| 1 | `GET https://nocodecompany.co/` | 200 (host routing alive, Feature B intacto) | ✅ HTTP 200 |
| 2 | `GET https://nocodecompany.co/settings` sin cookie | 307 → `/api/auth/sso-init?returnTo=%2Fsettings` (silent SSO trigger S10 intacto) | ✅ HTTP 307 + Location correcto |
| 3 | `GET https://nocodecompany.co/settings/domain` sin cookie | 307 → `/api/auth/sso-init?returnTo=%2Fsettings%2Fdomain` | ✅ HTTP 307 + Location correcto |
| 4 | `GET https://www.place.community/api/auth/sso-jwks` | 200 + `Content-Type: application/jwk-set+json` (S5 intacto) | ✅ HTTP 200 + content-type correcto |

**Observación arquitectónica confirmada**: el path en custom domain NO incluye locale segment (`/settings` no `/es/settings`) — by-design del rendering en custom domain, la page renderea en el `place.default_locale` cargado de DB. Cambiar el locale via Server Action persiste el nuevo `default_locale` a DB; el próximo render lo levanta sin tocar el path. Comportamiento esperado, idéntico al pre-S11.2 (la migración S11.2 no tocó el routing/path, sólo el helper de DB que las Server Actions usan).

### Conclusión

Feature C V1 deployed end-to-end verde para el flow completo: silent SSO mintea cookie local (T1.1) + Server Actions zone-aware que leen la cookie correcta según zona (T1.2). El owner real autenticado en `place.community` accede a `nocodecompany.co/settings` con sesión local emitida transparentemente (~1-2s, sin click extra ni redirect visible al apex) **y** las 4 Server Actions owner-only funcionan transparentemente en ambas zonas (apex y custom domain). Continuidad RLS verificada empíricamente — el `sub` del local session JWT coincide con el `neon_auth.user.id` original, por lo que `app.current_user_id()` retorna el mismo valor en custom domain que en apex (cero refactor de policies, ADR-0032 §6 cumplido).

Bug T1.1 cerrado vía S11.1 (Opción D). Bug T1.2 cerrado vía S11.2 (Opción B). Tag final: `baseline/feature-c-s11.2-done`. Deploy production T1.2: `dpl_2vhnAC2REbcjGgureWp85VRqpzj6` READY 2026-05-23 (commit `5e62f0d` pre-final-close; el post-smoke write-back de evidencia VERDE va en el commit S11.2 close subsiguiente sobre el mismo deploy READY).

### T1.3 inicial (smoke M1 owner-driven post-S11.2, 2026-05-23) — ROJO

**Setup**: user abre ventana de incógnito (sin sesión Neon Auth previa) + navega a `https://nocodecompany.co/settings`. Cold-start M1: la primera fuente de verdad del owner es el custom domain, no el apex.

**Esperado del flow E2E** (per ADR-0032 §2):

1. Page sin sesión local SSO → silent SSO trigger S10 → `/api/auth/sso-init?returnTo=/settings`.
2. `sso-init` setea `__Host-place_sso_state` + redirect a apex `/api/auth/sso-issue?aud=nocodecompany.co&state=…&nonce=…&returnTo=/settings`.
3. `sso-issue` detecta `getSessionJwt() === null` → `redirectToApexLogin` (`src/app/api/auth/sso-issue/route.ts:145-153`) construye `continueUrl = https://place.community/api/auth/sso-issue?aud=nocodecompany.co&state=…&nonce=…&returnTo=%2Fsettings` + emite redirect a `https://www.place.community/{locale}/login?returnTo=<continueUrl encoded>`.
4. User llena email + password + submit.
5. **Esperado**: navegar al `returnTo` (URL del `sso-issue`) → ticket emitido → redeem en custom domain → cookie local SSO seteada → aterriza en `nocodecompany.co/settings` con sesión local.

**Observado**: pasos 1-4 OK. **Paso 5 ROJO**: tras submit el browser navega a `https://app.place.community/{locale}/` (Hub canónico). El `returnTo` se descarta silenciosamente. User aterriza en Hub canónico sin contexto de su intento original.

**Evidencia URL** (citada del smoke owner-driven):

> "si abro una de incógnito con nocodecompany.co/settings me redirige a: `https://www.place.community/es/login?returnTo=https%3A%2F%2Fplace.community%2Fapi%2Fauth%2Fsso-issue%3Faud%3Dnocodecompany.co%26state%3DGE2_7CxDkFgcu7Se_mPG0999K7vDO9_lZTlieC_VhGY%26nonce%3DGuza_5HdTWhldcncL7fE3w%26returnTo%3D%252Fsettings` al loguearme me manda a: `https://app.place.community/es`"

El `?returnTo` viaja correctamente en URL. El bug está en el lado consumer (login apex) que lo ignora.

### S11.3 fix — Opción única "page consumer del returnTo" (placeholder pre-implementación)

**Diagnóstico canónico** (5 smoking guns confirmados con file:line, ver ADR-0033 §"Smoking guns"):

| # | Ubicación | Patología |
|---|---|---|
| 1 | `src/app/(marketing)/[locale]/login/page.tsx:22` | `type Props = { params }` — sin `searchParams` → returnTo invisible a la page |
| 2 | `src/app/(marketing)/[locale]/login/page.tsx:38-41` | Guard "ya logueado" redirige hardcoded a Hub canónico, descarta returnTo |
| 3 | `src/app/(marketing)/[locale]/login/page.tsx:81-88` | Page no propaga returnTo al `AccessFlow` (no puede — no lo lee) |
| 4 | `src/features/access/ui/access-flow.tsx:52` | `onSuccess: () => navigate(\`https://app.place.community/${locale}/\`)` hardcoded |
| 5 | `src/features/access/ui/use-access-form.ts:23,76` | `onSuccess: () => void` sin surface para returnTo; submit exitoso → `opts.onSuccess()` literal |

**Fix V1** (ADR-0033 canónica, ejecución sub-sesionada en S11.3.A → S11.3.D):

- Helper PURE nuevo `src/shared/lib/sso/validate-login-return-to.ts` (~80 LOC) con allowlist explícito (`/api/auth/sso-{issue,init}` + relative paths) + same-registrable-domain HTTPS para absolute URLs. 12 TDD tests cubren edge cases (null, undefined, empty, whitespace, relative simple, relative con query+hash, protocol-relative `//attacker`, scheme `javascript:`, attacker domain absoluto, allowlist hit, allowlist miss, HTTP no-HTTPS).
- Page `/[locale]/login` lee `searchParams.returnTo` (tipo extendido) + valida + propaga + guard "ya logueado" honra.
- `AccessFlow` recibe nuevo prop `returnTo?: string` + en `onSuccess` navega a `returnTo ?? hubCanonical` (closure sobre el prop).
- `useAccessForm` NO se toca — superficie del hook intacta (separation of concerns preservada; decisión `returnTo vs Hub` vive en componente Server-aware `AccessFlow`).
- Backwards-compat: flows pre-Feature-C sin returnTo siguen al Hub canónico hardcoded (signup landing, login directo apex, etc.).

**Sub-cap `shared/lib/sso/` post-S11.3.B (medición real)**: bump efectivo **1100 → 1400 LOC** (pre-S11.3.B = 1168 LOC heredando margen negativo ~40 de S11.1; post-S11.3.B = 1297 LOC con helper PURE de 128 LOC vs ~80 LOC estimados — +60% por doc-density apropiada para código de seguridad; bump +300 incluye ~100 LOC buffer positivo forward-compat). Addendum dedicado en ADR-0032 §5 (`Addendum 2026-05-23 (S11.3.B) — sub-cap subido de 1100 a 1400 LOC`). Patrón consistente con bumps previos 800→1000 (S3.5) → 1100 (S11.1).

**Status post-S11.3.B**: helper PURE `validateLoginReturnTo` ✅ + 14 tests passing (12 canónicos del ADR-0033 + 2 secundarios `/api/auth/sso-init` + subdomain del apex) ✅ + addendum ADR-0032 §5 bump 1100 → 1400 escrito ✅. Pendiente: S11.3.C (wire-up 3 archivos + 2 tests RTL nuevos + ajuste 3 tests existentes), S11.3.D (smoke M1 retry production + docs close + push bundle B+C+D).

**Status post-S11.3.C**: wire-up `page.tsx` (92 → 122 LOC, +30 vs +18 estimado por doc-density apropiada del comment-block ADR-0033 inline + co-location del rationale en la guard "ya logueado" + propagación del `safeReturnTo`) ✅ + `AccessFlow` (227 → 240 LOC, +13 matches estimación exactly: prop `returnTo?: string` + JSDoc inline + closure en `onSuccess`) ✅ + `useAccessForm` **intacto** (120 LOC sin cambio — superficie del hook agnóstica del destino post-auth preservada, decisión documentada en ADR-0033 §"Wire-up useAccessForm") ✅ + 2 tests RTL nuevos en `access-flow.test.tsx` (`respeta returnTo si la page lo propaga → navigate al destino SSO en vez del Hub` + `regression: sin returnTo → Hub canónico — flows pre-Feature-C intactos`) ✅ + extensión backward-compat del helper `setup()` con prop opcional `returnTo` (los 3 tests navigate existentes — login exitoso, signup, idempotencia doble click — siguen passing sin cambio de behavior porque `returnTo` defaultea a `undefined`) ✅. Suite total: 70/70 files · **698/698 tests** (vs 696 baseline = +2 nuevos). Pendiente: S11.3.D (smoke M1 owner-driven production retry VERDE + docs close + push autorizado bundle B+C+D + backfill SHA de `S11.3.C` en plan-sesiones).

### T1.3 retry post-fix (commit `48b204b` = S11.3.C wire, deploy `dpl_FwjvKLuj9v9AmPM48ngrUwXU4Dpu`) — VERDE ✅

Push autorizado bundle A+B+C (commits `7d872ad` + `d03b30d` + `48b204b`) 2026-05-23. Deploy READY en 43s (`buildingAt` → `ready` = 43.4s, `dpl_FwjvKLuj9v9AmPM48ngrUwXU4Dpu`, alias `nocodecompany.co` + `place.community` + `www.place.community` + `app.place.community` mapeados).

**Server-side sanity smoke** (no-cookies, plumbing del redirect chain post-deploy):

| # | Endpoint | Esperado | Obtenido |
|---|---|---|---|
| 1 | `GET https://place.community/api/auth/sso-issue?aud=nocodecompany.co&state=…&nonce=…&returnTo=%2Fsettings` sin cookie Neon Auth | 307→`www.place.community`, 302 a apex login **con `?returnTo=` preservado URL-encoded** | ✅ `Location: https://place.community/es/login?returnTo=https%3A%2F%2Fplace.community%2Fapi%2Fauth%2Fsso-issue%3Faud%3Dnocodecompany.co%26state%3Dteststate%26nonce%3Dtestnonce%26returnTo%3D%252Fsettings` |
| 2 | `GET https://www.place.community/es/login?returnTo=<URL del sso-issue de #1>` | 200 + form HTML (validateLoginReturnTo S11.3.B acepta apex same-registrable-domain HTTPS al allowlist `/api/auth/sso-issue`) | ✅ HTTP 200 + 14460 bytes (1.17s) |

**Diferencia clave vs pre-fix**: paso #1 retornaba `Location: …/es/login` **sin** `?returnTo=` (bug T1.3 — el `redirectToApexLogin` en `sso-issue/route.ts:145-153` ya emitía el query correctamente, pero la page apex no lo leía → no había evidencia visible en URL del login del consumer-side discard). Post-fix S11.3.C: la URL del login conserva el `?returnTo=` URL-encoded (el server-side smoke capturó la URL exacta, idéntica en shape a la del paso #4 del owner-driven excepto por `state`/`nonce` random vs valores test).

**Smoke owner-driven M1 cold-start** (2026-05-23, ventana incógnito limpia sin cookies previas, owner real de `nocodecompany.co`):

| # | Acción | Esperado | Obtenido |
|---|---|---|---|
| 1 | Navegar a `https://nocodecompany.co/settings` | Redirect chain a apex login con `?returnTo=<sso-issue URL>` preservado | ✅ Redirigió a login de `place.community` |
| 2 | Form de login renderea normal (no crash con returnTo válido) | Form servido (200) + email/password inputs | ✅ Form servido normal |
| 3 | Submit con credenciales owner de `nocodecompany.co` | `loginAction` exitoso → `AccessFlow.onSuccess` honra `returnTo` (S11.3.C closure) → navega cross-domain al `sso-issue` apex | ✅ Identificación exitosa |
| 4 | `sso-issue` ahora con cookie Neon Auth → mintea ticket → 302 a `nocodecompany.co/api/auth/sso-redeem?ticket=…&state=…&returnTo=%2Fsettings` → redeem valida → setea cookie `__Host-place_sso_session` → 302 a `/settings` | Aterriza en `https://nocodecompany.co/settings` con sesión SSO local + form populated zone-aware (S11.2 fix) | ✅ Redirigió a `nocodecompany.co/settings` |

**Cita literal del user post-smoke** (2026-05-23):

> "paso perfectamente. entre a nocodecompany.co/settings me dirigio al login de place.community despues de identificarme me redirigio a nocodecompany.co/settings"

**Diferencia clave vs T1.3 inicial pre-fix** (smoke ROJO documentado arriba en §"T1.3 inicial"): el step 4 ahora aterriza en el path solicitado (`/settings` en custom domain) en lugar de descartar el `returnTo` y mandar a Hub canónico (`app.place.community/es/`). El cold-start M1 — el último gap funcional de Feature C V1 — queda cerrado end-to-end transparente para el owner: silent SSO → apex login → submit → returnTo honrado → ticket → redeem → cookie SSO local → settings.

**Continuidad con T1.1 + T1.2**: la cookie `__Host-place_sso_session` seteada por el redeem (post-login) tiene los claims canónicos (`iss=place.community / sub=<neon_auth_user_id> / host=nocodecompany.co / iat / exp +7d`) verificados en T1.1; las 4 Server Actions migradas zone-aware (S11.2: `update-default-locale`, `register-custom-domain`, `archive-custom-domain`, `get-custom-domain-status`) leen la cookie correctamente del custom domain → form populated + UI funcional sin click extra. M1 cierra el último gap del cold-start; M2 (sesión apex activa) sigue verde por T1.2; M3 (Neon Auth expirado) subsumido por M1.

### Conclusión final Feature C V1

Feature C V1 **deployed end-to-end verde 2026-05-23** cubriendo los 3 escenarios canónicos del cold-start SSO desde custom domain:

- **M1 (cold start, anónimo)**: T1.3 VERDE ✅ — owner llega a custom domain sin sesión apex previa → silent SSO → apex login → returnTo honrado → vuelve transparente.
- **M2 (sesión apex activa)**: T1.1 + T1.2 VERDE ✅ — silent SSO toma path directo (sso-issue detecta sesión Neon Auth → mintea ticket sin pasar por login) + Server Actions zone-aware funcionan.
- **M3 (ambos expirados)**: subsumido por M1, no requiere prueba independiente.

Bug T1.1 cerrado vía S11.1 (Opción D `customFetch` same-registrable-domain). Bug T1.2 cerrado vía S11.2 (Opción B helper `getAuthenticatedDbForRequest` zone-aware). Bug T1.3 cerrado vía S11.3 (Opción única ADR-0033: page consumer del `?returnTo` con helper PURE `validateLoginReturnTo` allowlist + wire-up minimal). Tag final: `baseline/feature-c-s11.3-done` (= close commit S11.3.D). Sub-cap final `src/shared/lib/sso/`: 1400 LOC (bumps elásticos documentados en ADR-0032 §5: 800 → 1000 [S3.5] → 1100 [S11.1] → 1400 [S11.3.B]).
