# 0044 — Invite Accept Flow V1.1: `/invite/[token]` consume DEFINER existente + LOC cap bump invitations/ 1500→1800

- **Fecha:** 2026-05-26
- **Estado:** Aceptada
- **Alcance:** ruta nueva `src/app/(app)/place/[placeSlug]/invite/[token]/page.tsx` (RSC server-rendered, consume `app.invitation_preview` sin sesión) + Client panel co-located `_components/invite-acceptance-panel.tsx` (formstate + 2 CTAs unauth) + nueva Server Action `acceptInvitationAction` en `src/features/invitations/actions/accept-invitation.ts` (consume `app.accept_invitation` existente) + map de errores `_lib/map-accept-error.ts` (7 SQLSTATEs) + zod `acceptInvitationSchema` extendida + helper PURE co-located `_lib/get-invitation-meta-by-token.ts` (cross-place tampering check) + extensión de `validateLoginReturnTo` en `src/shared/lib/sso/` para aceptar paths `/invite/[token]` + extensión `/crear` para honrar `returnTo` post-signup + i18n nuevo namespace `placeInvitation` × 6 locales. **NO migration nueva** — consume `app.accept_invitation` + `app.invitation_preview` ya existentes (migration `0003_accept_invitation_fn.sql`, deployada en producción).
- **Habilita:** que la URL emitida por `<InviteMemberModal />` (Feature E V1) sea funcional end-to-end — visitor anónimo o autenticado abre el link, ve preview del place + email invitado (vía `app.invitation_preview`), da consentimiento explícito (botón "Aceptar invitación"), y queda como miembro activo del place. Cierra el gap 404 detectado en smoke E2E post-deploy Feature E V1 (2026-05-26, deploy `dpl_J5QcmBYmLQENi9yz8owK5j8eCt4N`).
- **Refina parcialmente:** ADR-0010 §2 (capability-based invite token-link): formaliza la UX del CONSUMER del token — V1.1 instancia el "click → preview → consent → accept" que ADR-0010 §2 enunciaba como contrato pero no detallaba a nivel de page/route. Sin cambiar el contrato del token ni la semántica SECURITY DEFINER. · ADR-0033 (apex login honra `?returnTo`): extiende el allowlist explícito de `validateLoginReturnTo` con un patrón nuevo `/invite/[token]` (relativo, mismo registrable domain para absolutos) — sin cambiar la política same-registrable-domain ni los rejects existentes. · ADR-0041 (extract invitations slice): bump del cap LOC sub-slice 1500 → 1800 — precedente ADR-0032 §5 (`src/shared/lib/sso/` con sub-cap 800 propio); justificación: el flow accept es la 3a capability natural del slot DB `invitation` (junto a create + revoke) y separarlo en `invite-accept/` rompería cohesión sin ganar boundaries enforceables.
- **No supersede:** ADR-0001 (topología auth dos mundos) · ADR-0010 (RLS por-operación + invitación token-link) · ADR-0021 (member-read RLS) · ADR-0033 (apex login returnTo) · ADR-0034 (zone-aware DB helper) · ADR-0037 (member invite quota schema-only) · ADR-0041 (invitations slice extraction).

Las ADR son registro histórico: no se editan, se reemplazan con una nueva ADR que la supersede.

## Contexto

Feature E V1 (Members slice, cerrada 2026-05-26 deploy `dpl_J5QcmBYmLQENi9yz8owK5j8eCt4N` con 5 migrations 0017-0021 aplicadas a Neon prod) entregó: page `/settings/members` + tab "Activos" + tab "Pendientes" + modal `<InviteMemberModal />` que emite un link `https://{host}/invite/{token}` al submit del form de invitación. **El emisor del link funciona en producción**; el consumer del link **NO existe** — al abrir `https://mi-place.place.community/invite/{token}` en un browser incognito, Next.js 16 retorna 404 (route nunca implementada).

### Evidencia del gap (smoke E2E post-deploy, 2026-05-26)

1. **Producción Neon** (Neon MCP `run_sql` sobre `br-divine-credit-ap9ty5er`): fila `invitation.token = '49e100fea6344c3ab84aa33893751eb41a038aae88ed4cecacfc3c0cba6154a6'` existe, `accepted_at = NULL`, `expires_at` > now(), `email = 'invitee@test.com'`, `place_id` matchea `mi-place`. La invitación está válida y aceptable a nivel DB.
2. **Vercel runtime logs** (Vercel MCP `get_runtime_logs` filtrado por host `mi-place.place.community`): un único evento `GET /invite/49e100... 404` (sin error en serverless, sin invocación de Server Action, sin ninguna ruta matcheada — el middleware `proxy` reescribe el host a `(app)/place/[placeSlug]/invite/[token]` y Next.js no encuentra el page).
3. **Codebase** (grep recursivo `invite/[token]`): la URL se construye desde 2 puntos canónicos — `src/features/invitations/actions/create-invitation.ts:48` (return result) y `src/features/invitations/ui/invite-member-modal.tsx:97` (copy-to-clipboard) — **0 archivos definen la ruta consumer**. `find src/app -path '*invite*'` retorna vacío.

El bug es estructural: la feature E V1 emite tokens válidos sin haber implementado el consumer. La spec V1 §"Smoke verification" step 3 hipotetizaba un "flow de signup/login (existente de Feature C)" — pero **Feature C es custom-domain-sso, NO un flow de signup/login**. La hipótesis fue incorrecta desde el spec; la feature shipeó con un gap del CONSUMER del token nunca formalizado.

### Por qué este bug no se detectó pre-deploy

- Tests unitarios del slice (`create-invitation.test.ts` / `revoke-invitation.test.ts` / `pending-invitations-tab.test.tsx`) cubren EMISIÓN del token + revoke + listado. CONSUMO del token requiere route + page que no existían — sin ruta, no hay test que escribir.
- Tests SQL contra `app.accept_invitation` (migration 0003) verifican el primitive DB: existen desde S5b de la sesión de invitations DB (2025-12 al cerrar el slot). El primitive funciona; el wrapper TS + page consumidores son lo que falta.
- Smoke E2E manual nunca se ejecutó pre-deploy porque S12 estaba en pending; el push fue autorizado para iterar contra prod en paralelo al smoke (autorización explícita user 2026-05-25, "si haces el push puedo ir haciendo pruebas en vercel").

### Por qué V1.1 y no V2 ni hotfix

- **V1.1**: el flow accept es **completion del scope V1** que se planeaba pero no se implementó. La feature E V1 sin accept es no-shippeable a usuarios reales (los tokens emitidos son inertes). No es nueva capability — es cierre.
- **NO hotfix**: el cierre involucra ruta nueva + Client component + Server Action + i18n × 6 + ADR canónica + tests TDD. Eso es scope de feature, no de hotfix. El plan 7 sesiones (S0-S6) respeta el patrón de Features A-E.
- **NO V2**: no hay nueva capability conceptual — es el path de UX que ADR-0010 §2 ya enunciaba ("invitación SOLO por token-link; el invitado abre el link y se materializa membership").

## Decisión

### D1 — Route placement: subdomain proxy, NO `/[locale]/invite`

La ruta consumer del token vive en `src/app/(app)/place/[placeSlug]/invite/[token]/page.tsx` (zona-place, dentro del proxy de subdomain). El middleware de proxy (`src/middleware.ts`) reescribe `mi-place.place.community/invite/abc` → `/place/mi-place/invite/abc`. NO se crea ruta paralela en `src/app/[locale]/invite/[token]/` (zona marketing).

**Razón**:

1. **Cross-place tampering check natural**: con `placeSlug` en el path post-proxy, el RSC puede verificar `invitation.place_id` (vía `app.invitation_preview`) MATCH `placeSlug` antes de renderizar — si no matchea, retorna 404 (sin doxx — no se distingue "token de otro place" vs "token inexistente"). Defense-in-depth contra un attacker que copie el token de un place a la URL de otro.
2. **Branding del place visible**: el invitee ve la URL con el slug del place que lo invitó (`mi-place.place.community/invite/...`), consistente con el resto de la UX zona-place. Una ruta `/[locale]/invite/...` en marketing perdería ese contexto visual.
3. **i18n via place locale, no browser**: el namespace `placeInvitation` se carga con el locale del PLACE (`place.default_locale`), no del browser. Reusar el shell de zona-place garantiza el mismo locale loader que el resto de pages del place (ADR-0022).
4. **Forward-compat custom domains**: en Feature C (custom-domain-sso, deployada), un place con `custom_domain = nocodecompany.co` tiene su zona-place también en el custom domain. Una ruta zona-place hereda el routing — el link emitido desde un place con custom domain genera `https://nocodecompany.co/invite/{token}` automáticamente sin código nuevo.

### D2 — UX consent explícito: botón "Aceptar invitación", no auto-accept en GET

La page renderiza:
- **Header**: nombre del place + email invitado (`v_inv_email` del `invitation_preview`).
- **CTA principal**: botón "Aceptar invitación a {placeName}" (Server Action `acceptInvitationAction`).
- **CTA secundario** (autenticado): "No, gracias" — link a Hub canónico (placeSlug/inbox).

NO se ejecuta `acceptInvitation` automáticamente en el GET del page. Razón: ADR-0010 §2 caracteriza el token como **capability**, no como signed assertion de consent. El click del invitee es el acto de aceptación; un GET automático rompería el modelo (e.g. un preview de Slack/iMessage que abre la URL aceptaría sin intervención del invitee).

### D3 — Path unauthenticated: 2 CTAs (login + signup) con `returnTo` absoluto

Cuando el invitee abre el link sin sesión apex:
- La page renderiza el preview (no requiere auth — `app.invitation_preview` es DEFINER sin claim) + 2 CTAs:
  - **CTA Login**: `<a href="/login?returnTo=<URL absoluta del invite>">` — usa el flow apex existente (Feature A login).
  - **CTA Signup**: `<a href="/crear?returnTo=<URL absoluta del invite>">` — usa el flow apex `/crear`, **extendido en S5** para honrar `returnTo` post-signup (gap actual: `/crear` no honra returnTo).
- Ambos `returnTo` apuntan al URL **absoluto del invite** (no relativo) — porque post-login en apex, el redirect cruza zona apex → zona-place (subdomain del place que invita). El allowlist de `validateLoginReturnTo` (ADR-0033) se extiende en S2 para aceptar pattern `/invite/[token]` con same-registrable-domain.

### D4 — Email match estricto V1 (P0008): panel de error claro, NO auto-switch de cuenta

Si el invitee llega autenticado con un email distinto al de la invitación, `app.accept_invitation` retorna `P0008 el email no coincide con la invitación`. La page renderiza panel de error explícito:
- "Esta invitación es para `<inv_email>`. Estás autenticado como `<current_email>`."
- CTA "Cerrar sesión y entrar como `<inv_email>`" → link `/logout?returnTo=<URL invite>`.

V1 NO auto-switch de cuenta (no detecta multi-account, no propone switcher). Razón: el flow apex no soporta multi-account session; el "switch" es logout + re-login. UX-acceptable V1.

### D5 — Place lleno (P0009 ≥150): error claro, gap consciente V1.1

Si `app.accept_invitation` retorna `P0009 place lleno`, panel de error "Este lugar alcanzó su cupo máximo (150 miembros). Hablá con quien te invitó." Sin CTA de unblock V1 (V1.1+ podría agregar "Solicitar aumento de cupo" cuando exista ADR-0037 §V2 con UI).

### D6 — LOC cap bump: invitations/ 1500→1800

El slice `invitations/` está actualmente en **1497 LOC** (post-extract ADR-0041 + micro-cleanup -118 LOC). La adición V1.1:
- `acceptInvitationAction` (~55 LOC) + `map-accept-error.ts` (~55 LOC) + extensión `schemas.ts` (`acceptInvitationSchema`, +25 LOC) + tests (`accept-invitation.test.ts` ~75 LOC + `map-accept-error.test.ts` ~30 LOC + `schemas.test.ts` +15 LOC) + extensión `types.ts` (`AcceptInvitationError`, +15 LOC) + extensión `public.ts` (+10 LOC).
- Total proyectado: **+280 LOC** → slice cierra en ~1777 LOC, dentro del nuevo cap 1800.

**Justificación del bump** (no es relax del cap general, es sub-cap del slot DB `invitation`):

- ADR-0028 §"Política a futuro" criterios para promoción a slice propio: 3 cumplidos en V1 (cap + migration/spec propia + consumer cross-slice). Para una nueva extracción `invite-accept/`, los 3 NO se cumplirían: (a) sólo 280 LOC, muy por debajo del threshold; (b) consume las MISMAS migrations 0003 + 0018-0019 que `invitations/` ya consume — sin migration propia exclusiva; (c) consumer cross-slice único es el page S3 (mismo page que ya consume `invitations/` para create+revoke — no es ortogonal).
- Precedente: ADR-0032 §5 establece sub-cap 800 para `src/shared/lib/sso/` por la misma razón (cohesión del módulo > extracción artificial). El slot DB `invitation` justifica análogamente sub-cap 1800.
- Alternativa rechazada `invite-accept/` slice nuevo: viola ADR-0028, fragmenta el slot DB sin ganar boundary ESLint enforceable significativo (los símbolos accept se importarían sólo desde el page consumer; el barrel sería trivial).

Cap 1800 es estable post-V1.1 (sin proyección de growth: V1.2+ que extiende quota counter en `membership.invitations_used` toca otros archivos, no accept).

### D7 — NO migration nueva: consume DEFINER existentes

`app.accept_invitation(p_token text) RETURNS text` + `app.invitation_preview(p_token) RETURNS TABLE (...)` están en `src/db/migrations/0003_accept_invitation_fn.sql` desde el slot DB invitations original. Migration aplicada en producción. Las 7 SQLSTATEs (`28000`, `P0002`, `P0005`, `P0006`, `P0007`, `P0008`, `P0009`) son canónicas y mapeables 1:1 a `AcceptInvitationError`. V1.1 NO requiere migration nueva — la primitive DB ya es production-grade.

## Alternativas rechazadas

### 1. Ruta `/[locale]/invite/[token]` zona marketing (Opción descartada)

Montar la ruta en zona marketing (`src/app/[locale]/invite/[token]/page.tsx`) en lugar de zona-place. Rechazada:

- **Pierde cross-place tampering check natural**: sin `placeSlug` en path post-proxy, el RSC no puede verificar match DB ↔ URL → vulnerable a token-leak entre places. Defendible con check extra `place_slug` query param, pero introduce parameter creep + UX confusa (URL con query bizarro).
- **Branding del place perdido**: invitee ve `place.community/es/invite/...` (genérico marketing) en lugar de `mi-place.place.community/invite/...` (con identidad del place). Quiebra principio "el subdomain ES el place" del producto.
- **i18n con locale del browser, no del place**: zona marketing usa locale del Accept-Language; el invitee es alguien que el place invitó (probablemente comparte locale del place), no un visitante random del producto. Más sentido cargar `place.default_locale`.
- **Forward-compat custom domain rota**: places con custom domain perderían el branding (URL custom domain no rutea a `/[locale]/...` marketing).

### 2. Auto-accept en GET del page (Opción descartada)

Ejecutar `acceptInvitationAction` automáticamente en el render del page si hay sesión válida. Rechazada:

- **Rompe modelo capability + consent ADR-0010 §2**: el token es capability (lo que prueba que vos podés aceptar), no signed consent (lo que prueba que vos QUERÉS aceptar). El click es el acto de aceptación.
- **Vulnerable a preview-fetch auto-trigger**: bots de iMessage/Slack/Gmail abren URLs automáticamente para preview cards. Auto-accept aceptaría desde un preview-fetch del bot, no del invitee.
- **No-undo amplificado**: una vez aceptada (P0007 lock), revertir requiere logout+remove+re-invite. Click explícito reduce la tasa de aceptaciones accidentales.

### 3. Login redirect inmediato sin preview unauth (Opción descartada)

Cuando el invitee llega sin sesión, redirect inmediato a `/login?returnTo=...` sin renderizar preview. Rechazada:

- **Pierde transparencia**: el invitee no sabe a qué se está logueando hasta post-login. UX-hostil — mucha gente abandona si no entiende el contexto del login prompt.
- **`app.invitation_preview` justamente existe para esto**: la función DEFINER acepta llamada sin claim de auth, retornando place_slug + place_name + invitee_email. Era diseñada para preview unauth — no usarla desperdiciaría el primitive.
- **El email visible es feature, no bug**: invitations §2.1 documenta "(su propio inbox, no es fuga) para prefijar el form de aceptación". El invitee ya conoce el email — verlo confirma "sí, esta invitación es para mí".

### 4. Slice nuevo `invite-accept/` separado de `invitations/` (Opción descartada)

Extraer accept a slice propio en lugar de bumpear sub-cap de `invitations/`. Rechazada por las razones en §D6 (3 criterios ADR-0028 §"Política a futuro" no se cumplen).

### 5. Auto-switch de cuenta en P0008 email mismatch (Opción descartada V1)

Detectar mismatch + ofrecer auto-switch de account sin requerir logout explícito. Rechazada:

- **Out of scope V1**: el flow apex no soporta multi-account session (cookie Neon Auth = 1 user activo). Switch = logout + re-login. Implementar "switcher" introduce sub-feature de multi-account fuera del scope V1.1.
- **UX-acceptable sin switcher**: el panel claro "Esta invitación es para X. Estás logueado como Y. Cerrá sesión y entrá como X" es directo. V1.1 user feedback determinará si vale la pena un switcher V1.2+.

### 6. Implementar quota V2 + place full unblock UI en V1.1 (Opción descartada)

Aprovechar para implementar `place.member_invite_quota` UI + counter `membership.invitations_used` (ADR-0037 §V2). Rechazada:

- **Scope creep**: ADR-0037 §V2 es decisión propia con su propia ADR/spec eventual. Mezclar acá rompe boundaries.
- **V1 ships schema-only por design**: ADR-0037 §"V1 schema-only" es deliberado. V1.1 honra esa decisión.

## Consecuencias

### Positivas

1. **Feature E V1 deja de ser inerte**: tokens emitidos en producción se vuelven accionables. Cierra el gap E2E del flow members.
2. **Pattern reusable para futuras URLs capability-based**: la combinación route+preview-RSC+consent-button+returnTo-aware login establece template para futuras capabilities (e.g. invite a co-owner V1.1, magic-link de recovery, etc.).
3. **Allowlist de `validateLoginReturnTo` extendido sin debilitar política**: el nuevo pattern `/invite/[token]` es un add explícito + same-registrable-domain para absolutos, NO un wildcard. Mantiene la propiedad anti-open-redirect.
4. **Cross-place tampering defended structurally**: el match `placeSlug` ↔ `invitation.place_id` en RSC es defense-in-depth incluso si un attacker copia tokens entre places.
5. **`/crear` returnTo support beneficia más allá de invites**: futuros flows post-signup (e.g. magic-link onboarding) reusan el handler returnTo de S5.
6. **Sin migration nueva → sin riesgo DB**: V1.1 es 100% código de aplicación + i18n. Rollback = `git reset --hard baseline/pre-feature-e-invite-accept`.

### Neutras

1. **Sub-cap LOC bump invitations/ 1500→1800**: documentado, justificado, con criterio ADR-0028 §"Política a futuro" como guardrail. Si V1.2+ proyecta más growth, se evaluará split en ese momento.
2. **Email visible en preview unauth**: documentado in-line en migration 0003:23 ("su propio inbox, no es fuga"). El invitee VE su propio email — no information leak hacia terceros (el token NO es indexable, sólo lo tiene el invitee).
3. **Click obligatorio**: cualquier flujo automatizado de aceptación (tests E2E, scripts de onboarding bulk) requiere POST a la Server Action — no GET-only. Aceptable porque V1 no anticipa estos flujos.

### Negativas

1. **Multi-account switching ausente V1**: invitee con varias cuentas en el mismo browser tiene que hacer logout + re-login para aceptar como la account correcta. Mitigation: panel de error claro + CTA logout pre-cargado con `returnTo` apuntando al invite. V1.2+ evaluar switcher si user feedback lo demanda.
2. **Place full sin unblock UI**: invitee llega a un place al cap 150, ve mensaje "está lleno", sin acción inmediata. Mitigation: copy CTA "Hablá con quien te invitó" + log evento `invite_accept_place_full` (futuro telemetry). V1.1+ evaluar UI con ADR-0037 §V2.

## Plan de implementación

7 sesiones (S0-S6) con guardrails idénticos a Features A-E (production-grade, LOC estrictos, TDD obligatorio, save point pre-feature, commit pre-sesión, compact pre-sesión, tag por sesión).

- **S0** (esta sesión): docs setup — ADR-0044 + `docs/features/invitations/{spec,plan-sesiones,tests}.md` + rebaseline `docs/features/members/spec.md` §Smoke step 3 + entry en `decisions/README.md`.
- **S1**: `acceptInvitationAction` + `map-accept-error.ts` + `acceptInvitationSchema` + tests (`accept-invitation.test.ts` + `map-accept-error.test.ts` + extensión `schemas.test.ts`) + extensión `types.ts` (`AcceptInvitationError`) + extensión `public.ts`. 5-6 files, ~280 LOC + ~75 LOC modificadas.
- **S2**: extensión `validateLoginReturnTo` para pattern `/invite/[token]` + tests. 3 files, ~115 LOC + ~25 LOC modificadas.
- **S3**: `(app)/place/[placeSlug]/invite/[token]/page.tsx` (RSC) + `_components/invite-acceptance-panel.tsx` (Client) + `_lib/get-invitation-meta-by-token.ts` (PURE helper para tampering check) + RTL del panel. 4 files, ~590 LOC.
- **S4**: i18n nuevo namespace `placeInvitation` × 6 locales (es/en/fr/pt/de/it). 5 agentes paralelos para los 5 non-es (es lo escribe yo primero como source-of-truth). Plus `src/i18n/messages-loader.ts` extensión + `check-translations` re-baseline.
- **S5**: `/crear` honra `returnTo` post-signup (extensión `src/app/[locale]/crear/page.tsx` + handler post-signup). ~80 LOC + ~40 LOC modificadas.
- **S6**: smoke E2E manual contra producción + write-back evidencia en spec.md + plan-sesiones §Status + push autorizado + tag `baseline/feature-e-invite-accept-done`.

**Save point pre-V1.1**: `baseline/pre-feature-e-invite-accept` = `7ab4d26` (post Feature E S11 done + prod deployed). Rollback total: `git reset --hard baseline/pre-feature-e-invite-accept`.

**Guardrails entre sesiones** (canon user explicitado pre-S0):

- Agentes en paralelo SOLO en files ortogonales. Cuando dos sesiones tocan el mismo file (e.g. S1 + S2 ambas extienden `public.ts`), el orquestador (yo) hace el merge serialmente.
- Agentes NUNCA modifican shared files que otros agentes consumen — yo creo los shared antes de spawn los consumers.
- Pre-sesión: `git status --short` clean + typecheck verde + suite verde. Si no, debug antes de spawn.
- Post-sesión: commit con mensaje canónico + tag `baseline/feature-e-invite-accept-s<N>-done` + push diferido a S6.

## Pointers operacionales

- **Save point pre-V1.1**: `baseline/pre-feature-e-invite-accept` = `7ab4d26` (Feature E S11 done + prod deployed `dpl_J5QcmBYmLQENi9yz8owK5j8eCt4N`).
- **Tag final V1.1**: `baseline/feature-e-invite-accept-done` (asignado en S6 post-push).
- **DEFINER primitives consumidas (sin migration nueva)**:
  - `app.invitation_preview(p_token text) RETURNS TABLE (place_slug, place_name, invitee_email)` — `src/db/migrations/0003_accept_invitation_fn.sql:24-46`.
  - `app.accept_invitation(p_token text) RETURNS text` — `src/db/migrations/0003_accept_invitation_fn.sql:57-111`.
  - 7 SQLSTATEs: `28000` no autenticado · `P0002` app_user inexistente · `P0005` invitación inexistente · `P0006` vencida · `P0007` ya usada (test-and-set atómico) · `P0008` email mismatch case-insensitive · `P0009` place lleno ≥150.
- **Slice consumidos**:
  - `src/features/invitations/` — accept se monta acá (sub-cap 1800 post-V1.1).
  - `src/shared/lib/sso/validate-login-return-to.ts` — allowlist extendido (Server S2).
  - `src/app/[locale]/crear/page.tsx` — returnTo handler extendido (S5).
- **Bug evidence completa**:
  - Neon prod query: token existe en `invitation` table, válido y aceptable.
  - Vercel runtime logs: `GET /invite/49e100... 404`.
  - Codebase grep: 0 archivos definen ruta `invite/[token]`.
- **Spec del feature**: `docs/features/invitations/spec.md` (creada en S0).
- **Plan de sesiones operativo**: `docs/features/invitations/plan-sesiones.md` (creada en S0).
- **Tests checklist por sesión**: `docs/features/invitations/tests.md` (creada en S0).
- **Write-back canónico Feature E**: `docs/features/members/spec.md` §"Smoke verification" step 3 — corrige el "flow de Feature C" erróneo → punta a `docs/features/invitations/spec.md` §"Flow accept".
- **ADRs relacionadas no superseded**:
  - ADR-0010 §2 (capability + token-link) — instanciada por V1.1 consumer.
  - ADR-0033 (apex login returnTo allowlist) — extendido por S2.
  - ADR-0034 (zone-aware DB helper) — `acceptInvitationAction` usa `getAuthenticatedDbForRequest` por canon.
  - ADR-0037 (member invite quota V1 schema-only) — V1.1 honra el V1 (no toca counter ni UI quota).
  - ADR-0041 (extract invitations slice) — sub-cap bump 1500→1800 documentado acá.
