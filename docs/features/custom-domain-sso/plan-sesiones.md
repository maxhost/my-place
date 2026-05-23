# Custom Domain SSO — Plan de sesiones (esqueleto)

> _Esqueleto inicial creado 2026-05-22 (S0). Este archivo recibe **write-back en S11** con commit SHAs reales + tags confirmados + smoke ejecutado verde. El plan operacional completo (sesiones S-1 → S11 con justificación, parallel agents, locked files, LOC budget tracking, gap closure) vive en `/Users/maxi/.claude/plans/wise-greeting-mccarthy.md` — single source of truth ejecutiva._

## Mapeo S-1 → S11

| Sesión | Objetivo | Files (count + names brief) | Commit SHA | Tag baseline |
|---|---|---|---|---|
| **S-1** | Save point pre-Feature-C | 0 (tag-only) | `d20ab00` | `baseline/pre-feature-c` (= `baseline/feature-b-done`) |
| **S0** | Docs canónicos: ADR-0032 + reescritura legacy + gotchas + spec/tests/plan | 15 (ADR + spec/tests/plan slice + 4 banners + 4 docs canónicos + 3 gotchas) | TBD | `baseline/feature-c-s0-done` |
| **S1** | Migration 0011 `app.consume_sso_jti` SECURITY DEFINER + RLS tests | 3 (`0011_*.sql` + `_journal.json` + test) | TBD | `baseline/feature-c-s1-done` |
| **S2** | `sso-keys.ts` + `sso-ticket.ts` (helpers puros) + barrel + tests | 5 (index, sso-keys, sso-ticket, 2 tests) | TBD | `baseline/feature-c-s2-done` |
| **S3** | `sso-state.ts` (CSRF cookie + nonce + returnTo) + tests | 2 (sso-state + test) | TBD | `baseline/feature-c-s3-done` |
| **S4** | `sso-session.ts` + `db-with-verifier.ts` (RLS bridge) + tests | 4 (sso-session + db-with-verifier + 2 tests) | TBD | `baseline/feature-c-s4-done` |
| **S5** | `/api/auth/sso-jwks` endpoint apex + verify proxy matcher + test | 2 (route + test; proxy.ts verify-only) | TBD | `baseline/feature-c-s5-done` |
| **S6** | i18n `customDomainRouting.sso.*` × 6 locales + `<SsoFallbackPanel>` + public.ts | 8 (6 locales + sso-fallback-panel.tsx + public.ts extend) | TBD | `baseline/feature-c-s6-done` |
| **S7** | `/api/auth/sso-issue` (apex issuer) + tests | 2 (route + test) | TBD | `baseline/feature-c-s7-done` |
| **S8** | `/api/auth/sso-init` + `/api/auth/sso-redeem` + `sso-jti-consume.ts` + tests | 6 (2 routes + 2 tests + jti-consume wrapper + test) | TBD | `baseline/feature-c-s8-done` |
| **S9** | Wire `getSessionTokenForZone` + `getPlaceForZone` con db-with-verifier + adapt 3 callers | 4 (get-place-for-zone + 2 pages settings + test) | TBD | `baseline/feature-c-s9-done` |
| **S10** | Silent SSO trigger en settings + `<SsoFallbackPanel>` branch | 3 (2 pages settings + test) | TBD | `baseline/feature-c-s10-done` |
| **S11** | Smoke E2E + docs close + write-back plan-sesiones + push autorizado | 3 docs (spec smoke section + ADR banner + este file) | TBD | `baseline/feature-c-s11-done` + `baseline/feature-c-done` (post-push) |

Detalle ejecutivo por sesión (justificación, parallel agents, locked files, pre/post-commit checklist, LOC tracking): `/Users/maxi/.claude/plans/wise-greeting-mccarthy.md`.

## Comando de rollback total documentado

```bash
# Rollback total a Feature B (estado pre-Feature-C):
git reset --hard baseline/pre-feature-c

# Migration 0011 aplicada en branch Neon test/preview: DROP manual si rollback < S1:
#   psql "$DATABASE_URL" -c "REVOKE EXECUTE ON FUNCTION app.consume_sso_jti(text, timestamptz) FROM \"app_system\";"
#   psql "$DATABASE_URL" -c "DROP FUNCTION IF EXISTS app.consume_sso_jti(text, timestamptz);"
#   psql "$DATABASE_URL" -c "DROP TABLE IF EXISTS app.sso_jti_used;"

# Rollback a sesión previa (granular):
git reset --hard baseline/feature-c-s<N-1>-done
```

**Pre-condición rollback**: si la migration 0011 ya fue aplicada a la branch Neon afectada, el DROP manual es necesario antes del próximo deploy (Drizzle journal no soporta `down` automático).

**Push reversal**: si el push de S11 ya ocurrió pero smoke production detecta regression, rollback = `git revert <commit-sha>` + nuevo push (NO `git reset` en remote main). Decisión por turno con user.

## Baseline tags evolucionados

```
baseline/pre-feature-c             = d20ab00   (S-1 save point pre-Feature-C, completado 2026-05-22)
baseline/feature-c-s0-done         = TBD       (S0 — este commit, docs canónicos + ADR-0032)
baseline/feature-c-s1-done         = TBD       (S1 — migration 0011 + RLS tests)
baseline/feature-c-s2-done         = TBD       (S2 — sso-keys + sso-ticket helpers puros)
baseline/feature-c-s3-done         = TBD       (S3 — sso-state cookie + returnTo)
baseline/feature-c-s4-done         = TBD       (S4 — sso-session + db-with-verifier)
baseline/feature-c-s5-done         = TBD       (S5 — /api/auth/sso-jwks endpoint apex)
baseline/feature-c-s6-done         = TBD       (S6 — i18n × 6 + <SsoFallbackPanel>)
baseline/feature-c-s7-done         = TBD       (S7 — /api/auth/sso-issue handler apex)
baseline/feature-c-s8-done         = TBD       (S8 — sso-init + sso-redeem + sso-jti-consume)
baseline/feature-c-s9-done         = TBD       (S9 — wire getSessionTokenForZone + 3 callers)
baseline/feature-c-s10-done        = TBD       (S10 — silent SSO trigger en settings)
baseline/feature-c-s11-done        = TBD       (S11 — docs close + smoke pre-push)
baseline/feature-c-done            = TBD       (post-push autorizado + smoke production verde)
```

## Write-back S11 (placeholder)

Al cierre de S11 este archivo se actualiza con:

- Commit SHAs reales de cada sesión (resolver desde `git log --oneline baseline/pre-feature-c..HEAD`).
- Confirmación de tags presentes (`git tag --list 'baseline/feature-c-*'`).
- Smoke production resultados (referencia a `spec.md` §"Smoke ejecutado").
- Deploy ID Vercel + timestamp READY.
- Cualquier desviación del plan ejecutivo original (con razón documentada).

## Pointers

- **ADR canónica V1 de Feature C**: [`../../decisions/0032-custom-domain-sso-signed-ticket.md`](../../decisions/0032-custom-domain-sso-signed-ticket.md).
- **Spec del feature**: [`./spec.md`](./spec.md).
- **Tests checklist**: [`./tests.md`](./tests.md).
- **Plan ejecutivo completo (single source of truth)**: `/Users/maxi/.claude/plans/wise-greeting-mccarthy.md`.
- **Save point pre-Feature-C (= Feature B done)**: tag `baseline/pre-feature-c` (commit `d20ab00`).
- **Precedente Feature B plan**: [`../custom-domain-routing/plan-sesiones.md`](../custom-domain-routing/plan-sesiones.md).
