# `invitations` slice — Spec V1.1 (Accept Flow)

> _Spec creado 2026-05-26 (S0 de Feature E V1.1). Status: planificación. Decisión canónica en [ADR-0044](../../decisions/0044-invite-accept-flow.md). Plan operativo en [`./plan-sesiones.md`](./plan-sesiones.md). Tests TDD checklist en [`./tests.md`](./tests.md). Baseline pre-implementación: `baseline/pre-feature-e-invite-accept` = `7ab4d26`._

## Contexto

El slice `invitations/` fue extraído desde `members/` en Feature E V1 (ADR-0041, 2026-05-25) con dos capabilities ya production-grade: **create** (`createInvitationAction` que emite token + URL `/invite/{token}`) y **revoke** (`revokeInvitationAction` que elimina invitación pending). Smoke E2E post-deploy V1 (2026-05-26) detectó que la tercera capability del slot — **accept** (consumer del token-link) — no estaba implementada: `GET /invite/{token}` retorna 404 porque ni la ruta ni el page existen. ADR-0044 §Contexto documenta la evidencia triple (Neon prod + Vercel logs + codebase grep).

V1.1 cierra ese gap: agrega `acceptInvitationAction` (Server Action wrapper sobre el primitive DB `app.accept_invitation` ya existente desde migration 0003) + page consumer `(app)/place/[placeSlug]/invite/[token]/page.tsx` (RSC server-rendered con preview unauth + consent panel) + extiende `validateLoginReturnTo` (ADR-0033) para que el flow `unauthenticated → login → back to invite` funcione end-to-end + extiende `/login` apex con param opcional `?mode=login|signup` para pre-seleccionar tab signup desde el CTA "Crear cuenta" del invite (ADR-0045 supersede §D3 original que planteaba extender `/crear`).

V1.1 NO requiere migration nueva. El primitive `app.accept_invitation` está deployado en producción con 7 SQLSTATEs canónicos. La feature es 100% código de aplicación + i18n × 6 locales.

## Capabilities V1.1 (slice completo)

Post-V1.1 el slice expone **3 capabilities** del slot DB `invitation`:

1. **Create** (V1, ya production): owner crea invitación con email + TTL → emite link `/invite/{token}`. Función DB: `app.create_invitation` (migration 0018). Action: `createInvitationAction`. UI: `<InviteMemberModal />` (open desde page S11 `/settings/members`).
2. **Revoke** (V1, ya production): owner elimina invitación pending. Función DB: `app.revoke_invitation` (migration 0019). Action: `revokeInvitationAction`. UI: `<PendingInvitationsTab />` con botón "Revocar" por row.
3. **Accept** (V1.1, scope este spec): invitee abre link → preview + consent → membership creada. Funciones DB: `app.invitation_preview` + `app.accept_invitation` (migration 0003, **ya deployadas**). Action: `acceptInvitationAction`. UI: page `/invite/{token}` + `<InviteAcceptancePanel />`.

## Modelo conceptual del Accept

Las 4 decisiones canónicas se documentan in-extenso en ADR-0044 §Decisión. Resumen operativo:

**Route placement (D1)**: la ruta vive en zona-place dentro del subdomain proxy (`(app)/place/[placeSlug]/invite/[token]/page.tsx`). El middleware reescribe `mi-place.place.community/invite/abc` → `/place/mi-place/invite/abc`. Beneficios: cross-place tampering check natural (RSC verifica `placeSlug` ↔ `invitation.place_id`), branding visible, locale del place, forward-compat custom domains.

**Consent explícito (D2)**: el RSC renderiza preview + botón "Aceptar invitación". NO auto-accept en GET. Razón: el token es capability (ADR-0010 §2), el click es el acto de aceptación. Defensa contra preview-fetch automáticos (iMessage/Slack bots).

**Unauthenticated path (D3, repivot ADR-0045)**: preview unauth (vía `app.invitation_preview`, no requiere claim) + 2 CTAs (login + signup) con `returnTo` absoluto al URL invite. Ambos CTAs apuntan al mismo apex `/login` (allowlist extendido en S2 para aceptar absolutas `/invite/[token]`), diferenciados por query param `mode`: Login usa `/login?returnTo=…`, Signup usa `/login?returnTo=…&mode=signup` (S5 extiende `/login` con prop `initialMode` y param query whitelist `?mode=login|signup`). ADR-0044 §D3 original planteaba `/crear?returnTo=…` para signup pero el diagnóstico pre-S5 reveló que `/crear` es el PlaceWizard (3 pasos: identidad+estilo+cuenta) — ADR-0045 supersede §D3 y `/crear` queda intacto.

**Email match estricto V1 (D4)**: si invitee autenticado tiene email distinto, panel error explícito + CTA logout con returnTo pre-cargado. NO auto-switch de cuenta V1 (out of scope — multi-account no soportado).

**Place full V1 (D5)**: panel error "Cupo alcanzado, hablá con quien te invitó". Sin CTA unblock V1.1 (gap consciente, V1.2+ con ADR-0037 §V2 UI).

## Casos de uso V1.1 (accept atomic)

### CU-Accept-1 — Preview unauth (visitor anónimo)

- **Precondición**: GET `/invite/{token}` sin cookie de sesión apex; token existe; no vencido; no usado.
- **Postcondición**: page renderiza nombre del place + email invitado + 2 CTAs (login / signup) con `returnTo` absoluto.
- **Errores estructurales** (todos retornan 404 sin doxx):
  - Token inexistente (`P0005`): 404 (no se distingue "no existe" vs "venció" vs "cross-place" para evitar leak).
  - Token vencido (`P0006`): 404.
  - Token ya usado (`P0007`): 404.
  - `placeSlug` URL ↔ `invitation.place_id` mismatch (defense-in-depth contra cross-place tampering): 404.

### CU-Accept-2 — Preview autenticado same-email

- **Precondición**: GET con cookie apex válida; `current_email` lower(btrim()) matchea `inv_email`; resto de condiciones CU-Accept-1.
- **Postcondición**: page renderiza preview + botón "Aceptar invitación a {placeName}" + CTA secundario "No, gracias" → Hub canónico.
- **Errores**: idem CU-Accept-1.

### CU-Accept-3 — Preview autenticado email mismatch (P0008-anticipated)

- **Precondición**: GET con cookie apex válida; `current_email` NO matchea `inv_email` (case-insensitive después de btrim).
- **Postcondición**: page renderiza panel error: "Esta invitación es para `<inv_email>`. Estás logueado como `<current_email>`." + CTA "Cerrá sesión y entrá como `<inv_email>`" → `/logout?returnTo=<invite URL>`.
- **Errores**: idem CU-Accept-1. El email mismatch en RSC pre-empt the action — no se llama `acceptInvitationAction` hasta que el invitee logout+login con la cuenta correcta.

### CU-Accept-4 — Submit accept (autenticado same-email)

- **Precondición**: POST a `acceptInvitationAction` con `{ token, placeSlug }`; sesión apex válida; email matchea.
- **Postcondición**: `app.accept_invitation` ejecuta atómicamente (test-and-set sobre `accepted_at` IS NULL): UPDATE invitación + INSERT membership. Server Action retorna `{ status: 'success', placeSlug }`. Page redirige a `https://{placeSlug}.place.community/` (Hub del place).
- **Errores estructurales** (mapeados a `AcceptInvitationError`):
  - `28000` no autenticado → status `unauthenticated` (panel "Sesión expirada, reintentá").
  - `P0002` app_user inexistente → status `app_user_missing` (panel "Error técnico — reportá esto al admin"). Caso patológico; no debería ocurrir en producción.
  - `P0005` invitación inexistente → status `not_found`.
  - `P0006` vencida → status `expired` (panel "Esta invitación venció. Pedí una nueva a quien te invitó").
  - `P0007` ya usada → status `already_used` (panel "Esta invitación ya se usó").
  - `P0008` email mismatch → status `email_mismatch` (panel CU-Accept-3 + CTA logout).
  - `P0009` place lleno → status `place_full` (panel CU-Accept-D5).

### CU-Accept-5 — Login round-trip (returnTo)

- **Precondición**: visitor anónimo en `/invite/{token}` → click "Iniciar sesión" → `/login?returnTo=<URL absoluta del invite>` → login exitoso.
- **Postcondición**: `validateLoginReturnTo` (extendido S2) acepta el URL absoluto (same-registrable-domain + pattern `/invite/[token]`) → redirect post-login al invite URL → page render CU-Accept-2 o CU-Accept-3 según email match.
- **Errores**:
  - `returnTo` URL malformed o cross-registrable-domain o no matchea pattern: silently ignored (redirect a Hub canónico — comportamiento backwards-compat ADR-0033).

### CU-Accept-6 — Signup round-trip (returnTo)

- **Precondición**: visitor anónimo en `/invite/{token}` → click "Crear cuenta" → `/crear?returnTo=<URL absoluta del invite>` → signup exitoso (extensión S5 hace `/crear` honor returnTo).
- **Postcondición**: post-signup, redirect al invite URL → page render CU-Accept-2 (email del nuevo user matchea inv_email por flow normal — el invitee usó el email de la invitación).
- **Errores**:
  - Idem CU-Accept-5 (mismo allowlist).

Estos 6 casos cubren V1.1 completo. Los 7 SQLSTATEs del primitive DB están todos mapeados a errores discriminables app-side.

## Schema delta

**Cero cambios de schema**. Funciones DEFINER consumidas:

1. `app.invitation_preview(p_token text) RETURNS TABLE (place_slug text, place_name text, invitee_email text)` — migration 0003:24-46. Sin claim auth. Errores: P0005/P0006/P0007.
2. `app.accept_invitation(p_token text) RETURNS text` — migration 0003:57-111. Requiere claim auth. Errores: 28000/P0002/P0005/P0006/P0007/P0008/P0009.

Ambas con `SECURITY DEFINER`, `SET search_path = public, pg_temp`, `REVOKE EXECUTE FROM PUBLIC`, `GRANT EXECUTE TO app_system`. Cuerpos test-and-set atómicos (ver migration 0003 inline comments).

## Estructura del slice post-V1.1

```
src/features/invitations/
├── public.ts                                    [M: +10 LOC]
├── types.ts                                     [M: +15 LOC]  (AcceptInvitationError)
├── actions/
│   ├── create-invitation.ts                     [V1, sin cambio]
│   ├── revoke-invitation.ts                     [V1, sin cambio]
│   ├── accept-invitation.ts                     [N: ~55 LOC]   (V1.1)
│   └── _lib/
│       ├── schemas.ts                           [M: +25 LOC]   (acceptInvitationSchema)
│       ├── map-invite-error.ts                  [V1, sin cambio]
│       ├── map-revoke-error.ts                  [V1, sin cambio]
│       ├── map-accept-error.ts                  [N: ~55 LOC]   (V1.1, 7 SQLSTATEs)
│       └── __tests__/
│           ├── schemas.test.ts                  [M: +15 LOC]
│           ├── map-invite-error.test.ts         [V1, sin cambio]
│           ├── map-revoke-error.test.ts         [V1, sin cambio]
│           └── map-accept-error.test.ts         [N: ~30 LOC]   (V1.1)
├── queries/
│   ├── load-pending-invitations.ts              [V1, sin cambio]
│   └── __tests__/load-pending-invitations.test.ts [V1, sin cambio]
└── ui/
    ├── invite-member-modal.tsx                  [V1, sin cambio]
    ├── pending-invitations-tab.tsx              [V1, sin cambio]
    └── __tests__/...                            [V1, sin cambio]
```

**Page consumer V1.1** (fuera del slice, en `src/app/(app)/place/[placeSlug]/`):

```
invite/
└── [token]/
    ├── page.tsx                                 [N: ~190 LOC]  (RSC)
    └── _components/
    │   ├── invite-acceptance-panel.tsx          [N: ~240 LOC]  (Client)
    │   └── __tests__/
    │       └── invite-acceptance-panel.test.tsx [N: ~160 LOC]  (RTL)
    └── _lib/
        └── get-invitation-meta-by-token.ts      [N: ~75 LOC]   (PURE helper tampering check)
```

**Otros files extendidos V1.1**:

```
src/shared/lib/sso/
├── validate-login-return-to.ts                  [M: +25 LOC]   (pattern /invite/[token])
└── __tests__/
    └── validate-login-return-to.test.ts         [M: +90 LOC]   (~6 nuevos describes)

src/features/access/ui/                          (ADR-0045 supersede §D3 — sin tocar /crear)
├── use-access-form.ts                           [M: +3 LOC]    (opt initialMode?)
├── access-flow.tsx                              [M: +4 LOC]    (prop initialMode pass-through)
└── __tests__/access-flow.test.tsx               [M: ~+30 LOC]  (1 test initialMode="signup")

src/app/(marketing)/[locale]/login/
└── page.tsx                                     [M: ~+6 LOC]   (parse searchParams.mode + whitelist + pass initialMode)

src/i18n/messages/
├── es.json                                      [M: +1 namespace placeInvitation]
├── en.json                                      [M: +1 namespace placeInvitation]
├── fr.json                                      [M: +1 namespace placeInvitation]
├── pt.json                                      [M: +1 namespace placeInvitation]
├── de.json                                      [M: +1 namespace placeInvitation]
└── it.json                                      [M: +1 namespace placeInvitation]

src/i18n/messages-loader.ts                      [M: +1 namespace en el merge]
```

**LOC total V1.1**: ~280 LOC al slice `invitations/` (cierra en ~1777, dentro del sub-cap bumpeado 1800 — ADR-0044 §D6) + ~590 LOC en page consumer (fuera del slice) + ~115 LOC en `shared/lib/sso/` + ~50 LOC en `access/` + `/login` (ADR-0045 supersede §D3 — antes proyectado ~120 LOC en `/crear` que ya no se toca) + ~i18n (~80 keys × 6 locales = ~480 LOC distribuidas en 6 JSONs).

## Gaps conscientes V1.1

V1.1 acota deliberadamente para shipear el cierre del flow accept. Cada uno de los siguientes se difiere a V1.2+ con razón explícita:

- **Multi-account switcher en P0008** (un user con múltiples cuentas en el browser que quiere aceptar como la cuenta de la invitación sin logout). V1.1 = logout + re-login. V1.2+ si user feedback lo demanda.
- **Place full unblock UI** (CTA "Solicitar aumento de cupo" cuando ADR-0037 §V2 entre con UI de quota config). V1.1 = mensaje "Hablá con quien te invitó" + sin acción.
- **Email vista preview unauth — opt-out** (un invitee preferiría no ver su email en preview en caso de URL leak). V1.1 muestra siempre (alineado con migration 0003:23 "su propio inbox, no es fuga"). V1.2+ si privacy concerns aparecen.
- **Aceptar invitación post-revoke** (race: owner revoca mientras invitee tiene la page abierta y aún no clickeó accept). V1.1 retorna `P0005 invitación inexistente` post-revoke (DELETE de invitation → preview falla y accept falla). Acceptable UX. V1.2+ si UX-confusion aparece, error específico `revoked`.
- **Audit log de acceptances** (tabla `invitation_accept_log` con `accepted_at` + `accepted_from_host` + `IP`). V1.1 sólo persiste `accepted_at` en `invitation`. V1.2+ si compliance lo requiere.
- **Notificación al owner cuando invitee acepta** (email/in-app "{X} aceptó tu invitación a {place}"). V1.1 no notifica. V1.2+ con canal notifs.
- **Counter `membership.invitations_used`** (ADR-0037 §V2). V1.1 honra el V1 schema-only — no incrementa counter ni enforce quota. V1.2+ con ADR-0037 §V2.

Cada gap queda explícito acá para que la sesión que los aborde post-V1.1 sepa qué encontrar y qué NO encontrar.

## Decisión operativa: tampering check vive en RSC (no en DEFINER)

`app.invitation_preview` retorna `place_slug` de la invitación. El RSC compara con `placeSlug` del URL post-proxy. Si no matchean, retorna 404. Esta verificación NO está en el DEFINER porque:

1. El DEFINER NO conoce el host del request (no recibe `placeSlug` como parámetro V1).
2. Cambiar el DEFINER para agregar `p_expected_place_slug` rompería el contrato existente (V1 consumers no lo pasarían).
3. El check en RSC es defense-in-depth — no afecta correctness DB (el DEFINER ya garantiza que `accept_invitation` crea membership en el `place_id` correcto, no en el spoofed). La verificación RSC asegura que el invitee no llega a una página de un place distinto al esperado.

V1.2+ podría considerar extender el DEFINER si emerge un attack vector más fuerte; por ahora el check RSC es suficiente.

## Decisión operativa: place archived es aceptable

`app.accept_invitation` NO discrimina por `place.subscription_status`. Razón: misma decisión que features anteriores (ADR-0035 §"Decisión operativa", ADR §Members spec) — un place archivado puede tener invitaciones pending que se aceptan post-archive sin que la membership cambie nada operativo (el place sigue archivado). El owner que revocaría invitaciones en places archivados lo hace via `revokeInvitationAction` por path normal. Sin gating por status.

## Smoke verification

Tras S6 (cierre operativo V1.1), la verificación manual end-to-end contra producción + browser real:

1. **Setup**: usar el place `mi-place` ya existente en prod (founder = user de tests). Si la invitación del smoke V1 (`49e100fea6344c3ab84aa33893751eb41a038aae88ed4cecacfc3c0cba6154a6`) sigue válida en DB, reusarla. Si no, crear nueva via `/settings/members` modal "Invitar".
2. **Preview unauth**: abrir `https://mi-place.place.community/invite/{token}` en incognito → verificar render del page con `placeName` + `invitee_email` + 2 CTAs (login + signup) visibles + sin link al Hub (visitor sin contexto Hub).
3. **Login round-trip**: click "Iniciar sesión" → URL navega a `/login?returnTo=<invite URL>` → completar login con email matching → post-login redirect transparente al invite URL → page renderiza CU-Accept-2 (botón "Aceptar invitación").
4. **Accept submit**: click "Aceptar invitación a mi-place" → button loading state → success → redirect a `https://mi-place.place.community/` (Hub del place). Verificar Neon: `invitation.accepted_at NOT NULL`, nueva fila `membership (user_id, place_id)`.
5. **Smoke autenticado direct (re-accept attempt)**: re-abrir el invite URL post-accept → page retorna 404 (token ya usado, sin doxx). Verificar Neon: `invitation.accepted_at` no cambia (no se llamó accept de nuevo).
6. **Email mismatch path**: en otra cuenta apex con email distinto, navegar al invite URL → page renderiza CU-Accept-3 (panel email mismatch + CTA logout). Click "Cerrar sesión y entrar como X" → flow logout → re-login form pre-cargado con returnTo. Sin completar login: verificar la URL del browser tiene `returnTo` correcto en query.
7. **Signup round-trip** (ADR-0045 supersede §D3): crear invitación nueva para email `nuevo@test.com` (que no tiene cuenta) → abrir invite URL incognito → click "Crear cuenta" → URL `/login?returnTo=<invite URL>&mode=signup` → page apex `/login` aterriza con tab signup pre-seleccionado (no login default) → completar signup con `nuevo@test.com` → post-signup redirect al invite URL → page renderiza CU-Accept-2 (email matchea por design) → click "Aceptar" → success → Hub. Verificar también que `/crear` queda intacto: visitar `/crear` directamente (sin mode/returnTo params) → wizard 3 pasos arranca normal, sin regresión del flow place-first canónico.
8. **Cross-place tampering check**: modificar URL del browser para apuntar a un placeSlug distinto con el mismo token (`https://otro-place.place.community/invite/{token}`) → page retorna 404 (tampering check RSC mata el render).
9. **i18n smoke**: cambiar `place.default_locale` del place a `en` via `/settings` → reload page de invite → verificar todos los labels traducidos al inglés (no aparece nada en español).
10. **Place full P0009 path** (opcional — requiere setup): crear 150 memberships en un place de test → emitir invitación 151 → invitee llega a page → click "Aceptar" → action retorna `place_full` → panel "Cupo alcanzado, hablá con quien te invitó". V1.1 OK skipear este si no hay branch de test con 150 users.

Resultados se logean en S6 (mismo patrón que el smoke `dpl_*` de Feature C y D); si algún assert falla, S6 no cierra y se abre debugging session.

### Smoke ejecutado (2026-05-26, S6 close)

**Deploys involucrados**:

| Deploy ID | Commit | State | Notas |
|---|---|---|---|
| `dpl_Ajam4PSpFy6YsnPXX7uo9GvnBFhK` | `a4445cc` (S5) | READY (~53s) | Build inicial post-S5. Reveló bug P0002 en step 7. |
| `dpl_GBYXwwPDKkN1DtAdQPxQxuphPj11` | `c13fcfd` (S6 fix) | READY (~44s, turbopack) | Fix `ensureAppUser` TX 1 pre-DEFINER. Validó step 7 + 4 + 5 + 8. |

**Token usado**: `ee9b2c497e2940fd865d6c7b5f154d707a39fef9d91e4341beaa1efebf4616ab` (place `mi-place`, invitee `mqwmfdxicixgjhtqfv@gonrr.net`, expires `2026-06-02T21:39:19.917Z`). Place `mi-place` con custom domain configurado (`nocodecompany.co` activo en aliases del deploy, ver §"Followups V1.2").

**Resultados por step**:

| Step | Cobertura | Resultado | Evidencia |
|---|---|---|---|
| 1. Setup token | ✓ | Token emitido via `/settings/members` modal "Invitar"; Neon `invitation` row con `accepted_at NULL` + `expires_at > NOW()`. | Neon query confirma fila. |
| 2. Preview unauth | ✓ | Incognito → `https://mi-place.place.community/invite/{token}` → header "Invitación a Mi place" + email preview + 2 CTAs (login + signup). | User-driven confirm. |
| 3. Login round-trip (existing user) | **Deferred V1.2** | — | Requiere nueva invitación + cuenta existente. Funcionalmente cubierto por step 7 path post-fix. |
| 4. Accept submit | ✓ | Click "Aceptar" (post-fix) → success → redirect a `https://mi-place.place.community/`. **Triple evidencia Neon** (post-deploy fix): `invitation.accepted_at = 2026-05-26T22:23:08.914Z` · `app_user.created_at = 22:23:08.866Z` (precede `accepted_at` por 48ms → valida TX 1 split) · `membership.joined_at = 22:23:08.914Z, left_at = NULL`. | 3 queries Neon en SQL transcript. |
| 5. Re-accept 404 | ✓ | Re-abrir invite URL post-accept → page "Esta página no existe" (Next.js `notFound()` desde `app.invitation_preview` que ahora tira P0007 `invitación ya utilizada`). | User-driven confirm + Neon `accepted_at` no cambia. |
| 6. Email mismatch | **Deferred V1.2** | — | Requiere 2da cuenta apex con email distinto. RTL tests 8 cubren el path interno (`__tests__/invite-acceptance-panel.test.tsx` describe "render auth email mismatch"). |
| 7. Signup round-trip (ADR-0045) | ✓ (con fix mid-S6) | Incognito → "Crear cuenta" → URL `/login?returnTo=…&mode=signup` ✓ → tab signup pre-seleccionado ✓ (no login default — ADR-0045 §D2/D3) → signup OK → redirect al invite URL → CU-Accept-2 panel ✓ → click "Aceptar" → **inicialmente "Algo salió mal" (bug P0002)**. Diagnóstico-first: 3 evidencias Neon + ADR-0008 §2/§4 → fix wire `ensureAppUser` TX 1 (commit `c13fcfd`) → re-deploy → refresh invite URL → "Aceptar" → success → Hub del place. `/crear` intacto verificado (PlaceWizard 3 pasos sin regresión). | Bug doc en `docs/gotchas/accept-invitation-requires-ensure-app-user-tx1.md`. |
| 8. Cross-place tampering | ✓ | Modificar URL a slug distinto manteniendo token → page "Esta página no existe". Tampering check RSC (`get-invitation-meta-by-token.ts`) corta el render. | User-driven confirm. |
| 9. i18n smoke | **Deferred V1.2** | — | Requiere admin switch de `place.default_locale` a `en`. Covered estructuralmente por S4 (6 locales × 13 keys + `check-translations` parity gate). |
| 10. Place full P0009 | **Deferred / skip** | — | Requires 150 memberships pre-creadas — skipeado per plan §S6 ("opcional, V1.1 OK skipear"). Cubierto por mapping unit test (`map-accept-error.test.ts:53-58`). |

**Cobertura**: 6/10 steps validados E2E contra producción (1, 2, 4, 5, 7, 8). 4/10 deferred (3, 6, 9, 10) — covered estructuralmente por RTL tests + i18n parity gate + unit tests + (post-V1.2) re-ejecución coordinada con el fix UX tri-domain. **Critical path post-signup** (step 7 con fix) ✓.

**Bug + fix mid-S6**:
- **Descubierto en step 7**: post-signup accept retorna copy genérico "Algo salió mal" en panel; 0 logs en Vercel runtime.
- **Root cause (3 evidencias Neon + canon doc)**: `signUpAccountAction` no crea `app_user` por design (ADR-0008 §2/§4); el invite Accept no pasa por PlaceWizard (único path que sembraba `app_user` via `place-creation/create-place.ts:71-77`); DEFINER `app.accept_invitation` tira P0002 al no encontrar `app_user`; `mapAcceptError(P0002)` mapea correcto a `{kind: 'app_user_missing'}` pero `errorCopy` del panel cae al `default: errorUnknown` (no había copy específico).
- **Fix**: wire `ensureAppUser` en TX 1 separada antes de TX 2 del DEFINER. Patrón canónico `create-place.ts:65-77` (ADR-0005 §4). Commit `c13fcfd`, +42 −5 LOC en `acceptInvitationAction`. Tests 1046/1046 sin regresión (action es seam-split integrator, validado por typecheck + smoke retry).
- **Gotcha registrado** (canon CLAUDE.md §Gotchas: 3/3 criterios — no derivable, síntoma confuso, volvería a morder): `docs/gotchas/accept-invitation-requires-ensure-app-user-tx1.md` con pattern obligatorio para cualquier futura action invocable post-signup sin pasar por PlaceWizard.

## Followups V1.2 (post-S6)

- **UX tri-domain coherence**: el flow accept cruza 3 URLs (subdomain invite emission → apex `/login` auth → subdomain accept return). Para places con custom domain configurado, el `nocodecompany.co` ni siquiera aparece en el flow — el invite siempre se emite contra `{slug}.place.community`. Issue raised por el user en S6 smoke (2026-05-26): "Esto genera una desconfianza terrible porque el usuario jamás sabe dónde está de verdad". Scope: arquitectural, requiere ADR + sesión bis (probable dependencia de Feature C extensions o cookie scope policy). Bloquea finish smoke steps 3/6/9/10 (decisión user: deferred post-UX).
- **Re-ejecución smoke steps 3/6/9/10**: cuando V1.2 cierre el flow UX, re-correr los 4 steps deferidos para confirmar funcionalidad end-to-end intacta + i18n locale switch + login round-trip con cuenta existente + mismatch path.
- **Auditoría DEFINERs post-signup**: revisar futuras Server Actions invocables sin PlaceWizard intermedio. Lista candidata + test rápido en gotcha doc `accept-invitation-requires-ensure-app-user-tx1.md` §"Cuándo vuelve a morder".

## Pointers

- **ADR canónica V1.1**: [`../../decisions/0044-invite-accept-flow.md`](../../decisions/0044-invite-accept-flow.md).
- **ADRs canónicas pre-V1 del slot**:
  - [`../../decisions/0010-rls-por-operacion-invitacion-token-link.md`](../../decisions/0010-rls-por-operacion-invitacion-token-link.md) — capability + token-link como modelo canónico.
  - [`../../decisions/0037-member-invite-quota.md`](../../decisions/0037-member-invite-quota.md) — quota V1 schema-only (V1.1 lo honra, no toca counter).
  - [`../../decisions/0041-extract-invitations-slice.md`](../../decisions/0041-extract-invitations-slice.md) — extracción del slice desde `members/`.
- **ADRs extendidas por V1.1**:
  - [`../../decisions/0033-apex-login-honors-returnto.md`](../../decisions/0033-apex-login-honors-returnto.md) — allowlist extendido en S2 (`/invite/[token]`).
- **Patrón consumido**:
  - [`../../decisions/0034-zone-aware-db-helper.md`](../../decisions/0034-zone-aware-db-helper.md) — `acceptInvitationAction` usa `getAuthenticatedDbForRequest` por canon.
  - [`../../decisions/0023-app-shell-agnostico-shared-ui.md`](../../decisions/0023-app-shell-agnostico-shared-ui.md) — page de invite reusa AppShell zona-place.
  - [`../../decisions/0022-locale-del-place.md`](../../decisions/0022-locale-del-place.md) + [`../../decisions/0024-i18n-fallback-deep-merge.md`](../../decisions/0024-i18n-fallback-deep-merge.md) — i18n con `place.default_locale`.
- **DEFINER primitives consumidas (sin migration nueva)**: `src/db/migrations/0003_accept_invitation_fn.sql`.
- **Bug evidence (404 detection)**:
  - Neon prod query confirma token válido en `invitation` table.
  - Vercel runtime logs: `GET /invite/49e100... 404` (deploy `dpl_J5QcmBYmLQENi9yz8owK5j8eCt4N`).
  - Codebase grep: 0 archivos definían `invite/[token]` pre-V1.1.
- **Spec madre del slot**: [`../members/spec.md`](../members/spec.md) — Feature E V1 (members + invitations slot). V1.1 rebaseline el §"Smoke verification" step 3 (que erróneamente apuntaba a "flow de Feature C").
- **Plan de sesiones operativo**: [`./plan-sesiones.md`](./plan-sesiones.md).
- **Test checklist por sesión**: [`./tests.md`](./tests.md).
