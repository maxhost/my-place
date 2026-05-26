# `invitations` slice V1.1 (Accept Flow) — Plan de sesiones

> _Plan operativo S0-S6 para Feature E V1.1. Status canónico abajo. Decisión arquitectónica en [ADR-0044](../../decisions/0044-invite-accept-flow.md). Spec en [`./spec.md`](./spec.md). Tests TDD en [`./tests.md`](./tests.md). Save point pre-V1.1: `baseline/pre-feature-e-invite-accept` = `7ab4d26` (Feature E V1 cerrada + deployada prod)._

## Status

| Sesión | Status | Tag | Commit | Notas |
|---|---|---|---|---|
| S0 — docs setup | en curso | — | — | ADR-0044 + spec + plan + tests + rebaseline members spec §Smoke step 3 |
| S1 — acceptInvitationAction + tests | pending | `baseline/feature-e-invite-accept-s1-done` | — | TDD: schemas + map-error + action |
| S2 — validateLoginReturnTo extension | pending | `baseline/feature-e-invite-accept-s2-done` | — | TDD: 6 nuevos describes |
| S3 — page + Client panel + RTL + helper | pending | `baseline/feature-e-invite-accept-s3-done` | — | RSC + Client + tampering check |
| S4 — i18n placeInvitation × 6 locales | pending | `baseline/feature-e-invite-accept-s4-done` | — | es first, 5 agentes paralelos |
| S5 — /crear returnTo support | pending | `baseline/feature-e-invite-accept-s5-done` | — | extension /crear post-signup |
| S6 — smoke E2E + write-back + push | pending | `baseline/feature-e-invite-accept-done` | — | push autorizado por turno |

**Guardrails canónicos** (recordatorio del user pre-S0, aplican a todas las sesiones):

- Production grade. No quick fix ni parches.
- LOC estrictos: archivo ≤300 · función ≤60 · slice ≤1800 (bump V1.1 vs default 1500 — ADR-0044 §D6).
- Agentes en paralelo SOLO si tocan files ortogonales. Si comparten un file, yo orquesto serialmente.
- Agentes NUNCA modifican shared files que otros agentes consumen — yo creo los shared antes de spawn los consumers.
- Pre-sesión: `git status --short` clean + typecheck + suite verde.
- Post-sesión: commit canónico + tag + push diferido a S6.
- Compact pre-sesión (canon del user: ventana limpia por sesión).
- Save point activo: `baseline/pre-feature-e-invite-accept` = `7ab4d26`.

## Sesiones

### S0 — Docs setup (en curso, sin código)

**Objetivo**: dejar canon escrita antes de tocar código. Cierra el gap del Feature E V1 spec.md §Smoke step 3 que apuntaba erróneamente a "flow de Feature C".

**Output**:
- `docs/decisions/0044-invite-accept-flow.md` — ADR canónica V1.1 (~430 LOC).
- `docs/features/invitations/spec.md` — primer spec del slice (no existía pre-V1.1).
- `docs/features/invitations/plan-sesiones.md` — este archivo.
- `docs/features/invitations/tests.md` — TDD checklist por sesión.
- `docs/features/members/spec.md` — write-back §Smoke step 3 (corregido + pointer a invitations/spec.md).
- `docs/decisions/README.md` — entry ADR-0044.

**Verificación pre-commit**:
- Cap LOC docs: cada uno ≤300 LOC efectivos (ADR puede excepcionarse — pero apuntamos ≤450 con secciones bien marcadas).
- Cross-refs internos coherentes: cada `[[link]]` o `[path](rel)` resuelve.
- Sin código tocado: `git diff --stat src/` empty.
- Typecheck + suite verde (defensa: el branch debe permanecer healthy).

**Commit**:
```
docs(invitations): ADR-0044 + slice spec/plan/tests + rebaseline members §Smoke (V1.1 S0)
```

**Tag**: `baseline/feature-e-invite-accept-s0-done`.

**Pre-sesión S1**: compact + sanity check (`pnpm typecheck && pnpm test`).

---

### S1 — `acceptInvitationAction` + tests

**Scope**: Server Action wrapper sobre `app.accept_invitation` (DEFINER ya en migration 0003 prod). Pure code, sin UI, sin i18n.

**Files**:
- `src/features/invitations/actions/accept-invitation.ts` [N: ~55 LOC] — Server Action que llama `getAuthenticatedDbForRequest` (ADR-0034 canon) + `await tx.execute(sql\`SELECT app.accept_invitation(${token})\`)` + mapea error → `AcceptInvitationError` vía `mapAcceptError`.
- `src/features/invitations/actions/_lib/map-accept-error.ts` [N: ~55 LOC] — pure function `mapAcceptError(error: unknown): AcceptInvitationError` con 7 SQLSTATEs canónicos (28000/P0002/P0005/P0006/P0007/P0008/P0009) + fallback `unknown`.
- `src/features/invitations/actions/_lib/__tests__/map-accept-error.test.ts` [N: ~30 LOC] — 8 unit tests (1 por SQLSTATE + 1 fallback).
- `src/features/invitations/actions/_lib/schemas.ts` [M: +25 LOC] — agrega `acceptInvitationSchema` (token: string min(32) max(256) + placeSlug: string optional) + `AcceptInvitationInput` type.
- `src/features/invitations/actions/_lib/__tests__/schemas.test.ts` [M: +15 LOC] — 3 unit tests para el nuevo schema.
- `src/features/invitations/types.ts` [M: +15 LOC] — agrega `AcceptInvitationError` discriminated union (8 variantes).
- `src/features/invitations/public.ts` [M: +10 LOC] — re-export `acceptInvitationAction`, `AcceptInvitationResult`, `AcceptInvitationError`, `AcceptInvitationInput`.

**Files NO touched**: ui/, queries/, page consumers (S3), validateLoginReturnTo (S2), `/crear` (S5), i18n (S4).

**LOC budget**: ~280 LOC neto al slice. Slice cierra ~1777 LOC (cap 1800).

**Verificación pre-commit**:
- `pnpm typecheck`: clean.
- `pnpm test`: nuevos tests verde, suite total verde (1015+ tests).
- `wc -l src/features/invitations/**/*.ts` total ≤1800.
- `find src/features/invitations -name "*.ts" -exec wc -l {} \; | sort -nr | head -5` — confirmar ningún file > 300.

**TDD obligatorio** (canon CLAUDE.md):
1. Escribir `map-accept-error.test.ts` con 8 tests fallando.
2. Implementar `map-accept-error.ts` → tests pasan.
3. Escribir tests nuevos en `schemas.test.ts` → fallando.
4. Implementar `acceptInvitationSchema` → tests pasan.
5. Action: `accept-invitation.ts` se valida por typecheck + smoke E2E S6 (NO se unit-testea — canon "actions seam-split: pure helpers tested, async integrator validated via typecheck+smoke", precedente Feature E S7/S8 + ADR-0034 §"Invariantes garantizadas" #4).

**Agentes paralelos**: NO — S1 toca files compartidos (`types.ts`, `public.ts`, `schemas.ts`) que serían escritos por múltiples agentes en conflicto. Yo escribo serialmente.

**Commit**:
```
feat(invitations): acceptInvitationAction + map-accept-error + acceptInvitationSchema (V1.1 S1)
```

**Tag**: `baseline/feature-e-invite-accept-s1-done`.

**Rollback S1**: `git reset --hard baseline/feature-e-invite-accept-s0-done`.

---

### S2 — `validateLoginReturnTo` extension

**Scope**: extender allowlist canónico ADR-0033 para aceptar pattern `/invite/[token]`. Pure code, sin UI.

**Files**:
- `src/shared/lib/sso/validate-login-return-to.ts` [M: +25 LOC] — agrega pattern match `/^\/invite\/[a-f0-9]{32,256}$/` al validator de relative paths + acepta absolute URLs same-registrable-domain con ese mismo path. Sin tocar el allowlist absolute existente (`/api/auth/sso-issue`, `/api/auth/sso-init`).
- `src/shared/lib/sso/__tests__/validate-login-return-to.test.ts` [M: +90 LOC] — 6 nuevos describes:
  1. Accepts relative `/invite/{hex32-256}` con token válido.
  2. Rejects relative `/invite/{non-hex}` (caracteres inválidos en token).
  3. Rejects relative `/invite/{token-too-short}` (<32 chars).
  4. Rejects relative `/invite/{token-too-long}` (>256 chars).
  5. Accepts absolute URL same-registrable-domain con path `/invite/{token}` válido.
  6. Rejects absolute URL distinto registrable-domain con path `/invite/{token}`.

**Files NO touched**: action S1 (no consume el validator), page S3, /crear S5.

**LOC budget**: +25 LOC al validator (87 → 112). +90 LOC al test (queda dentro del 300).

**Verificación pre-commit**:
- `pnpm typecheck`: clean.
- `pnpm test src/shared/lib/sso/`: 6 nuevos describes verde + describes V1 sin regression.
- `pnpm test`: suite total verde.
- `wc -l src/shared/lib/sso/validate-login-return-to.ts`: ≤300.

**TDD obligatorio**:
1. Escribir 6 describes con tests fallando.
2. Extender el validator → tests pasan.
3. Verificar 0 regression en tests V1 existentes (open-redirect rejects, etc.).

**Agentes paralelos**: NO — toca un file aislado, pero serial es trivial.

**Commit**:
```
feat(sso): validateLoginReturnTo acepta /invite/[token] (V1.1 S2 — extiende ADR-0033 allowlist)
```

**Tag**: `baseline/feature-e-invite-accept-s2-done`.

**Rollback S2**: `git reset --hard baseline/feature-e-invite-accept-s1-done`.

---

### S3 — Page `/invite/[token]` + Client panel + RTL + tampering helper

**Scope**: page consumer del token + Client component con consent + tests RTL. Vive en `src/app/(app)/place/[placeSlug]/invite/[token]/` (zona-place dentro del proxy).

**Files**:
- `src/app/(app)/place/[placeSlug]/invite/[token]/page.tsx` [N: ~190 LOC] — RSC. Llama `getInvitationMetaByToken(token, placeSlug)` (helper PURE/integrator de S3). Si retorna `{ kind: 'not-found' }` → `notFound()` (Next.js 404). Si `{ kind: 'cross-place-tampering' }` → `notFound()` (no doxx). Si `{ kind: 'ok', placeName, inviteeEmail }`: detect sesión apex via `getSessionJwt()` + compose props del Client panel. Reusa AppShell zona-place (ADR-0023).
- `src/app/(app)/place/[placeSlug]/invite/[token]/_components/invite-acceptance-panel.tsx` [N: ~240 LOC] — Client Component. Recibe `{ token, placeSlug, placeName, inviteeEmail, currentUserEmail?, locale, labels, acceptInvitationAction }`. State machine: `idle | accepting | success | error(<AcceptInvitationError>)`. Renderiza CU-Accept-2/3 según email match. Botón "Aceptar" → form submit → action. Panels de error mappeados a copys i18n.
- `src/app/(app)/place/[placeSlug]/invite/[token]/_lib/get-invitation-meta-by-token.ts` [N: ~75 LOC] — Helper async. Llama `app.invitation_preview` (sin auth) + compara `place_slug` ↔ `placeSlug` del URL. Discriminated union output. NO requiere claim.
- `src/app/(app)/place/[placeSlug]/invite/[token]/_components/__tests__/invite-acceptance-panel.test.tsx` [N: ~160 LOC] — RTL. ~8 escenarios:
  1. Render preview unauth (sin currentUserEmail) → 2 CTAs visibles (login + signup) con href returnTo correcto.
  2. Render auth same-email → botón "Aceptar invitación a {placeName}" + CTA "No, gracias".
  3. Render auth email-mismatch → panel error + CTA logout con returnTo.
  4. Click "Aceptar" → action invoked con `{ token, placeSlug }`.
  5. Success → redirect a Hub.
  6. Error `expired` → panel "Esta invitación venció".
  7. Error `already_used` → panel "Ya se usó".
  8. Error `place_full` → panel cupo alcanzado.

**Files NO touched**: action S1, validator S2, /crear S5, i18n S4 (S3 usa placeholders inline temporales que S4 reemplaza).

**LOC budget**: page 190 ≤ 300. Panel 240 ≤ 300. Helper 75 ≤ 300. RTL 160 ≤ 300. Total nuevo: ~590 LOC en app/ (fuera del slice — no cuenta al cap 1800).

**Verificación pre-commit**:
- `pnpm typecheck`: clean.
- `pnpm test src/app/(app)/place/[placeSlug]/invite/`: 8 tests verde.
- `pnpm test`: suite total verde.
- `wc -l src/app/(app)/place/[placeSlug]/invite/**/*.{ts,tsx}`: ningún file > 300.
- Manual: `pnpm build` → `Route ƒ /place/[placeSlug]/invite/[token]` aparece en el output (deploy-time check).

**TDD obligatorio**:
1. Escribir 8 escenarios RTL fallando.
2. Implementar `get-invitation-meta-by-token.ts` (PURE testable si abstraemos el client DB; sino integrator validado por typecheck+smoke).
3. Implementar `invite-acceptance-panel.tsx` → tests RTL pasan.
4. Implementar `page.tsx` → se valida por typecheck + smoke S6.

**Agentes paralelos**: SI — 2 agentes pueden trabajar en paralelo si yo creo primero el helper `get-invitation-meta-by-token.ts` + dejo los contract types definidos en S1 (`AcceptInvitationError`):
- Agente A: panel + RTL (`invite-acceptance-panel.tsx` + test).
- Agente B: page (`page.tsx`) — consume el panel y el helper.

Yo creo el helper (Agente B no toca el helper, sólo lo consume). Si los agentes terminan simultáneamente, integro yo serialmente (page importa panel — Agente B necesita el barrel de panel de Agente A).

**Commit**:
```
feat(invitations): page /invite/[token] + InviteAcceptancePanel + tampering check helper (V1.1 S3)
```

**Tag**: `baseline/feature-e-invite-accept-s3-done`.

**Rollback S3**: `git reset --hard baseline/feature-e-invite-accept-s2-done`.

---

### S4 — i18n `placeInvitation` × 6 locales

**Scope**: nuevo namespace en los 6 JSON locales + extensión `messages-loader.ts` + re-baseline `check-translations`.

**Keys requeridas** (~13 keys del namespace `placeInvitation`):

```json
{
  "placeInvitation": {
    "header": "Invitación a {placeName}",
    "previewEmail": "Esta invitación es para {email}",
    "acceptButton": "Aceptar invitación a {placeName}",
    "declineLink": "No, gracias",
    "ctaLogin": "Iniciar sesión",
    "ctaSignup": "Crear cuenta",
    "emailMismatchTitle": "Email no coincide",
    "emailMismatchBody": "Esta invitación es para {invEmail}. Estás logueado como {currentEmail}.",
    "emailMismatchLogoutCta": "Cerrar sesión y entrar como {invEmail}",
    "errorExpired": "Esta invitación venció. Pedí una nueva a quien te invitó.",
    "errorAlreadyUsed": "Esta invitación ya se usó.",
    "errorPlaceFull": "Este lugar alcanzó su cupo máximo (150 miembros). Hablá con quien te invitó.",
    "errorUnknown": "Algo salió mal. Intentá de nuevo o pedí una nueva invitación."
  }
}
```

**Files**:
- `src/i18n/messages/es.json` [M: +13 keys] — source-of-truth (yo escribo primero).
- `src/i18n/messages/en.json` [M: +13 keys] — Agente A.
- `src/i18n/messages/fr.json` [M: +13 keys] — Agente B.
- `src/i18n/messages/pt.json` [M: +13 keys] — Agente C.
- `src/i18n/messages/de.json` [M: +13 keys] — Agente D.
- `src/i18n/messages/it.json` [M: +13 keys] — Agente E.
- `src/i18n/messages-loader.ts` [M: +1 namespace en el merge tree] — yo.
- `src/app/(app)/place/[placeSlug]/invite/[token]/_components/invite-acceptance-panel.tsx` [M: replace placeholders inline → t() calls].

**Agentes paralelos**: SI — 5 agentes en paralelo (uno por locale non-es). Cada uno trabaja sobre su único JSON, 0 colisiones. Yo escribo `es.json` primero como SoT + entrego los strings a los agentes para que traduzcan (no inventen).

**LOC budget**: ~13 keys × 6 = 78 entries. JSONs crecen ~80 LOC cada uno máximo.

**Verificación pre-commit**:
- `pnpm check-translations`: confirma parity entre `defaultLocale.json` (es) y los 5 non-es para el namespace `placeInvitation`.
- `pnpm typecheck`: clean.
- `pnpm test`: suite total verde + RTL tests de S3 ahora con i18n real (no placeholders).
- Browser manual: switch `place.default_locale` a `en` → page muestra labels inglés. (S6 hace el smoke completo).

**TDD parcial**: i18n no es testeable en el sentido tradicional. `check-translations` actúa como gate de parity.

**Orquestación de agentes**:
1. Yo escribo `es.json` con las 13 keys finales.
2. Spawn 5 agentes paralelos, cada uno con prompt: "Traducí estas 13 keys ES → {locale}. Mantené placeholders `{xxx}`. Mantené tono cercano/voseo donde corresponda."
3. Cuando los 5 terminan, yo updates `messages-loader.ts` + reemplazo placeholders en panel.

**Commit**:
```
feat(i18n): placeInvitation namespace × 6 locales (V1.1 S4)
```

**Tag**: `baseline/feature-e-invite-accept-s4-done`.

**Rollback S4**: `git reset --hard baseline/feature-e-invite-accept-s3-done`.

---

### S5 — `/crear` honra `returnTo` post-signup

**Scope**: extender `src/app/[locale]/crear/page.tsx` para que post-signup haga redirect a `returnTo` (validado vía `validateLoginReturnTo`) en lugar del Hub canónico hardcoded.

**Files**:
- `src/app/[locale]/crear/page.tsx` [M: ~80 LOC + ~40 LOC modificadas] — parse `?returnTo=` del searchParams + validate via `validateLoginReturnTo` + propagar al handler post-signup. Si valid → redirect a returnTo; si invalid o ausente → redirect al Hub canónico (backwards-compat).

**Files potencialmente extendidos** (TBD durante S5 según implementación actual de `/crear`):
- Si `/crear` invoca un handler/Server Action de signup, extender el handler para aceptar `returnTo` como param y devolver el redirect target.
- Si `/crear` es Client Component con form submit a un endpoint API → extender el endpoint.

**Pre-S5 research** (primera tarea de S5): leer `src/app/[locale]/crear/page.tsx` actual + `src/features/access/` o equivalente para entender el flow signup actual. Detect si hay seam de extensión natural o si requiere refactor mayor (en cuyo caso bumpear scope o defer).

**Verificación pre-commit**:
- `pnpm typecheck`: clean.
- `pnpm test`: tests existentes `/crear` verde + nuevos tests post-signup-redirect.
- Tests nuevos: validar que returnTo aceptado pasa al redirect target, returnTo rechazado fallback a Hub.
- Manual: `pnpm dev` → abrir `/crear?returnTo=/invite/{token}` → signup → verificar redirect al invite URL.

**LOC budget**: si page actual <250 LOC, +80 lo deja <330 → mover lógica a `_lib/handle-signup-return-to.ts` para mantener page ≤300.

**TDD obligatorio**: tests del path returnTo + tests del fallback.

**Agentes paralelos**: NO — `/crear` es un file central, cambios deben ser serial.

**Commit**:
```
feat(access): /crear honra returnTo post-signup (V1.1 S5 — extiende flow apex)
```

**Tag**: `baseline/feature-e-invite-accept-s5-done`.

**Rollback S5**: `git reset --hard baseline/feature-e-invite-accept-s4-done`.

---

### S6 — Smoke E2E + write-back + push autorizado

**Scope**: validar end-to-end contra producción + write-back evidencia en spec + push autorizado por turno.

**Pre-S6**:
- Tag `baseline/feature-e-invite-accept-s5-done` activo.
- Suite verde + typecheck + `pnpm build` exitoso.
- Reusar el token existente en prod (`49e100fea6344c3ab84aa33893751eb41a038aae88ed4cecacfc3c0cba6154a6`) si sigue válido, sino crear nuevo via `/settings/members` modal.

**Push autorizado** (canon user — push diferido a S6, autorización explícita requerida):
- `git push maxhost main` solo después de explicit "push" del user en S6.
- Deploy Vercel auto se dispara post-push.
- Esperar deploy READY (Vercel MCP `get_deployment` poll).

**Smoke E2E** (10 steps, ver `spec.md` §Smoke verification para detalle):
1. Setup: verificar token válido en Neon prod.
2. Preview unauth.
3. Login round-trip.
4. Accept submit.
5. Re-accept attempt (404).
6. Email mismatch path.
7. Signup round-trip (email nuevo).
8. Cross-place tampering check.
9. i18n smoke (switch locale a en).
10. Place full P0009 (opcional — skipear si no hay setup).

**Write-back**:
- `docs/features/invitations/spec.md` §"Smoke verification" — agregar sub-sección "Smoke ejecutado (2026-XX-XX, S6 close)" con tabla resultados por step (verde/rojo) + deploy id Vercel.
- `docs/features/invitations/plan-sesiones.md` §"Status" — fill row S0-S6 con SHAs reales + tag references.
- `docs/features/members/spec.md` §"Smoke verification" step 3 — confirmar el rebaseline de S0 sigue válido + pointer a smoke evidence V1.1.

**Commit pre-write-back** (si suite + smoke verde):
```
docs(invitations): write-back smoke E2E evidence + plan-sesiones Status (V1.1 S6 close)
```

**Tag final**: `baseline/feature-e-invite-accept-done` (post-push + deploy READY + smoke verde).

**Rollback S6**: 
- Pre-push: `git reset --hard baseline/feature-e-invite-accept-s5-done`.
- Post-push si smoke falla: revert + force-push (requiere autorización explícita user — destructivo en remote).

## Mecanismo de rollback

```sh
# Rollback total (estado pre-V1.1, equivalente a Feature E V1 done):
git reset --hard baseline/pre-feature-e-invite-accept

# Rollback granular S<N>:
git reset --hard baseline/feature-e-invite-accept-s<N-1>-done

# Ejemplos concretos:
#   - Tras S3 detecta bug en S3: rollback a baseline/feature-e-invite-accept-s2-done.
#   - Tras S5 detecta regression: rollback a baseline/feature-e-invite-accept-s4-done.
#   - Tras S6 detecta smoke fail post-push: revert commit + force-push (autorizado user).
```

## Reverse SQL manual por migration (esqueleto)

**V1.1 NO introduce migration nueva** — consume `app.invitation_preview` + `app.accept_invitation` ya en prod (migration `0003_accept_invitation_fn.sql`). Sin reverse SQL.

## Pointers

- **ADR canónica V1.1**: [`../../decisions/0044-invite-accept-flow.md`](../../decisions/0044-invite-accept-flow.md).
- **Spec del slice**: [`./spec.md`](./spec.md).
- **Tests TDD checklist**: [`./tests.md`](./tests.md).
- **DEFINER consumidas (sin migration nueva)**: `src/db/migrations/0003_accept_invitation_fn.sql`.
- **Save point pre-V1.1**: `baseline/pre-feature-e-invite-accept` = `7ab4d26`.
- **Slice madre (V1)**: `docs/features/members/spec.md` — V1.1 rebaseline §Smoke step 3 (S0).
- **Patrón zone-aware Server Actions**: ADR-0034 — `acceptInvitationAction` lo consume.
- **Patrón returnTo apex**: ADR-0033 — V1.1 S2 extiende allowlist.
- **Patrón AppShell zona-place**: ADR-0023 — page de invite reusa.
- **Patrón i18n DB-based**: ADR-0022 + ADR-0024.
