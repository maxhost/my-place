# Custom Domain SSO — Tests checklist

> Checklist TDD por sesión. Cada test describe una expectativa observable; el orden refleja el plan de sesiones ([`./plan-sesiones.md`](./plan-sesiones.md)). Convención: `[ ]` pending, `[x]` ejecutado verde.
> 
> **Mandato TDD (CLAUDE.md §"Durante la implementación")**: tests primero, verificar que fallan, implementar, verificar que pasan. Sin excepciones en el core.
> 
> **Total proyectado nuevo**: ~80 tests vitest + ≥10 verificaciones script/grep/psql. Suite objetivo post-S11: ~630/630 (baseline pre-Feature-C = 550/550).

## Canon "Server Actions sin tests directos"

Heredado del precedente `docs/features/custom-domain-routing/tests.md`. En Feature C **no hay Server Actions nuevas** — los 4 endpoints son route handlers (`route.ts`) testeados directo con `NextRequest`/`Response` builders + cookies/headers mock. Los Server Components (`<SsoFallbackPanel>`) se tipan + buildean + snapshot HTML estable.

---

## S1 — Migration 0011 `app.consume_sso_jti` SECURITY DEFINER

### `src/db/__tests__/consume-sso-jti.test.ts` (nuevo)

**Por qué importa:** la función SECURITY DEFINER es el único acceso a `app.sso_jti_used` desde caller anónimo (redeem corre sin claim de sesión local — la cookie aún no existe). Si filtra mal o REVOKE PUBLIC no está enforced, el anti-replay queda inservible.

**Harness:** `inRlsTx` (`src/db/__tests__/db-test-pool.ts`) — caller `app_system` con claim vacío. ROLLBACK siempre.

**Casos cubiertos (6 RLS/function):**

- [ ] Primer consume del mismo `jti` retorna `true` (INSERT OK).
- [ ] Segundo consume del mismo `jti` (replay) retorna `false` (ON CONFLICT DO NOTHING).
- [ ] GC oportunista limpia rows con `expires_at < now()` antes del INSERT (insertar 3 stale + nuevo consume → SELECT post retorna sólo el nuevo).
- [ ] Caller `app_system` SIN claim (`request.jwt.claims = ""`) recibe `true` correctamente (DEFINER bypasea RLS owner-only de la tabla).
- [ ] REVOKE EXECUTE FROM PUBLIC enforced: caller anonymous (sin GRANT) → permission denied al invocar la función directo.
- [ ] Return type es `boolean` (regression — no `text`, no `void`).

**Verificación manual psql (no en CI):**

- [ ] `psql -c "SELECT proname, prosecdef FROM pg_proc WHERE proname='consume_sso_jti';"` retorna `prosecdef = t`.
- [ ] `psql -c "\df app.consume_sso_jti"` muestra `Security` = `definer`.
- [ ] `psql -c "\dp app.consume_sso_jti"` muestra EXECUTE concedido **sólo** a `app_system` (NO a PUBLIC).
- [ ] Tabla `app.sso_jti_used` tiene RLS ENABLED + 0 policies (verificar `pg_policies`).
- [ ] Header de la migration documenta reverse-SQL.

**Total S1: ≥6 vitest + ≥5 verificaciones manuales psql.**

---

## S2 — `sso-keys.ts` + `sso-ticket.ts` (helpers puros)

### `src/shared/lib/sso/__tests__/sso-keys.test.ts` (nuevo) + `sso-ticket.test.ts` (nuevo)

**Por qué importa:** los primitivos crypto son la base de todo el flow. Bug en `signSsoTicket` o `verifySsoTicket` = atacante mintea tickets propios o el redeem rechaza tickets válidos.

**Mocks usados:**
- `vi.mock` sobre `process.env` para inyectar `PLACE_SSO_SIGNING_KEY` PEM y `PLACE_SSO_SIGNING_KEY_KID` por test.
- `vi.spyOn(console, 'error')` + `vi.spyOn(console, 'log')` para asertar que la signing key NUNCA aparece en output.

**Casos cubiertos (9 total):**

- [ ] **Round-trip OK**: `signSsoTicket(claims, key, kid)` → token; `verifySsoTicket(token, aud, jwks)` → mismas claims (sub, aud, nonce, state, jti, iss).
- [ ] **`aud` mismatch**: ticket emitido con `aud='nocodecompany.co'`, verify con `expectedAud='otrocustom.com'` → throws `SsoTicketError('aud_mismatch')`.
- [ ] **Expired**: ticket con `exp=now()-1s` → throws `SsoTicketError('expired')` (jose enforce).
- [ ] **Signature tampered**: modificar último carácter del JWS → throws `SsoTicketError('signature_invalid')`.
- [ ] **`iss` mismatch**: ticket emitido con `iss='attacker.com'` → throws `SsoTicketError('iss_mismatch')` (verify enforce `issuer: 'place.community'`). Código canónico del discriminated union es `iss_mismatch`, ver `src/shared/lib/sso/sso-ticket.ts:84`.
- [ ] **Missing claim**: ticket sin `jti` (o sin `nonce`, o sin `state`) → throws `SsoTicketError('missing_claim')`.
- [ ] **Key config error**: `loadSigningKey()` con env ausente → throws `SsoKeyConfigError` específica (no `Error` genérico).
- [ ] **JWKS shape**: `loadPublicJwks()` retorna `{keys: [{kty:'EC', crv:'P-256', x, y, kid, use:'sig', alg:'ES256'}]}` (validation field-by-field).
- [ ] **Determinism guard (no log leak)**: ejecutar sign+verify con `vi.spyOn(console, 'log/error')` activo → assert que NINGÚN call output contiene `-----BEGIN`, `kty.*x`, ni el PEM raw del env.

**Total S2: 9 tests.**

---

## S3 — `sso-state.ts` (CSRF state cookie + nonce + returnTo)

### `src/shared/lib/sso/__tests__/sso-state.test.ts` (nuevo)

**Por qué importa:** state cookie es la defensa CSRF del flow; `validateReturnTo` es el guard open-redirect (3 puntos de validación: init, issue, redeem).

**Mocks usados:**
- `vi.spyOn(crypto, 'randomBytes')` para asserts de longitud + base64url encoding.
- HKDF de la signing key principal con `info='place_sso_state_hmac_v1'` — sin env separada (ADR-0032 §3 sub-decisión).

**Casos cubiertos (11 total):**

- [ ] `generateState()` retorna distinct cada call (10 calls → 10 strings distintos).
- [ ] `signStateCookie(state, nonce, key)` + `verifyStateCookie(value, key)` roundtrip OK → retorna `{state, nonce}`.
- [ ] Cookie tampered (modificar último char del signature) → `verifyStateCookie` retorna `null`.
- [ ] Cookie malformed (sin `.` separators, o longitud inválida) → retorna `null`.
- [ ] `validateReturnTo('/settings/domain')` → `/settings/domain` (legitimate).
- [ ] `validateReturnTo('//evil.com/settings')` → `/` (scheme-relative URL bloqueada).
- [ ] `validateReturnTo('https://evil.com')` → `/` (absolute URL bloqueada).
- [ ] `validateReturnTo('javascript:alert(1)')` → `/` (javascript scheme bloqueado).
- [ ] `validateReturnTo(null)` → `/` (null safety).
- [ ] `validateReturnTo('/settings?tab=domain#section')` → `/settings?tab=domain#section` (query + hash preservados).
- [ ] HMAC secret NUNCA en stdout: ejecutar `signStateCookie` con `vi.spyOn(console)` activo → assert 0 calls contienen el key material.

**Total S3: 11 tests.**

---

## S4 — `sso-session.ts` + `db-with-verifier.ts`

### `src/shared/lib/sso/__tests__/sso-session.test.ts` + `db-with-verifier.test.ts` (nuevos)

**Por qué importa:** la local session JWT es la sesión efectiva del custom domain. Si `verifyLocalSession` no enforce el `host` claim, un atacante con cookie de un custom domain puede inyectarla en otro. El `db-with-verifier` es el bridge RLS — si no inyecta `request.jwt.claims` correctamente, las policies fail-open o fail-closed mal.

**Mocks usados:**
- `vi.fn()` como `TokenVerifier` con shape controlado.
- Pool Neon mockeado vía `vi.mock('@/db/client')`.

**Casos cubiertos (6 total):**

- [ ] **Mint+verify roundtrip**: `mintLocalSession({sub, host})` → token; `verifyLocalSession(token, expectedHost)` → `{sub, host}`.
- [ ] **Host mismatch throws**: mint con `host='nocodecompany.co'`, verify con `expectedHost='otrocustom.com'` → throws (defense-in-depth contra robo cross-custom-domain).
- [ ] **Expired throws**: token con `exp=now()-1s` → throws.
- [ ] **Verifier injectable se invoca**: `getAuthenticatedDbWithVerifier(token, verifier, fn)` con `verifier = vi.fn()` → verifier llamado exactamente 1 vez con el token.
- [ ] **Verifier throws → no DB touch**: verifier que rechaza → `fn` NO se invoca (assert `fn.mock.calls.length === 0`); no transaction iniciada.
- [ ] **Integration RLS continuity end-to-end**: mint local session con `sub=<test_user_id>` → `getCustomDomainDb(token, async db => db.select().from(appUser).where(eq(appUser.authUserId, X)))` retorna la row correcta (continuidad `sub` con `app.current_user_id()`).

**Total S4: 6 tests.**

---

## S5 — `/api/auth/sso-jwks` endpoint apex

### `src/app/api/auth/sso-jwks/__tests__/route.test.ts` (nuevo)

**Por qué importa:** sin JWKS público correcto, el redeem en custom domain no puede verificar tickets. Cache headers mal seteados = thrash de fetches del apex.

**Mocks usados:**
- `process.env.PLACE_SSO_SIGNING_KEY` + KID inyectados vía `vi.mock`.

**Casos cubiertos (5 total):**

- [ ] `GET /api/auth/sso-jwks` retorna HTTP 200 + `Content-Type: application/jwk-set+json`.
- [ ] Body parsea como JSON con shape `{keys: [{kty:'EC', crv:'P-256', x, y, kid, use:'sig', alg:'ES256'}]}` (single key V1).
- [ ] **Round-trip end-to-end**: ticket firmado por S2 `signSsoTicket` verifica OK contra el JWKS retornado por este endpoint (sin shared state — separate import del module).
- [ ] Cache headers: `Cache-Control: public, max-age=300, s-maxage=300`.
- [ ] **Sin auth requerida**: request sin cookie/header → 200 OK (JWKS es público por definición RFC 7517).

**Total S5: 5 tests.**

---

## S6 — `<SsoFallbackPanel>` component + i18n × 6 locales

### `src/features/custom-domain-routing/__tests__/sso-fallback-panel.test.tsx` (nuevo)

**Por qué importa:** el componente es el cierre UX cuando el silent SSO falla. Bug = owner queda en loop o no entiende qué pasó. i18n parity = key faltante en 1 locale rompe el render en ese locale.

**Mocks usados:**
- `vi.mock('next-intl/server', ...)` con `getTranslations` que retorna `t(key, vars)` con templates raw (`{slug}` resuelto).
- RTL `render(...)` sobre el Server Component.

**Casos cubiertos (4 total):**

- [ ] Renderiza title heading + body con `{slug}` resuelto + CTA primario (link al subdomain canon) + CTA secundario ("Reintentar" link).
- [ ] `errorCode` prop aparece DENTRO de `<details>` colapsable (no inline visible).
- [ ] `node scripts/check-translations.mjs` exit 0 + `0/0` × 5 locales post-S6 (script-driven).
- [ ] Snapshot HTML estable: render con props `{canonicalUrl, labels, errorCode:'state_mismatch'}` matches snapshot fijo.

**Total S6: 4 tests + 1 script verification (cuenta separada).**

---

## S7 — `/api/auth/sso-issue` (apex issuer)

### `src/app/api/auth/sso-issue/__tests__/route.test.ts` (nuevo)

**Por qué importa:** este handler es el "trusted issuer". Bug = ticket emitido para `aud` no verificado (data leakage cross-tenant), o ticket emitido sin sesión apex válida (privilege escalation).

**Mocks usados:**
- `vi.mock('@/shared/lib/custom-domain-lookup')` para `lookupPlaceByDomain`.
- `vi.mock('next/headers')` para cookies + headers.
- `vi.mock('@/shared/lib/jwt')` para `getSessionJwt` + `verifyAccessToken`.

**Casos cubiertos (10 total):**

- [ ] Sin query param `aud` → HTTP 400 (Zod schema rejection).
- [ ] `aud` no verified (`lookupPlaceByDomain` retorna null) → HTTP 400 `invalid_audience` (sin leak detalles).
- [ ] Sin sesión apex (`getSessionJwt` retorna null) → redirect 302 a `https://place.community/{locale}/login?returnTo=<encoded sso-issue URL>`.
- [ ] Sesión apex inválida (`verifyAccessToken` throws) → HTTP 401.
- [ ] **Happy path**: query completa + sesión válida → HTTP 302 + Location header a `https://<aud>/api/auth/sso-redeem?ticket=...&state=...&returnTo=...`.
- [ ] Ticket round-trip verificable: extraer ticket del Location header → `verifySsoTicket(ticket, aud, jwks)` OK + claims matchean (sub, aud, nonce, state).
- [ ] `jti` distinto cada call (2 invocations → 2 jtis distintos en los tickets).
- [ ] `exp` en futuro +60s (assert `claims.exp - claims.iat === 60`).
- [ ] `returnTo` malicioso (`//evil.com`) sanitizado a `/` antes de propagar al redeem URL.
- [ ] **Open-redirect protection**: ningún path query produce un Location header que apunte a un host fuera de `<aud>` verified (assert via grep negativo en Location).

**Total S7: 10 tests.**

---

## S8 — `/api/auth/sso-init` + `/api/auth/sso-redeem` + `sso-jti-consume.ts`

### `src/app/api/auth/sso-init/__tests__/route.test.ts` + `sso-redeem/__tests__/route.test.ts` + `src/shared/lib/sso/__tests__/sso-jti-consume.test.ts` (nuevos)

**Por qué importa:** sesión más densa del slice. El redeem concentra ~9 validaciones de seguridad; cualquier gap = exploit.

**Mocks usados:**
- `vi.mock` sobre `cookies()`, `headers()`, `lookupPlaceByDomain`, `consumeSsoJti`, `createRemoteJWKSet`.
- Pool Neon mockeado para `sso-jti-consume.test.ts`.

### `sso-init` (5 tests):

- [ ] Host no verified (`lookupPlaceByDomain` null) → HTTP 404.
- [ ] `returnTo` malicioso sanitizado a `/` antes de propagar.
- [ ] Setea cookie `__Host-place_sso_state` con shape correcto (Max-Age=120, HttpOnly, Secure, SameSite=Lax, Path=/, no Domain).
- [ ] Redirect URL exacto: `https://place.community/api/auth/sso-issue?aud=<host>&state=<>&nonce=<>&returnTo=<>` (query propagado).
- [ ] Query string original preservado en `returnTo` propagado.

### `sso-redeem` (15+ tests):

- [ ] State cookie ausente → redirect `returnTo + '?sso_error=state_invalid'`.
- [ ] State cookie tampered → `?sso_error=state_invalid`.
- [ ] State query mismatch (constant-time compare) → `?sso_error=state_mismatch`.
- [ ] Ticket inválido (signature) → `?sso_error=signature_invalid`.
- [ ] Ticket `aud` mismatch (vs host actual) → `?sso_error=aud_mismatch`.
- [ ] Ticket expirado → `?sso_error=expired`.
- [ ] Replay (mismo jti consumed antes) → `?sso_error=replay`.
- [ ] Nonce ticket !== nonce cookie → `?sso_error=missing_claim` o `state_mismatch` (chequear código exacto).
- [ ] `consumeSsoJti` retorna `false` → `?sso_error=replay`.
- [ ] **Happy path mint end-to-end**: ticket válido + state OK + jti consumed → cookie `__Host-place_sso_session` seteada + state cookie borrada (Max-Age=0) + redirect 302 a `returnTo` interno.
- [ ] `returnTo` malicioso post-verify sanitizado (3er punto de validación open-redirect).
- [ ] JWKS fetch fail (network error) → `?sso_error=signature_invalid` (fail-safe, no crash).
- [ ] Local session JWT mintado tiene `sub` matcheando el del ticket (continuidad).
- [ ] Local session JWT mintado tiene `host` claim matcheando el host actual del request.
- [ ] Cookie `__Host-place_sso_session` shape: `Max-Age=604800` (7d), HttpOnly, Secure, SameSite=Lax, Path=/, no Domain.

### `sso-jti-consume` (5 tests):

- [ ] Primer consume retorna `true` (mock pool query retorna `[{consume_sso_jti: true}]`).
- [ ] Segundo consume del mismo jti retorna `false` (mock retorna `[{consume_sso_jti: false}]`).
- [ ] DB error → wrapper retorna `false` + log estructurado (fail-safe; mejor false-negative que crash). `vi.spyOn(console, 'error')` assert.
- [ ] Normalization: `jti` con whitespace/casing inesperado → pasado intacto al SQL (la PK respeta exact match).
- [ ] Wrapper se invoca dentro de transaction (assert mock pool `transaction` call count = 1).

**Total S8: 5 init + 15 redeem + 5 jti = 25 tests.**

---

## S9 — `getSessionTokenForZone` + `getPlaceForZone` wiring

### `src/app/(app)/place/[placeSlug]/_lib/__tests__/get-place-for-zone.test.ts` (nuevo o extender)

**Por qué importa:** wire-up entre el SSO module y las pages existentes. Bug = la sesión SSO no se detecta → silent SSO loop infinito. Shape de return cambia de `string | null` a `SessionData = {token, source} | null` — 3 callers locked deben adapt.

**Mocks usados:**
- `vi.mock('next/headers')` para cookies (`LOCAL_SESSION_COOKIE_NAME`) + headers (host).
- `vi.mock('@/shared/lib/jwt')` para `getSessionJwt`.
- `vi.mock('@/shared/lib/sso/sso-session')` para `verifyLocalSession`.

**Casos cubiertos (6 total):**

- [ ] **Zone place + Neon Auth válida**: `getSessionTokenForZone()` → `{token: <neon_jwt>, source: 'neon-auth'}`.
- [ ] **Custom-domain + SSO válida**: cookie `__Host-place_sso_session` presente + `verifyLocalSession` OK → `{token: <sso_jwt>, source: 'sso-local'}`.
- [ ] **Custom-domain sin SSO**: cookie ausente → `null`.
- [ ] **SSO expirada**: cookie presente pero `verifyLocalSession` throws → `null` (fail-safe).
- [ ] **`getPlaceForZone` con `source='sso-local'`** usa `getCustomDomainDb` (assert via spy de `getAuthenticatedDbWithVerifier`).
- [ ] **Integration RLS continuity**: end-to-end con sesión SSO local → `getPlaceForZone` retorna el place del owner correcto (mismo `sub`).

**Total S9: 6 tests.**

---

## S10 — Silent SSO trigger en settings + fallback branch

### `src/app/(app)/place/[placeSlug]/settings/__tests__/sso-trigger.test.ts` (nuevo)

**Por qué importa:** branch nuevo en `settings/page.tsx` + `settings/domain/page.tsx`. Bug = owner queda en loop redirect (silent SSO falla → page redirect a sso-init → falla otra vez), o regression del path subdomain canon.

**Mocks usados:**
- `vi.mock('next/navigation')` para `redirect` + `notFound`.
- `vi.mock('@/app/.../get-place-for-zone')` para inyectar sesión por test.

**Casos cubiertos (4 total):**

- [ ] **Custom-domain + sin sesión + sin `sso_error` query** → `redirect('/api/auth/sso-init?returnTo=/settings')` invocado.
- [ ] **Custom-domain + `sso_error=state_mismatch` query** → render `<SsoFallbackPanel>` con `errorCode='state_mismatch'` (no redirect, no loop).
- [ ] **Custom-domain + sesión SSO local válida** → render settings normal (no fallback, no gate, no redirect).
- [ ] **Regression subdomain canon**: zone='place' + sesión Neon Auth válida → render settings normal (Feature B path no se rompió por cambios S10).

**Total S10: 4 tests.**

---

## S11 — Smoke E2E + suite verde + gating push

### Automated (gating pre-commit S10 + pre-push S11)

- [ ] `pnpm typecheck` clean — sin warnings nuevos.
- [ ] `pnpm lint` clean — sin warnings del slice nuevo.
- [ ] `pnpm test` verde — suite total ~630/630 (550 baseline + ~80 nuevos).
- [ ] `pnpm build` exitoso — Next 16 valida los 4 route handlers async.
- [ ] `node scripts/check-translations.mjs` exit 0 — paridad `customDomainRouting.sso.*` × 6 locales.
- [ ] LOC budget: `src/shared/lib/sso/` ≤ 800 (sub-cap propio); cada archivo nuevo ≤ 300; función ≤ 60.
- [ ] `git diff baseline/feature-c-s10-done -- src/` empty (S11 sólo toca docs).

### Curl smoke programático local (10 escenarios — referenciados en spec §"Smoke ejecutado")

Tabla por completar al cierre S11 (ver `spec.md` §"Smoke ejecutado" placeholder).

### Smoke production user-driven (post-push autorizado)

- [ ] Deploy `dpl_*` status READY en Vercel MCP.
- [ ] Migration 0011 aplicada en production branch (pg_proc query via Neon MCP).
- [ ] Owner real loguea en `place.community`.
- [ ] Owner navega a `nocodecompany.co/settings` → silent SSO completa < 1s + render settings.
- [ ] Owner ejecuta acción owner (e.g. cambiar `default_locale` del place) sin redirect al subdomain canon.
- [ ] Verificación logs Vercel: 0 errores del slice en primeros 10min post-deploy.

---

## Security checklist final (cierre S11)

Antes del push autorizado, verificar punto por punto:

- [ ] **CSRF state cookie + state echo**: 3 puntos de validación (init setea, issue propaga, redeem verifica) — tests S3 + S7 + S8 cubren.
- [ ] **Replay jti single-use**: `app.consume_sso_jti` SECURITY DEFINER + ON CONFLICT DO NOTHING — tests S1 + S8 cubren (concurrent + sequential).
- [ ] **Audience binding**: `aud` claim en ticket + jose `jwtVerify({audience})` + re-check manual post-verify — tests S2 + S7 + S8 cubren.
- [ ] **Open-redirect**: 3 puntos de validación (`validateReturnTo` en init, issue, redeem) — tests S3 + S7 + S8 cubren los 3 vectors (`//evil.com`, `https://...`, `javascript:`).
- [ ] **Key isolation env-only no logs**: `PLACE_SSO_SIGNING_KEY` jamás en `console.log/error` — gotcha `sso-signing-key-no-log.md` + tests S2 (`vi.spyOn(console)` mock guard).
- [ ] **Cookie scope `__Host-` verified**: ambas cookies con `Path=/`, `Secure`, sin `Domain` — tests S8 cubren shape exact.
- [ ] **No PII en JWKS**: JWKS body sólo `{kty, crv, x, y, kid, use, alg}` — sin sub, email, ni metadata user — test S5 valida shape field-by-field.
- [ ] **JWKS cache-able 5min**: `Cache-Control: public, max-age=300, s-maxage=300` — test S5 valida headers.

---

## Lo que NO probamos (decisión)

- **RLS owner-only de `app_user`** — ya cubierto en `src/db/__tests__/rls.test.ts` desde ADR-0012; S4 sólo verifica continuidad `sub` end-to-end.
- **OIDC Conformance Suite** — Place NO es OIDC IdP canonical (decisión ADR-0032 §1). Suite testaría aspectos irrelevantes.
- **Browser/Playwright E2E** — V1 cobertura E2E vía curl + cookies + smoke user-driven manual. V2 follow-up cuando entren features client-side al flow.
- **Multi-key rotation flow** — V1 single-key. V2 multi-key zero-downtime deferido (ADR-0032 §"Difiere a planes posteriores").
- **Rate limiting `/api/auth/sso-issue`** — V1 sin rate limit (endpoint gated por sesión Neon Auth + aud verified). V2 deferido.
- **Logout cascade cross-domain** — V1 logout custom domain = borrar cookie local solamente. V2 BroadcastChannel/backend-tracked session_id.
- **Performance del flow** — no se mide en vitest. Latencia esperable: 4 redirects × 50-100ms each = ≤400ms end-to-end (cost budget ADR-0032 §"Cost budget post-C").

---

## Coverage acumulado

V1 esperado al cierre S11:

| Sesión | Tests vitest nuevos | Verificaciones manuales |
|---|---|---|
| S1 — `consume_sso_jti` | 6 | 5 psql |
| S2 — `sso-keys` + `sso-ticket` | 9 | — |
| S3 — `sso-state` | 11 | — |
| S4 — `sso-session` + `db-with-verifier` | 6 | — |
| S5 — `/api/auth/sso-jwks` | 5 | — |
| S6 — `<SsoFallbackPanel>` + i18n | 4 | 1 script |
| S7 — `/api/auth/sso-issue` | 10 | — |
| S8 — `sso-init` + `sso-redeem` + `sso-jti-consume` | 25 | curl smoke local 10 |
| S9 — `getSessionTokenForZone` wiring | 6 | — |
| S10 — Silent SSO trigger settings | 4 | — |
| **Total nuevo** | **~86 vitest** | **≥16 manual/script/psql/curl** |
| **Total suite post-S11** | **~636/636** | — |

S11 smoke production (gating push) NO se contabiliza como tests vitest.

---

## Pointers

- **Plan canónico:** `docs/decisions/0032-custom-domain-sso-signed-ticket.md`.
- **Spec del feature:** `docs/features/custom-domain-sso/spec.md`.
- **Plan de sesiones:** `docs/features/custom-domain-sso/plan-sesiones.md`.
- **Precedente directo (Feature B):** `docs/features/custom-domain-routing/tests.md`.
- **Harness RLS:** `src/db/__tests__/db-test-pool.ts` (`inRlsTx` — seed-as-owner, assert-as-`app_system`, ROLLBACK siempre).
- **`React.cache()` precedente:** `src/app/(app)/place/[placeSlug]/_lib/get-place-for-zone.ts`.
- **i18n parity script:** `scripts/check-translations.mjs`.
- **ADRs relacionadas:** ADR-0001 (refinada por 0032), ADR-0006 (rol `app_system`), ADR-0010 (RLS por-operación), ADR-0011 (`app.current_user_id()`), ADR-0012 (pattern SECURITY DEFINER), ADR-0018 (driver Neon ws), ADR-0022 (i18n DB-based), ADR-0024 (fallback deep-merge), ADR-0026 (Feature A, banner 0027 obsoleta), ADR-0031 (Feature B, §11 obsoleta), ADR-0032 (Feature C canónica).
- **Gotchas relevantes:** `docs/gotchas/host-prefix-cookie-path.md`, `docs/gotchas/sso-signing-key-no-log.md`.
