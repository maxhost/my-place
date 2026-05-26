# `invitations` slice V1.1 (Accept Flow) — Tests TDD checklist

> _Checklist TDD por sesión S1-S6 de Feature E V1.1. Canon CLAUDE.md: tests primero, verificar que fallan, implementar, verificar que pasan. Sin excepciones en el core. Spec en [`./spec.md`](./spec.md). Plan operativo en [`./plan-sesiones.md`](./plan-sesiones.md). ADR canónica en [`../../decisions/0044-invite-accept-flow.md`](../../decisions/0044-invite-accept-flow.md)._

## Canon "Tests seam-split: pure helpers vitest, async integrators typecheck+smoke"

Establecido en Feature C S11.2 (ADR-0034 §"Invariantes garantizadas" #4) + reforzado en Feature E S7/S8:

- **PURE helpers / functions / maps / schemas**: vitest directo. Sin mocks complejos. Tests rápidos, deterministas, completos.
- **Async integrators** (Server Actions que cruzan `next/headers` + DB + SDK): NO se unit-testean. Se validan por:
  1. `pnpm typecheck` (verifica contract types).
  2. `pnpm build` (verifica que Next.js compila el flow).
  3. Smoke E2E manual contra branch ephemeral o prod (S6).
- **Client Components (RTL)**: render + interaction events + state machine transitions. NO se mockea el action — se inyecta como prop y se valida que se llamó con los args correctos.

Esta convención evita tests frágiles que mockean SDK (Neon Auth) o DB (Drizzle/pg) con setups que se rompen en upgrades y no aportan confidence real sobre el integrator.

## S1 — `acceptInvitationAction` + map + schema

### `src/features/invitations/actions/_lib/__tests__/map-accept-error.test.ts` (nuevo)

8 tests unit (1 por SQLSTATE canónico de `app.accept_invitation` + 1 fallback):

| # | Input (error object) | Expected output |
|---|---|---|
| 1 | NeonDbError code `28000` | `{ kind: 'unauthenticated' }` |
| 2 | NeonDbError code `P0002` | `{ kind: 'app_user_missing' }` |
| 3 | NeonDbError code `P0005` | `{ kind: 'not_found' }` |
| 4 | NeonDbError code `P0006` | `{ kind: 'expired' }` |
| 5 | NeonDbError code `P0007` | `{ kind: 'already_used' }` |
| 6 | NeonDbError code `P0008` | `{ kind: 'email_mismatch' }` |
| 7 | NeonDbError code `P0009` | `{ kind: 'place_full' }` |
| 8 | NeonDbError code `XX000` (arbitrary unknown) | `{ kind: 'unknown' }` |

**Estructura**: same shape que `map-invite-error.test.ts` + `map-revoke-error.test.ts` (precedente V1).

### `src/features/invitations/actions/_lib/__tests__/schemas.test.ts` (extender +15 LOC)

3 tests unit para el nuevo `acceptInvitationSchema`:

| # | Input | Expected |
|---|---|---|
| 1 | `{ token: 'a'.repeat(64) }` (valid hex 64-char) | parse OK |
| 2 | `{ token: 'abc' }` (token < 32 chars) | parse error min length |
| 3 | `{ token: 'a'.repeat(257) }` (token > 256 chars) | parse error max length |

### `accept-invitation.ts` (Server Action)

NO se unit-testea (canon seam-split). Validación:
- `pnpm typecheck` clean.
- Integrator validado en S3 (RTL del panel inyecta el action) + S6 (smoke E2E).

### Coverage S1

- `map-accept-error.ts`: 100% branches (8 SQLSTATEs + fallback).
- `schemas.ts` `acceptInvitationSchema`: min/max bounds + happy path.
- `types.ts` `AcceptInvitationError`: typecheck cubre el discriminated union completeness.

## S2 — `validateLoginReturnTo` extension

### `src/shared/lib/sso/__tests__/validate-login-return-to.test.ts` (extender +90 LOC)

6 nuevos describes para el pattern `/invite/[token]`:

| # | Input | Expected |
|---|---|---|
| 1 | `'/invite/a1b2c3d4e5f6...{64 hex}'` (valid relative) | accepted |
| 2 | `'/invite/zzz...not-hex'` | rejected |
| 3 | `'/invite/abc'` (token < 32 chars) | rejected |
| 4 | `'/invite/a' + 'b'.repeat(256)` (token > 256 chars) | rejected |
| 5 | `'https://mi-place.place.community/invite/a1b2...{valid}'` (absolute same-registrable) | accepted |
| 6 | `'https://attacker.com/invite/a1b2...{valid}'` (absolute cross-registrable) | rejected |

**Regression** (verificar 0 cambios en tests V1):
- Allowlist `/api/auth/sso-issue` + `/api/auth/sso-init` siguen verde.
- Relative paths con `/` start, sin `//`, sin scheme siguen verde.
- Open-redirect vectors (`//attacker.com`, `\\attacker.com`, etc.) siguen rejected.
- Absolute URLs cross-registrable siguen rejected.

### Coverage S2

- Pattern `/invite/[token]` 100% branches (hex valid/invalid + length min/max + same/cross-registrable).
- Regression 0 changes en tests existentes (gate de no romper ADR-0033 retroactivamente).

## S3 — Page + Client panel + tampering helper + RTL

### `src/app/(app)/place/[placeSlug]/invite/[token]/_components/__tests__/invite-acceptance-panel.test.tsx` (nuevo)

8 escenarios RTL:

| # | Setup (props) | Action | Expected |
|---|---|---|---|
| 1 | currentUserEmail = undefined (unauth) | render | header place name visible, email invitado visible, 2 CTAs (login + signup) visibles con href `/login?returnTo=...` y `/crear?returnTo=...` con returnTo absoluto al invite URL |
| 2 | currentUserEmail matches inviteeEmail | render | botón "Aceptar invitación a {placeName}" visible + "No, gracias" link visible |
| 3 | currentUserEmail differs from inviteeEmail | render | panel error email mismatch visible + CTA logout con returnTo |
| 4 | currentUserEmail matches | click "Aceptar" | `acceptInvitationAction` invoked with `{ token, placeSlug }` |
| 5 | action resolves `{ status: 'success', placeSlug }` | click "Aceptar" → wait | window.location.href = `https://{placeSlug}.place.community/` (use jsdom + spy) |
| 6 | action resolves `{ status: 'error', error: { kind: 'expired' } }` | click "Aceptar" → wait | panel error expired visible con copy correcto |
| 7 | action resolves `{ status: 'error', error: { kind: 'already_used' } }` | click "Aceptar" → wait | panel error already_used visible |
| 8 | action resolves `{ status: 'error', error: { kind: 'place_full' } }` | click "Aceptar" → wait | panel error place_full visible |

**Inyección del action**: el panel recibe `acceptInvitationAction` como prop (no import directo). RTL inyecta un `vi.fn()` con `.mockResolvedValue(...)` por escenario. Esto evita mockear Next.js Server Action runtime.

**i18n en tests**: usar labels English hardcodeadas en los tests V1.1 S3 (placeholder pre-S4). S4 reemplaza placeholders pero los tests siguen pasando porque los strings son inyectados como labels prop.

### `_lib/get-invitation-meta-by-token.ts` (helper)

NO se unit-testea directamente (cruza DB call). Se valida vía:
- `pnpm typecheck`.
- RTL del panel acepta los outputs como union types.
- Smoke S6 cubre paths real DB.

**Alternativa considerada (defer V1.2+)**: extraer la lógica de comparison `place_slug ↔ placeSlug` a un sub-helper PURE testable. V1.1 lo deja inline porque es 1 línea trivial.

### `page.tsx` (RSC)

NO se unit-testea (cruza next/headers + DB). Se valida vía:
- `pnpm typecheck`.
- `pnpm build` confirma route generada (`Route ƒ /place/[placeSlug]/invite/[token]` en output).
- Smoke S6.

### Coverage S3

- Panel: 8 escenarios cubren los 3 estados render + 4 error mappings + 1 success path.
- RTL no-mockea SDK ni DB.
- Page + helper validados por typecheck + smoke.

## S4 — i18n `placeInvitation` × 6 locales

### No hay tests TDD (i18n no testeable en sentido tradicional)

Validation gates:
- `pnpm check-translations`: parity entre `es.json` (SoT) y los 5 non-es. 0 keys missing.
- `pnpm typecheck`: i18n types generados (si el proyecto usa typed t() — TBD según `messages-loader.ts`).
- RTL S3: tests pasan post-S4 porque labels inyectadas son ahora reales (no placeholders).
- Manual S6: smoke step 9 (switch locale → labels traducidos).

### Verificación post-S4

```sh
# Parity check
pnpm check-translations

# JSON validation
for locale in es en fr pt de it; do
  node -e "JSON.parse(require('fs').readFileSync('src/i18n/messages/${locale}.json'))"
done

# Keys parity per file
for locale in en fr pt de it; do
  diff <(jq -r 'paths(scalars) | join(".")' src/i18n/messages/es.json | sort) \
       <(jq -r 'paths(scalars) | join(".")' src/i18n/messages/${locale}.json | sort) | head
done
```

## S5 — `/crear` honra returnTo post-signup

### Tests TDD `src/app/[locale]/crear/__tests__/page.test.tsx` (nuevo o extender)

3-5 tests del path returnTo (scope exacto depende del shape actual de `/crear` — research en S5):

| # | Input (searchParams) | Action | Expected |
|---|---|---|---|
| 1 | `?returnTo=/invite/{valid hex}` | post-signup callback | redirect to that path |
| 2 | `?returnTo=https://mi-place.place.community/invite/{valid}` | post-signup callback | redirect to absolute URL |
| 3 | `?returnTo=https://attacker.com/invite/{valid}` | post-signup callback | redirect to Hub (fallback) |
| 4 | `?returnTo=javascript:alert(1)` | post-signup callback | redirect to Hub (fallback) |
| 5 | no returnTo param | post-signup callback | redirect to Hub (backwards-compat) |

### Coverage S5

- 5 paths: 2 valid + 3 invalid (fallback to Hub).
- 0 regression en behavior existente (sin returnTo → Hub).

## S6 — Smoke E2E manual + write-back

### Verificación manual (no en CI)

10 steps detallados en `spec.md` §"Smoke verification":

1. Setup: token válido en Neon prod.
2. Preview unauth.
3. Login round-trip.
4. Accept submit.
5. Re-accept attempt (404).
6. Email mismatch path.
7. Signup round-trip.
8. Cross-place tampering check.
9. i18n smoke (en).
10. Place full P0009 (opcional).

### Pre-push checklist (gating push autorizado)

```sh
# 1. Working tree clean
git status --short
# Empty output expected.

# 2. Typecheck + lint
pnpm typecheck
pnpm lint

# 3. Suite full verde
pnpm test
# Expected: 1015+ tests pass (V1 baseline) + ~30 new tests (V1.1 S1+S2+S3+S5)

# 4. Build OK
pnpm build
# Expected: route /place/[placeSlug]/invite/[token] in output

# 5. LOC caps respected
wc -l src/features/invitations/**/*.ts | tail -1
# Expected: total ≤1800

# 6. ESLint slice boundaries (ADR-0039)
pnpm lint:slice-boundaries  # or pnpm lint with the rule
# Expected: clean
```

Si todos verde → autorización de push (canon: explicit "push" del user en S6).

### Post-push verification (Vercel)

- `mcp__plugin_vercel_vercel__list_deployments` → newest deploy con commit V1.1 final.
- `mcp__plugin_vercel_vercel__get_deployment` → `state: READY`.
- `mcp__plugin_vercel_vercel__get_deployment_build_logs` → migrations check `maybe-migrate.mjs` skipped (no migration nueva V1.1) + build success.
- Smoke manual steps 2-10 contra el deploy real.

## Coverage acumulado V1.1

Post-V1.1 close:

| Sesión | New tests | New describes | Cumulative |
|---|---|---|---|
| S1 | `map-accept-error.test.ts` (8) + `schemas.test.ts` (+3) | 9 + 3 = 12 | 12 |
| S2 | `validate-login-return-to.test.ts` (+6) | +6 | 18 |
| S3 | `invite-acceptance-panel.test.tsx` (8) | +8 | 26 |
| S4 | (i18n parity, no tests) | 0 | 26 |
| S5 | `crear/__tests__/page.test.tsx` (5) | +5 | 31 |
| S6 | (smoke manual + write-back) | 0 | 31 |

**Total V1.1**: ~31 nuevos tests sobre la base V1 (1015 tests). Suite final esperada: ~1046 tests.

## Lo que NO probamos (decisión)

- **Server Action `acceptInvitationAction`**: validado por typecheck + smoke S6 (canon seam-split — el integrador async cruza `next/headers` + DB).
- **Page `/invite/[token]` RSC**: validado por typecheck + `pnpm build` + smoke S6.
- **Helper `get-invitation-meta-by-token.ts`**: validado por typecheck + RTL S3 acepta outputs como union + smoke S6.
- **Migration 0003 DEFINER functions**: ya validadas con tests SQL pre-V1.1 (Feature E V1 + slot original). V1.1 no las modifica.
- **Vercel deploy + DNS routing**: validado por smoke S6 paths 2-3 (open URL → page renderiza, no 404).
- **i18n parity**: validado por `pnpm check-translations`. Strings individuales NO se testean (no hay correctness DB-validable).

## Pointers

- **ADR canónica V1.1**: [`../../decisions/0044-invite-accept-flow.md`](../../decisions/0044-invite-accept-flow.md).
- **Spec del slice**: [`./spec.md`](./spec.md).
- **Plan de sesiones operativo**: [`./plan-sesiones.md`](./plan-sesiones.md).
- **Precedente seam-split**: ADR-0034 §"Invariantes garantizadas" #4.
- **Precedente TDD canon**: CLAUDE.md §"Durante la implementación".
- **DEFINER consumidas** (sin migration nueva): `src/db/migrations/0003_accept_invitation_fn.sql`.
