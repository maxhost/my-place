# Custom Domain SSO — Plan de sesiones (write-back final)

> _Esqueleto inicial creado 2026-05-22 (S0). **Write-back final 2026-05-23 (S11)** con commit SHAs reales + tags confirmados + smoke production verde + deploy IDs Vercel + sub-sesión S11.1 (fix JWKS redirect Opción D, descubierto durante T1.1). El plan operacional completo (sesiones S-1 → S11 con justificación, parallel agents, locked files, LOC budget tracking, gap closure) vive en `/Users/maxi/.claude/plans/wise-greeting-mccarthy.md` — single source of truth ejecutiva._

## Status: **CERRADA — V1 deployed + smoke production verde** ✅

Feature C V1 deployed a producción 2026-05-23 (deploy `dpl_5fmp8Lfc7sagPiB8bPaGmJZ2dXM4` READY). Smoke production T1.1 verde con evidencia cookie `__Host-place_sso_session` correctamente seteada (claims `iss/sub/host/iat/exp` válidos, continuidad RLS empíricamente verificada con `sub` matcheando Neon Auth user.id).

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
| **S11 (close)** | Smoke E2E + docs close + write-back plan-sesiones + push autorizado | TBD (este commit) | `baseline/feature-c-done` |

Detalle ejecutivo por sesión (justificación, parallel agents, locked files, pre/post-commit checklist, LOC tracking): `/Users/maxi/.claude/plans/wise-greeting-mccarthy.md`.

## Desviaciones del plan ejecutivo original

### 1. S3.5 — addendum sub-cap 800 → 1000 LOC (no estaba en el plan)

Trigger: tras cerrar S2 + S3 el sub-módulo `src/shared/lib/sso/` consumió 647 LOC (vs 470 LOC proyectados, +38% por densidad doc). Diagnóstico: doc-density real ~50-60% en `sso-ticket.ts` reflejando "production-minded desde el día uno" (memoria de feedback del user). Recalibración elástica documentada en addendum ADR-0032 §5. Sub-cap raíz `shared/lib/` (800) intacto.

### 2. S11.1 — fix bug descubierto en smoke production T1.1

Smoke T1.1 inicial (2026-05-23) detectó `?sso_error=signature_invalid` con ticket matemáticamente válido. Diagnosis: jose v6 hardcodea `redirect: 'manual'` en `dist/webapi/jwks/remote.js` línea 19 (defensa anti JWKS-hijack), chocando con redirect platform-level Vercel `place.community → www.place.community` (HTTP 307 apex→www). Fix Opción D (validado vs 8 alternativas): `customFetch` Symbol export de jose + helper `makeSafeRedirectFollowingFetch` con policy same-registrable-domain + https + ≤3 hops. Restaura funcionalidad sin perder defense-in-depth.

Sub-sesión S11.1 ejecutada bajo TDD estricto (10 tests RED → GREEN), code commit + docs commit separados con tags intermedios para rollback granular. Documentación: postmortem en `docs/gotchas/jose-jwks-redirect-manual.md` + ADR-0032 §12 nuevo "Same-registrable-domain redirect policy" + addendum §5 sub-cap 1000 → 1100 LOC (el helper consumió ~140 LOC adicionales).

### 3. S0 expandido a 15 archivos docs (vs ~6 originalmente proyectado)

Gap-scan exhaustivo de docs pre-S0 reveló 15 menciones legacy a "OIDC IdP plugin" en `stack.md` / `architecture.md` / `multi-tenancy.md` / `data-model.md` que requerían reescritura post-ADR-0032 (que supersede ADR-0001 §3). Se ejecutó S0 con 7 parallel agents disjoint (ADR + spec/tests/plan + 4 docs canónicos + banners + gotchas) — mismo patrón Feature B-S0.

## Smoke production resultados (referencia)

**Resultados completos**: ver `spec.md` §"Smoke ejecutado 2026-05-23".

Resumen:
- **Deploy**: `dpl_5fmp8Lfc7sagPiB8bPaGmJZ2dXM4` READY 2026-05-23 (commit `473c3e8`).
- **T1.1 inicial** (commit `e61e027` deploy `dpl_3LHtn6dn...`): `sso_error=signature_invalid` → triggered S11.1 fix.
- **T1.1 retry post-fix** (commit `473c3e8` deploy `dpl_5fmp8Lfc...`): **VERDE** — cookie `__Host-place_sso_session` con claims `iss=place.community / sub=<neon_auth_user_id> / host=nocodecompany.co / iat / exp +7d` correctamente seteada en `nocodecompany.co/settings` post silent SSO.

## Comando de rollback total documentado

```bash
# Rollback total a Feature B (estado pre-Feature-C):
git reset --hard baseline/pre-feature-c

# Rollback al pre-fix JWKS (estado S10, sin fix de bug T1.1):
git reset --hard baseline/pre-s11-fix-jwks-redirect

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
baseline/feature-c-done                 = TBD       (S11 close: smoke verde + write-back, este commit)
```

## Pointers

- **ADR canónica V1 de Feature C**: [`../../decisions/0032-custom-domain-sso-signed-ticket.md`](../../decisions/0032-custom-domain-sso-signed-ticket.md) — incluye §12 "Same-registrable-domain redirect policy" (post-S11.1).
- **Spec del feature**: [`./spec.md`](./spec.md) — §"Smoke ejecutado 2026-05-23" con evidencia T1.1 verde.
- **Tests checklist**: [`./tests.md`](./tests.md) — checklist TDD ejecutado verde.
- **Gotcha S11.1**: [`../../gotchas/jose-jwks-redirect-manual.md`](../../gotchas/jose-jwks-redirect-manual.md) — postmortem operativo del bug T1.1.
- **Plan ejecutivo completo (single source of truth)**: `/Users/maxi/.claude/plans/wise-greeting-mccarthy.md`.
- **Save point pre-Feature-C (= Feature B done)**: tag `baseline/pre-feature-c` (commit `d20ab00`).
- **Precedente Feature B plan**: [`../custom-domain-routing/plan-sesiones.md`](../custom-domain-routing/plan-sesiones.md).
