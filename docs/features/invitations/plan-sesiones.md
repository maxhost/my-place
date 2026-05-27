# `invitations` slice V1.1 + V1.2 (Accept Flow + cross-domain coherence) — Plan de sesiones

> _Plan operativo S0-S6 para V1.1 (cerrada) + S0-S4 para V1.2 (en curso). Status canónico abajo. Decisión arquitectónica V1.1 en [ADR-0044](../../decisions/0044-invite-accept-flow.md), V1.2 en [ADR-0046](../../decisions/0046-invite-flow-cross-domain-coherence.md). Spec en [`./spec.md`](./spec.md). Tests TDD en [`./tests.md`](./tests.md). Save point pre-V1.1: `baseline/pre-feature-e-invite-accept` = `7ab4d26`. Save point pre-V1.2: `baseline/feature-e-invite-accept-done` = `627ad4c`._

## Status V1.1

| Sesión | Status | Tag | Commit | Notas |
|---|---|---|---|---|
| S0 — docs setup | ✓ done | `baseline/feature-e-invite-accept-s0-done` | `7ca3652` | ADR-0044 + spec + plan + tests + rebaseline members spec §Smoke step 3 |
| S1 — acceptInvitationAction + tests | ✓ done | `baseline/feature-e-invite-accept-s1-done` | `e8747ae` | TDD: schemas + map-error + action |
| S2 — validateLoginReturnTo extension | ✓ done | `baseline/feature-e-invite-accept-s2-done` | `f8b6d2f` | TDD: 6 nuevos describes |
| S3 — page + Client panel + RTL + helper | ✓ done | `baseline/feature-e-invite-accept-s3-done` | `492ecd3` | RSC + Client + tampering check |
| S4 — i18n placeInvitation × 6 locales | ✓ done | `baseline/feature-e-invite-accept-s4-done` | `f1368ca` | es first, 5 agentes paralelos |
| S5 — invite signup CTA via `/login?mode=signup` | ✓ done (re-scoped) | `baseline/feature-e-invite-accept-s5-done` | `a4445cc` | Repivot ADR-0045 supersede ADR-0044 §D3 — `/crear` intacto (PlaceWizard 3-pasos), CTA signup repivoteado a `/login?mode=signup` |
| S6 — smoke E2E + write-back + push | ✓ done (con fix mid-S6) | `baseline/feature-e-invite-accept-done` | `627ad4c` | Smoke reveló P0002 post-signup → fix `c13fcfd` (TX 1 ensureAppUser) → re-deploy + retry ✓; 6/10 steps ✓, 4 deferred V1.2 (UX tri-domain). |

## Status V1.2

| Sesión | Status | Tag | Commit | Notas |
|---|---|---|---|---|
| S0 — ADR-0046 + docs setup | ✓ done | `baseline/feature-e-invite-v1.2-s0-done` | (este commit) | ADR-0046 (~480 LOC docs) + README index + spec §Followups V1.2 (S0 cerrado) + plan §Status V1.2 (esta sección). 7 decisiones canon, 8 alternativas rechazadas (α-θ), 11 gaps mapeados. Save point pre-V1.2 = `627ad4c`. |
| S1 (Sesión A) — URL emission zone-aware | ✓ done (con corrección operacional ADR-0046) | `baseline/feature-e-invite-v1.2-s-a-done` | (este commit) | Migration 0022 `app.lookup_custom_domain_by_slug` DEFINER + wrapper TS `src/shared/lib/custom-domain-by-slug-lookup.ts` (memoizado React.cache) + helper `buildPlaceCanonicalUrl` zone-aware en `auth-redirect.ts` + wire 2 callsites (settings/members:204 + invite/[token]:116-138). Tests: 12 integration DB (RLS bypass + filtros + ACL) + 11 wrapper TS (mocks) + 10 helper (mocks). Total ~320 LOC (vs ~120 LOC estimado del ADR §"Alcance"). Corrección operacional: el ADR §"Alcance" prometía "NO migration nueva" basado en query directo, pero pre-impl reveló RLS owner-only sobre `place_domain` + pool corre `app_system` sin BYPASSRLS → única vía canon = DEFINER (paralelo a 0009/0010). Path correction: wrapper en `shared/lib/` no en `features/custom-domain/server/` (precedente canon de lookups transversales). Addendum operacional en ADR-0046 §"Addendum Sesión A". Decisión D1 intacta (contrato), solo cambia el plan operacional. |
| S2 (Sesión B) — `inviteContext` branding + toggle hide | pending | `baseline/feature-e-invite-v1.2-s-b-done` | — | Extender `<AccessFlow>` con prop `inviteContext` (header del place + hide toggle login/signup) + lookup `invitation_preview` en `(marketing)/[locale]/{login,crear}/page.tsx` cuando `?invite=` + i18n keys × 6 locales + tests. ~70 LOC + i18n + ~50 LOC tests. |
| S3 (Sesión C) — Silent SSO post-credential | pending | `baseline/feature-e-invite-v1.2-s-c-done` | — | Builder helper `buildSsoInitUrlForInvite(opts)` server-side + `onSuccess` del `<AccessFlow>` navega a custom domain `sso-init` cuando aplica + tests E2E del builder. ~150-200 LOC + ~100 LOC tests. |
| S4 (Sesión D) — Smoke E2E matriz 2x2 + push | pending | `baseline/feature-e-invite-v1.2-done` | — | Smoke matriz 2x2 (place con/sin custom domain × visitor logged/unlogged) + re-validar 4 steps V1.1 deferidos (3/6/9/10) + write-back evidence en `spec.md` + push autorizado por turno. ~80 LOC docs. |

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

### S5 — invite signup CTA via `/login?mode=signup` (re-scoped, ADR-0045 supersede §D3 de ADR-0044)

> **Repivot 2026-05-26 (mismo día que S0/§D3)**: el diagnóstico pre-S5 reveló que `/crear` es el **PlaceWizard** (3 pasos: identidad+estilo+cuenta), NO un signup-only flow. Implementar §D3 as-written forzaría al invitee a crear un place propio que no quiere. Repivot canónico documentado in-extenso en [ADR-0045](../../decisions/0045-invite-signup-cta-via-login-mode-signup.md). `/crear` queda 100% intacto. Plan original (texto pre-repivot) en git history del file pre-S5.

**Scope re-scoped**: el CTA "Crear cuenta" de la page de invite apunta a `/login?returnTo=…&mode=signup` (en vez de `/crear?returnTo=…`). El page apex `/login` ya honra `returnTo` desde S11.3 (ADR-0033) + el allowlist V1.1 S2 ya acepta absolutas `/invite/[token]`. Nuevo: param query `?mode=login|signup` que pre-selecciona tab al primer render. Whitelist strict + fallback `"login"`, additivo + backwards-compat con todos los entry points existentes (signup desde landing, login directo, cold-start SSO M1, etc.).

**Files (5 code + 2 tests + ya escritos antes de S5-commit: 1 ADR nueva + 2 docs writeback)**:

```
src/features/access/ui/
├── use-access-form.ts                            [M: +3 LOC]    (opt initialMode?: Mode)
├── access-flow.tsx                               [M: +4 LOC]    (prop initialMode pass-through)
└── __tests__/
    └── access-flow.test.tsx                      [M: ~+30 LOC]  (1 test nuevo: initialMode="signup" arranca con tab signup activo)

src/app/(marketing)/[locale]/login/
└── page.tsx                                      [M: ~+6 LOC]   (parse searchParams.mode + whitelist + pass initialMode)

src/app/(app)/place/[placeSlug]/invite/[token]/
├── page.tsx                                      [M: ~3 LOC]    (signupUrl: /crear → /login?mode=signup + comment update)
└── _components/__tests__/
    └── invite-acceptance-panel.test.tsx          [M: ~1 LOC]    (baseProps.signupUrl literal update — sin behavior change)

docs/
├── decisions/0045-invite-signup-cta-via-login-mode-signup.md  [N: ~150 LOC]  (ADR canónica del repivot)
├── decisions/README.md                           [M: +1 entry ADR-0045]
├── features/invitations/spec.md                  [M: ~6 lines]  (4 refs /crear → /login?mode=signup)
└── features/invitations/plan-sesiones.md         [M: este §S5 write-back]
```

**Files NO tocados (explícito, ADR-0045 §D5)**:
- `src/app/(marketing)/[locale]/crear/page.tsx` — PlaceWizard intacto.
- `src/features/place-wizard/` — slice intacto.
- `src/features/place-creation/` — slice intacto.

**Pre-S5 research** (cumplido pre-implementación):
- Read `src/app/(marketing)/[locale]/crear/page.tsx` → confirma PlaceWizard (3 pasos), no signup flow.
- Read `src/app/(marketing)/[locale]/login/page.tsx` → confirma `<AccessFlow>` ya tiene login+signup tabs + ya honra `returnTo` (ADR-0033).
- Read `src/features/access/ui/access-flow.tsx` + `use-access-form.ts` → confirma `useState<Mode>("login")` hardcoded — extensión via `initialMode?` es additiva pura.
- Read `src/shared/lib/sso/validate-login-return-to.ts` → confirma S2 ya acepta absolutas same-registrable-domain matching `/invite/[a-f0-9]{32,256}`.

**Verificación pre-commit**:
- `pnpm typecheck`: clean.
- `pnpm lint`: clean.
- `pnpm test`: suite verde + 1 test nuevo en `access-flow.test.tsx` + 8 tests existentes intactos + 8 tests del invite panel intactos.
- Sin browser smoke en S5 — smoke E2E manual contra prod en S6.

**LOC budget**: ~50 code + ~30 test = sin pressure de caps. ADR + docs writeback = ~190 LOC (no cuentan a caps de slices).

**TDD obligatorio**: test nuevo `<AccessFlow initialMode="signup">` arranca con tab signup activo (`aria-pressed=true` en el botón Crear cuenta + form de signup renderizado: Tu nombre + terms visibles) — escribir primero, ver fallar, implementar `initialMode` pass-through, ver pasar.

**Agentes paralelos**: NO — cambios cruzan 3 capas (hook + componente + page) con dependencia secuencial. Yo serial.

**Commit**:
```
feat(access): /login acepta ?mode=signup + invite CTA signup → /login (V1.1 S5, supersede ADR-0044 §D3)
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

#### S6 close — write-back retroactivo (2026-05-26)

**Cronología real ejecutada**:

1. **S6.a — Pre-flight gates**: typecheck ✓ · lint ✓ · suite 1046/1046 ✓ · build ✓ con ruta `ƒ /place/[placeSlug]/invite/[token]` registrada.
2. **S6.b — Push autorizado S0-S5**: `maxhost main` + `origin main` (mirror) + 6 tags `baseline/feature-e-invite-accept-s{0..5}-done`. Push a 2 remotes per user authorization.
3. **S6.c — Vercel deploy READY**: `dpl_Ajam4PSpFy6YsnPXX7uo9GvnBFhK` (commit `a4445cc`), build ~53s, aliases `place.community` / `*.place.community` / `app.place.community` / `nocodecompany.co` activos.
4. **S6.d — Smoke E2E user-driven**: steps 1, 2, 7 (parcial), 4, 5, 8 ✓. **Bug descubierto en step 7**: post-signup el accept retorna copy genérico "Algo salió mal".
5. **S6.d.fix — Diagnóstico + fix mid-S6** (no planeado pre-S6, requerido por smoke):
   - Root cause (3 evidencias Neon + canon ADR-0008 §2/§4): `signUpAccountAction` no crea `app_user`; el invite Accept no pasa por PlaceWizard → DEFINER tira P0002 → `mapAcceptError` correcto pero `errorCopy` del panel cae al `default: errorUnknown`.
   - Fix: wire `ensureAppUser` en TX 1 separada antes de TX 2 del DEFINER en `accept-invitation.ts` (patrón canónico `create-place.ts:65-77`, ADR-0005 §4). Commit `c13fcfd`, +42 −5 LOC, suite 1046/1046 sin regresión.
   - Deploy `dpl_GBYXwwPDKkN1DtAdQPxQxuphPj11` (~44s turbopack). User retry step 7 → success → triple evidencia Neon (timestamps prueban TX 1 split).
   - Gotcha registrado en `docs/gotchas/accept-invitation-requires-ensure-app-user-tx1.md` (criterio CLAUDE.md §Gotchas 3/3).
6. **S6.d (cont)**: steps 5 + 8 ejecutados post-fix ✓ (`Esta página no existe` esperado).
7. **Steps 3, 6, 9, 10 deferred a V1.2** (decisión user, post-fix UX tri-domain raised mid-S6 — issue arquitectural separado).
8. **S6.e — Write-back evidence**: spec.md §"Smoke ejecutado (2026-05-26, S6 close)" tabla 10 steps + §"Followups V1.2"; plan-sesiones §Status fill; gotcha doc.
9. **S6.f — Commit write-back + tag final + push**.

**Cobertura final V1.1 S6**: critical path post-signup ✓ (step 7 con fix), defenses anti-doxx ✓ (steps 5, 8), preview unauth ✓ (step 2), accept submit + Neon triple evidence ✓ (step 4). 6/10 E2E + 4/10 estructuralmente cubiertos (RTL + i18n parity + unit tests) + deferred re-execution post-V1.2 UX fix.

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
