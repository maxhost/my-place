# Custom Domain SSO — Plan de sesiones (write-back final)

> _Esqueleto inicial creado 2026-05-22 (S0). **Write-back final 2026-05-23 (S11.3.D close)** con commit SHAs reales + tags confirmados + smoke production verde end-to-end (T1.1 + T1.2 + T1.3) + deploy IDs Vercel. **Sub-sesión S11.1 (fix JWKS redirect Opción D, descubierto durante T1.1)** + **sub-sesión S11.2 (fix zone-cookie unawareness Opción B, descubierto durante T1.2 post-T1.1)** + **sub-sesión S11.3 (fix cold-start M1 Opción única ADR-0033 page consumer del `?returnTo`, descubierto durante smoke M1 owner-driven post-S11.2)** cerraron el último gap funcional. El plan operacional completo (sesiones S-1 → S11 con justificación, parallel agents, locked files, LOC budget tracking, gap closure) vive en `/Users/maxi/.claude/plans/wise-greeting-mccarthy.md` — single source of truth ejecutiva._

## Status: **CERRADA end-to-end (T1.1 + T1.2 + T1.3)** ✅

Feature C V1 deployed a producción 2026-05-23 con tres sub-sesiones de fix post-deploy verificadas verde, cubriendo los 3 escenarios canónicos del cold-start SSO desde custom domain (M1 anónimo + M2 sesión activa + M3 expirados):

- **T1.1 (silent SSO signature_invalid, M2)** cerrado por S11.1 (deploy `dpl_5fmp8Lfc7sagPiB8bPaGmJZ2dXM4`). Cookie `__Host-place_sso_session` correctamente seteada (claims `iss/sub/host/iat/exp` válidos, continuidad RLS empíricamente verificada con `sub` matcheando Neon Auth user.id).
- **T1.2 (4 Server Actions broken on custom domain, RFC 6265 cookie scope, M2)** cerrado por S11.2 (deploy `dpl_2vhnAC2REbcjGgureWp85VRqpzj6` READY 2026-05-23). Helper zone-aware `getAuthenticatedDbForRequest` detecta la zona del request y resuelve la cookie correcta (Neon Auth en apex/subdomain, SSO local `__Host-place_sso_session` en custom domain). Las 4 actions migradas (`update-default-locale`, `register-custom-domain`, `archive-custom-domain`, `get-custom-domain-status`) ahora funcionan transparentemente en ambas zonas — UI populated + acciones owner ejecutables desde `nocodecompany.co/settings` y `nocodecompany.co/settings/domain`. Tag `baseline/feature-c-s11.2-done` = `17b5df5`.
- **T1.3 (apex login descarta `?returnTo` en cold-start M1)** ✅ cerrado por S11.3 (ADR-0033 canónica, deploy `dpl_FwjvKLuj9v9AmPM48ngrUwXU4Dpu` READY 2026-05-23 en 43s). Bug pre-existing en login apex `/[locale]/login` (no contemplaba `searchParams.returnTo` + `AccessFlow.onSuccess` hardcoded a Hub canónico). Feature C lo expuso sin causarlo — fue la primera feature que envió users a `/login?returnTo=…` esperando honor. Fix: helper PURE `validateLoginReturnTo` (128 LOC + 14 tests) con allowlist explícito (`/api/auth/sso-{issue,init}` + same-registrable-domain HTTPS + relative paths) + wire-up minimal en 3 archivos (`page.tsx` Server + `AccessFlow` Client + `useAccessForm` **intacto**, separation of concerns preservada). Smoke M1 owner-driven 2026-05-23: VERDE — visitor incógnito en `nocodecompany.co/settings` → silent SSO → apex login → submit → returnTo honrado → ticket emitido → redeem → cookie SSO local seteada → aterriza en `/settings` con form populated zone-aware. Tag final `baseline/feature-c-s11.3-done` = close commit de este write-back.

## Mapeo S-1 → S11 (write-back con SHAs reales)

| Sesión | Objetivo | Commit SHA real | Tag baseline |
|---|---|---|---|
| **S-1** | Save point pre-Feature-C | `d20ab00` (= Feature B done) | `baseline/pre-feature-c` |
| **S0** | Docs canónicos: ADR-0032 + reescritura legacy + gotchas + spec/tests/plan | `5162923` | `baseline/feature-c-s0-done` |
| **S1** | Migration 0011 `app.consume_sso_jti` SECURITY DEFINER + RLS tests | `57e9126` | `baseline/feature-c-s1-done` |
| **S2** | `sso-keys.ts` + `sso-ticket.ts` (helpers puros) + barrel + tests | `91545a9` | `baseline/feature-c-s2-done` |
| **S3** | `sso-state.ts` (CSRF cookie + nonce + returnTo) + tests | `0b22b2c` | `baseline/feature-c-s3-done` |
| **S3.5** | ADR-0032 §5 addendum sub-cap 800 → 1000 LOC (recalibración post-S3) | `cc481d4` | `baseline/feature-c-s3.5-done` |
| **S4** | `sso-session.ts` + `db-with-verifier.ts` (RLS bridge) + tests | `c3256f0` | `baseline/feature-c-s4-done` |
| **S5** | `/api/auth/sso-jwks` endpoint apex + verify proxy matcher | `d261ee8` | `baseline/feature-c-s5-done` |
| **S6** | i18n `customDomainRouting.sso.*` × 6 locales + `<SsoFallbackPanel>` + public.ts | `1b504c1` | `baseline/feature-c-s6-done` |
| **S7** | `/api/auth/sso-issue` (apex issuer) + tests | `c7af364` | `baseline/feature-c-s7-done` |
| **S8** | `/api/auth/sso-init` + `/api/auth/sso-redeem` + `sso-jti-consume.ts` + tests | `1e19509` | `baseline/feature-c-s8-done` |
| **S9** | Wire `getSessionTokenForZone` + `getPlaceForZone` con db-with-verifier | `c95db98` | `baseline/feature-c-s9-done` |
| **S10** | Silent SSO trigger en settings + `<SsoFallbackPanel>` branch | `e61e027` | `baseline/feature-c-s10-done` |
| **S11.1 (code)** | Fix JWKS redirect: customFetch + same-registrable-domain allowlist (Opción D) | `23d4c72` | `baseline/feature-c-s11.1-code` |
| **S11.1 (docs)** | Postmortem gotcha + ADR-0032 §12 addendum + sub-cap bump 1000 → 1100 | `473c3e8` | `baseline/feature-c-s11.1-jwks-fix` |
| **S11 (close T1.1)** | Smoke E2E T1.1 verde + docs close + write-back + push autorizado | `523fa8d` | `baseline/feature-c-done` |
| **S11.2.A** | Foundation zone-aware: `decideAuthBranch` (PURE) + `getAuthenticatedDbForRequest` (integrator) + 8 tests | `20b44e8` | `baseline/feature-c-s11.2.A-foundation` |
| **S11.2.B** | Migrar 4 Server Actions broken-on-custom-domain a helper zone-aware (2 exemplars Maxi + 2 parallel agents) | `bebfbf4` | `baseline/feature-c-s11.2.B-migrated` |
| **S11.2.C (pre-push)** | Docs close-out S11.2: write-back plan-sesiones + spec T1.2 journey | `5e62f0d` | `baseline/feature-c-s11.2.C-pre-push` |
| **S11.2 (close T1.2)** | Push bundle (A+B+C) + smoke production T1.2 retry VERDE + final write-back | `17b5df5` | `baseline/feature-c-s11.2-done` |
| **S-1 S11.3** | Save point pre-fix-returnto (tag-only, sin commit) | `17b5df5` (= s11.2-done) | `baseline/pre-s11.3-fix-returnto` |
| **S11.3.A** | Docs canónica T1.3: ADR-0033 + spec write-back + plan-sesiones + gotcha + READMEs | `7d872ad` | `baseline/feature-c-s11.3.A-docs` |
| **S11.3.B** | Helper PURE `validateLoginReturnTo` (~128 LOC actual vs ~80 est) + 14 tests passing (12 canónicos + 2 secundarios: `/api/auth/sso-init` allowlist hit + subdomain del apex same-registrable) + addendum ADR-0032 §5 bump sub-cap 1100 → 1400 (medición real pre 1168 → post 1297, +100 buffer) | `d03b30d` | `baseline/feature-c-s11.3.B-helper` |
| **S11.3.C** | Wire-up `page.tsx` (92→122 LOC, +30 vs +18 est por doc-density del wire SSO) + `AccessFlow` (227→240 LOC, +13 matches est exactly) + `useAccessForm` **intacto** (120 LOC, superficie del hook agnóstica del destino preservada per ADR-0033) + 2 tests RTL nuevos (`respeta returnTo` + `regression Hub sin returnTo`, total 7→9 passing) + extensión backward-compat del helper `setup()` con prop opcional `returnTo` (los 3 tests navigate existentes siguen pasando sin cambio de behavior — pass `undefined` default) | `48b204b` | `baseline/feature-c-s11.3.C-wire` |
| **S11.3.D (push)** | Push autorizado bundle A+B+C (commits `7d872ad` + `d03b30d` + `48b204b`) → trigger deploy → deploy `dpl_FwjvKLuj9v9AmPM48ngrUwXU4Dpu` READY en 43s con alias `nocodecompany.co`/`place.community`/`www.place.community`/`app.place.community` mapeados. PAT stderr redaction aplicada (`sed -E 's\|ghp_[A-Za-z0-9_]+\|***REDACTED***\|g'`) — sin leak | N/A (push, sin commit nuevo) | N/A |
| **S11.3.D (smoke)** | Server-side sanity smoke (no-cookies) — 2/2 VERDE: `place.community/api/auth/sso-issue` sin cookie → 302 a `place.community/es/login?returnTo=<sso-issue URL encoded>` (`Location` header con `returnTo` preservado, **diferencia clave vs pre-fix que iba a `/es/login` sin returnTo**) + login page con returnTo válido → 200 + form HTML (14460 bytes). + Smoke M1 owner-driven 2026-05-23 (incógnito real, owner de `nocodecompany.co`): VERDE — entry custom-domain `/settings` → redirect a apex login → identificación → vuelve a `nocodecompany.co/settings` con sesión SSO local. Cierra T1.3 end-to-end | N/A (smoke, sin commit) | N/A |
| **S11.3.D (close)** | Write-back final: spec.md §"T1.3 retry post-fix" con evidencia VERDE + tabla server-side smoke 2/2 + tabla owner-driven 4/4 + cita literal del user + §"Conclusión final Feature C V1" (M1+M2+M3 cubiertos); plan-sesiones (este commit) backfill SHA `48b204b` de S11.3.C + add S11.3.D row + status header CERRADA end-to-end + smoke results T1.3 retry VERDE + tag final `baseline/feature-c-s11.3-done`; ADR-0033 banner final cierre operativo con commit + deploy ID + smoke owner-driven verde | TBD (este commit) | `baseline/feature-c-s11.3-done` |

Detalle ejecutivo por sesión (justificación, parallel agents, locked files, pre/post-commit checklist, LOC tracking): `/Users/maxi/.claude/plans/wise-greeting-mccarthy.md`.

## Desviaciones del plan ejecutivo original

### 1. S3.5 — addendum sub-cap 800 → 1000 LOC (no estaba en el plan)

Trigger: tras cerrar S2 + S3 el sub-módulo `src/shared/lib/sso/` consumió 647 LOC (vs 470 LOC proyectados, +38% por densidad doc). Diagnóstico: doc-density real ~50-60% en `sso-ticket.ts` reflejando "production-minded desde el día uno" (memoria de feedback del user). Recalibración elástica documentada en addendum ADR-0032 §5. Sub-cap raíz `shared/lib/` (800) intacto.

### 2. S11.1 — fix bug descubierto en smoke production T1.1

Smoke T1.1 inicial (2026-05-23) detectó `?sso_error=signature_invalid` con ticket matemáticamente válido. Diagnosis: jose v6 hardcodea `redirect: 'manual'` en `dist/webapi/jwks/remote.js` línea 19 (defensa anti JWKS-hijack), chocando con redirect platform-level Vercel `place.community → www.place.community` (HTTP 307 apex→www). Fix Opción D (validado vs 8 alternativas): `customFetch` Symbol export de jose + helper `makeSafeRedirectFollowingFetch` con policy same-registrable-domain + https + ≤3 hops. Restaura funcionalidad sin perder defense-in-depth.

Sub-sesión S11.1 ejecutada bajo TDD estricto (10 tests RED → GREEN), code commit + docs commit separados con tags intermedios para rollback granular. Documentación: postmortem en `docs/gotchas/jose-jwks-redirect-manual.md` + ADR-0032 §12 nuevo "Same-registrable-domain redirect policy" + addendum §5 sub-cap 1000 → 1100 LOC (el helper consumió ~140 LOC adicionales).

### 3. S0 expandido a 15 archivos docs (vs ~6 originalmente proyectado)

Gap-scan exhaustivo de docs pre-S0 reveló 15 menciones legacy a "OIDC IdP plugin" en `stack.md` / `architecture.md` / `multi-tenancy.md` / `data-model.md` que requerían reescritura post-ADR-0032 (que supersede ADR-0001 §3). Se ejecutó S0 con 7 parallel agents disjoint (ADR + spec/tests/plan + 4 docs canónicos + banners + gotchas) — mismo patrón Feature B-S0.

### 4. S11.2 — fix bug T1.2 descubierto en smoke owner-driven post-T1.1

Trigger: el smoke T1.1 verde verificó que la cookie `__Host-place_sso_session` se setea correctamente. El siguiente smoke owner-driven (navegación a `nocodecompany.co/settings`) reveló que la cookie SSO existe pero **4 Server Actions seguían rotos** porque sólo leían la cookie Neon Auth (`Domain=.place.community`) que por RFC 6265 NO existe en custom domain. Síntoma: form de locale vacío + `/settings/domain` no muestra dominio configurado.

**Root cause**: el helper canon `getAuthenticatedDb(token, fn)` (Feature A) asume que `token` es Neon Auth JWT. Las 4 actions afectadas (`update-default-locale`, `register-custom-domain`, `archive-custom-domain`, `get-custom-domain-status`) usaban `requireSessionJwt() + getAuthenticatedDb(token, …)` — patrón rota cuando la única cookie disponible es el SSO local del custom domain.

**Fix Opción B** (validado vs 5 alternativas en plan v2, single source of truth en `/Users/maxi/.claude/plans/wise-greeting-mccarthy.md`): nuevo helper coordinador `getAuthenticatedDbForRequest(fn)` que detecta `HostZone` del request + lee la cookie correcta + dispatcha al primitivo apropiado (`getAuthenticatedDb` para Neon Auth, `getAuthenticatedDbWithVerifier` para SSO local). Decisión PURE separada (`decideAuthBranch`) testeable sin `next/headers`/SDK/DB (8 tests unitarios). Las 4 actions migradas dropean el `token: string` param de sus helpers internos.

Sub-sesión S11.2 ejecutada en 3 sub-fases con tags intermedios para rollback granular: **S11.2.A foundation** (helper + 8 tests PURE, single owner Maxi por ser código de seguridad), **S11.2.B migration** (2 exemplars Maxi + 2 parallel agents disjoint en files separados con locked-files declarados), **S11.2.C close-out** (este commit + smoke production retry + push bundle).

**Costo aceptable V1**: cada `getAuthenticatedDbForRequest` invocation repite zone resolution + JWT verification + SQL lookup a `app.lookup_place_by_domain`. En multi-helper actions con 3 calls internas = 3× roundtrips. Documentado in-code; V1.1 follow-up si telemetría demanda (memoizar decision con `React.cache` dentro del helper).

### 5. S11.3 — fix bug T1.3 descubierto en smoke M1 owner-driven post-S11.2

Trigger: con T1.1 + T1.2 verdes (silent SSO + Server Actions zone-aware), el smoke M1 owner-driven 2026-05-23 (visitor anónimo en incógnito → `nocodecompany.co/settings`) reveló que el flow SSO emite `?returnTo=<sso-issue URL>` correctamente desde `redirectToApexLogin` (`src/app/api/auth/sso-issue/route.ts:145-153`) pero **el login apex lo descarta silenciosamente** y aterriza al user en Hub canónico hardcoded.

**Root cause**: bug pre-existing en `/[locale]/login` (page `src/app/(marketing)/[locale]/login/page.tsx` + componente `src/features/access/ui/access-flow.tsx` + hook `src/features/access/ui/use-access-form.ts`). Construidos en S9 del Hub V1 (ADR-0008/0009) para flow account-first SIN contemplar redirect-after-login. 5 smoking guns confirmados con file:line (ADR-0033 §"Smoking guns"):

1. `page.tsx:22` — `type Props = { params }` sin `searchParams` → returnTo invisible.
2. `page.tsx:38-41` — guard "ya logueado" hardcoded a Hub canónico.
3. `page.tsx:81-88` — page no propaga returnTo al AccessFlow (no puede — no lo lee).
4. `access-flow.tsx:52` — `onSuccess` hardcoded a Hub canónico.
5. `use-access-form.ts:23,76` — `onSuccess: () => void` sin surface para returnTo.

Los 5 forman cadena coherente: page NUNCA lee returnTo + guard NO lo respeta + componente cliente está cableado para descartarlo. El bug NO es del SSO flow (que emite correctamente) sino del **consumer del returnTo en login apex**.

**Por qué no se detectó antes**: T1.1 y T1.2 partían siempre de owner ya logueado en apex (silent SSO toma path que mintea ticket sin pasar por login). Sólo el cold-start incógnita (M1) expone el gap. Feature C es la primera feature que envía users a `/login?returnTo=…` esperando honor.

**Fix Opción única "page consumer del returnTo"** (ADR-0033 canónica): helper PURE nuevo `validateLoginReturnTo` en `src/shared/lib/sso/` (~80 LOC) con allowlist explícito (`/api/auth/sso-{issue,init}` + relative paths) + same-registrable-domain HTTPS para absolute URLs (precedente S11.1 `sso-jwks-fetcher` same-registrable-domain policy) + reject de open-redirect vectors. Wire-up minimal: page lee + valida + propaga, AccessFlow recibe nuevo prop `returnTo?: string` + closure en onSuccess, `useAccessForm` NO se toca (separation of concerns preservada).

**Backwards-compat**: flows pre-Feature-C sin returnTo (signup landing, login directo apex marketing, etc.) siguen al Hub canónico hardcoded — comportamiento idéntico al pre-S11.3. Cero blast-radius colateral.

**Alternativas rechazadas** (ADR-0033 §"Alternativas rechazadas"): (1) Server Action redirect server-side — incompatible con Better Auth contract; (2) reescribir flow Feature C para emitir tickets sin sesión apex — imposible by design; (3) cookie "intended destination" pre-login — over-engineering; (4) mover silent SSO al middleware — out of scope (ortogonal al bug); (5) allowlist abierto — over-permissive V1.

Sub-sesión S11.3 ejecutada en 4 sub-fases con tags intermedios para rollback granular: **S-1 save point** (tag-only, `baseline/pre-s11.3-fix-returnto` = `17b5df5`, suite verde verificada), **S11.3.A docs** (este commit, single owner Maxi sequential — 5-6 docs cohesivos, sin agentes), **S11.3.B helper PURE** (single owner Maxi — código de seguridad), **S11.3.C wire-up** (single owner Maxi — 3 archivos cohesivos), **S11.3.D smoke + close + push** (single owner Maxi).

## Smoke production resultados (referencia)

**Resultados completos**: ver `spec.md` §"Smoke ejecutado 2026-05-23".

Resumen:
- **Deploy T1.1**: `dpl_5fmp8Lfc7sagPiB8bPaGmJZ2dXM4` READY 2026-05-23 (commit `473c3e8`).
- **T1.1 inicial** (commit `e61e027` deploy `dpl_3LHtn6dn...`): `sso_error=signature_invalid` → triggered S11.1 fix.
- **T1.1 retry post-fix** (commit `473c3e8` deploy `dpl_5fmp8Lfc...`): **VERDE** — cookie `__Host-place_sso_session` con claims `iss=place.community / sub=<neon_auth_user_id> / host=nocodecompany.co / iat / exp +7d` correctamente seteada en `nocodecompany.co/settings` post silent SSO.
- **T1.2 inicial** (deploy `dpl_5fmp8Lfc...`, post-cookie set): `nocodecompany.co/settings` cargó la página pero **form de locale vacío** + `nocodecompany.co/settings/domain` no muestra dominio configurado. RLS-filtered a 0 rows porque `app.current_user_id()` retornó NULL en custom domain (cookie Neon Auth ausente por RFC 6265, las 4 Server Actions leían SÓLO Neon Auth) → triggered S11.2 fix.
- **T1.2 retry post-fix** (commit `5e62f0d` deploy `dpl_2vhnAC2REbcjGgureWp85VRqpzj6`): **VERDE** — los 3 paths owner-driven (`/settings` form populated + `/settings/domain` dominio configurado + cambiar locale persiste) pasan. Server-side sanity (host routing + silent SSO trigger + JWKS apex) intacta. Detalle completo en `spec.md` §"T1.2 retry post-fix".
- **T1.3 inicial (M1 cold-start owner-driven post-S11.2, 2026-05-23)**: **ROJO** — visitor anónimo en `nocodecompany.co/settings` dispara silent SSO correctamente (steps 1-4 OK), aterriza en apex login con `?returnTo=<sso-issue URL>` correctamente encoded, loguea, pero al submit **navega a Hub canónico hardcoded en lugar del returnTo** → triggered S11.3 fix (ADR-0033). Detalle en `spec.md` §"T1.3 inicial".
- **T1.3 retry post-fix** (bundle A+B+C commits `7d872ad` + `d03b30d` + `48b204b`, deploy `dpl_FwjvKLuj9v9AmPM48ngrUwXU4Dpu` READY 2026-05-23 en 43s): **VERDE** — server-side sanity smoke 2/2 (sso-issue sin cookie → 302 a apex login con `?returnTo=` preservado URL-encoded; login con returnTo válido → 200 + form HTML 14460 bytes) + owner-driven M1 4/4 (incógnito real → entry `/settings` → apex login → identificación → vuelve a `/settings` con sesión SSO local). Detalle completo + tablas + cita literal del user en `spec.md` §"T1.3 retry post-fix" + §"Conclusión final Feature C V1".

## Comando de rollback total documentado

```bash
# Rollback total a Feature B (estado pre-Feature-C):
git reset --hard baseline/pre-feature-c

# Rollback al pre-fix JWKS (estado S10, sin fix de bug T1.1):
git reset --hard baseline/pre-s11-fix-jwks-redirect

# Rollback al pre-fix zone-aware (estado S11 close, sin fix de bug T1.2):
git reset --hard baseline/feature-c-done

# Rollback granular S11.2:
#   - S11.2.B (mantiene foundation): git reset --hard baseline/feature-c-s11.2.A-foundation
#   - S11.2.A (vuelve a pre-S11.2):  git reset --hard baseline/feature-c-done

# Rollback al pre-fix returnTo (estado S11.2 close, sin fix de bug T1.3):
git reset --hard baseline/pre-s11.3-fix-returnto

# Rollback granular S11.3:
#   - S11.3.C (mantiene helper): git reset --hard baseline/feature-c-s11.3.B-helper
#   - S11.3.B (mantiene docs):   git reset --hard baseline/feature-c-s11.3.A-docs
#   - S11.3.A (vuelve a S11.2):  git reset --hard baseline/pre-s11.3-fix-returnto

# Migration 0011 aplicada en branch Neon test/preview: DROP manual si rollback < S1:
#   psql "$DATABASE_URL" -c "REVOKE EXECUTE ON FUNCTION app.consume_sso_jti(text, timestamptz) FROM \"app_system\";"
#   psql "$DATABASE_URL" -c "DROP FUNCTION IF EXISTS app.consume_sso_jti(text, timestamptz);"
#   psql "$DATABASE_URL" -c "DROP TABLE IF EXISTS app.sso_jti_used;"

# Rollback a sesión previa (granular):
git reset --hard baseline/feature-c-s<N-1>-done
```

**Pre-condición rollback**: si la migration 0011 ya fue aplicada a la branch Neon afectada, el DROP manual es necesario antes del próximo deploy (Drizzle journal no soporta `down` automático).

**Push reversal**: si el push de S11 ya ocurrió pero smoke production detecta regression, rollback = `git revert <commit-sha>` + nuevo push (NO `git reset` en remote main). Decisión por turno con user.

## Baseline tags evolucionados (final)

```
baseline/pre-feature-c                  = d20ab00   (S-1 save point pre-Feature-C, 2026-05-22)
baseline/feature-c-s0-done              = 5162923   (S0 docs canónicos + ADR-0032)
baseline/feature-c-s1-done              = 57e9126   (S1 migration 0011 + RLS tests)
baseline/feature-c-s2-done              = 91545a9   (S2 sso-keys + sso-ticket helpers puros)
baseline/feature-c-s3-done              = 0b22b2c   (S3 sso-state cookie + returnTo)
baseline/feature-c-s3.5-done            = cc481d4   (S3.5 addendum sub-cap 800 → 1000 LOC)
baseline/feature-c-s4-done              = c3256f0   (S4 sso-session + db-with-verifier)
baseline/feature-c-s5-done              = d261ee8   (S5 /api/auth/sso-jwks endpoint apex)
baseline/feature-c-s6-done              = 1b504c1   (S6 i18n × 6 + <SsoFallbackPanel>)
baseline/feature-c-s7-done              = c7af364   (S7 /api/auth/sso-issue handler apex)
baseline/feature-c-s8-done              = 1e19509   (S8 sso-init + sso-redeem + sso-jti-consume)
baseline/feature-c-s9-done              = c95db98   (S9 wire getSessionTokenForZone + 3 callers)
baseline/feature-c-s10-done             = e61e027   (S10 silent SSO trigger en settings)
baseline/pre-s11-fix-jwks-redirect      = e61e027   (= s10-done, save point pre-fix S11.1)
baseline/feature-c-s11.1-code           = 23d4c72   (S11.1 code: customFetch + helper + 10 tests)
baseline/feature-c-s11.1-jwks-fix       = 473c3e8   (S11.1 docs: gotcha + ADR §12 addendum)
baseline/feature-c-done                 = 523fa8d   (S11 close T1.1: smoke verde + write-back)
baseline/feature-c-s11.2.A-foundation   = 20b44e8   (S11.2.A: decideAuthBranch PURE + getAuthenticatedDbForRequest + 8 tests)
baseline/feature-c-s11.2.B-migrated     = bebfbf4   (S11.2.B: 4 Server Actions migradas a helper zone-aware)
baseline/feature-c-s11.2.C-pre-push     = 5e62f0d   (S11.2.C pre-push: docs close-out + push autorizado bundle A+B+C)
baseline/feature-c-s11.2-done           = 17b5df5   (S11.2 close T1.2: smoke owner-driven VERDE + final write-back)
baseline/pre-s11.3-fix-returnto         = 17b5df5   (= s11.2-done, save point pre-fix S11.3 cold-start M1)
baseline/feature-c-s11.3.A-docs         = 7d872ad   (S11.3.A docs: ADR-0033 + spec write-back + plan-sesiones + gotcha)
baseline/feature-c-s11.3.B-helper       = d03b30d   (S11.3.B: validateLoginReturnTo PURE 128 LOC + 14 tests + addendum ADR-0032 §5 bump 1100→1400)
baseline/feature-c-s11.3.C-wire         = 48b204b   (S11.3.C: wire-up page 92→122 + AccessFlow 227→240 + useAccessForm intacto + 2 tests RTL nuevos, total suite 698/698)
baseline/feature-c-s11.3-done           = TBD       (S11.3.D close T1.3: smoke M1 retry VERDE + docs close + push bundle A+B+C autorizado 2026-05-23 deploy dpl_FwjvKLuj9v9AmPM48ngrUwXU4Dpu READY en 43s)
```

## Pointers

- **ADR canónica V1 de Feature C**: [`../../decisions/0032-custom-domain-sso-signed-ticket.md`](../../decisions/0032-custom-domain-sso-signed-ticket.md) — incluye §12 "Same-registrable-domain redirect policy" (post-S11.1).
- **ADR canónica S11.3 (cold-start M1)**: [`../../decisions/0033-apex-login-honors-returnto.md`](../../decisions/0033-apex-login-honors-returnto.md) — refina ADR-0032 §2 step 2 (cierra contrato del lado consumer del `?returnTo` que `sso-issue` ya emitía correctamente).
- **Spec del feature**: [`./spec.md`](./spec.md) — §"Smoke ejecutado 2026-05-23" (T1.1 + T1.2 VERDE) + §"T1.3 inicial ROJO + S11.3 fix" + §"T1.3 retry post-fix" (TBD post-S11.3.D).
- **Tests checklist**: [`./tests.md`](./tests.md) — checklist TDD ejecutado verde para happy-path; tests S11.3 pending S11.3.B/.C.
- **Gotcha S11.1**: [`../../gotchas/jose-jwks-redirect-manual.md`](../../gotchas/jose-jwks-redirect-manual.md) — postmortem operativo del bug T1.1.
- **Gotcha S11.3**: [`../../gotchas/apex-login-returnto-honored.md`](../../gotchas/apex-login-returnto-honored.md) — postmortem operativo del bug T1.3 (cold-start M1 + 5 smoking guns + modelo mental para futuros consumers de `/login?returnTo=…`).
- **Plan ejecutivo completo (single source of truth)**: `/Users/maxi/.claude/plans/wise-greeting-mccarthy.md`.
- **Save point pre-Feature-C (= Feature B done)**: tag `baseline/pre-feature-c` (commit `d20ab00`).
- **Save point pre-S11.3 (= S11.2 done)**: tag `baseline/pre-s11.3-fix-returnto` (commit `17b5df5`).
- **Precedente Feature B plan**: [`../custom-domain-routing/plan-sesiones.md`](../custom-domain-routing/plan-sesiones.md).
