# 0046 — Invite Accept Flow V1.2: cross-domain coherence (zone-aware URL + branding apex + silent SSO post-credential)

- **Fecha:** 2026-05-26
- **Estado:** Aceptada
- **Alcance:** wire ortogonal al canon V1.1 cerrado (ADR-0044 + S6 close). Touches: helper nuevo `buildPlaceCanonicalUrl` + wrapper `lookupCustomDomainBySlug` en slice `custom-domain` (Feature A barrel extension) · prop nueva `inviteContext` en `<AccessFlow>` (slice `access`, sin bump de cap por archivo) · params nuevos `?invite={token}` en `(marketing)/[locale]/login/page.tsx` + `(marketing)/[locale]/crear/page.tsx` con lookup `app.invitation_preview` server-side · re-wire del callsite del modal `<InviteMemberModal />` (`settings/members/page.tsx`) + del link interno del invite page (`invite/[token]/page.tsx`) · i18n namespace `access` extendido con keys de branding × 6 locales · smoke E2E matriz 2x2 (con/sin custom domain × visitor logged/unlogged). **NO migration nueva** (consume `place_domain.verified_at` + `app.invitation_preview` ya existentes). **NO cambios al contrato `sso-issue`** (G-B1 cerrado: el handler `src/app/api/auth/sso-issue/route.ts:213-216` ya soporta el caso "sesión apex válida + ticket emit + redirect a redeem"; el cambio V1.2 es WHO lo invoca).
- **Habilita:** que un place CON custom domain (`nocodecompany.co`) emita un invite link que el invitee abre, autoriza, y consume **íntegramente en el custom domain** salvo el credential entry (que necesariamente vive en apex por constraint técnica RFC 6265 §5.4 + Neon Auth managed — ver §"Diagnóstico técnico"). El credential entry en apex se enriquece con branding del place inviting (texto + nombre, sin logo V1.2) para preservar la percepción "estás dentro del flujo de este place". Post-credential, silent SSO devuelve al invitee al custom domain donde acepta + aterriza en el Hub canónico del place — todo bajo el dominio que el owner configuró para su comunidad. Para places SIN custom domain, el flow V1.1 actual (subdomain `mi-place.place.community`) queda intacto sin regresión.
- **Refina:** ADR-0044 (Invite Accept Flow V1.1) §D3 ("Path unauthenticated: 2 CTAs login + signup con `returnTo` absoluto") — V1.2 mantiene los 2 CTAs pero los redirige a un login apex con `?invite={token}` que dispara branding + post-credential silent SSO cuando aplica. §D3 sigue siendo canon para places sin custom domain (subdomain canónico flow). · ADR-0033 (apex login honra `?returnTo`) — V1.2 añade un nuevo destino válido del `returnTo`: la URL del `sso-issue` apex (que ya está en el allowlist desde Feature C; sin extender política). El cambio operativo es que el redirector post-login ahora puede construir un `returnTo` que apunta a `sso-issue` con `aud=<customDomainHost>` cuando el invite es para un place con custom domain. · ADR-0032 (Custom Domain SSO Signed Ticket) — V1.2 reusa el contrato existente como bloque. El handler `sso-issue` (S7) ya valida sesión apex + emite ticket + redirige al redeem custom domain. V1.2 sólo agrega un NUEVO invocador (el handler post-credential del login apex con `?invite=`), sin tocar el contrato del Signed Ticket ni la firma ni el JWKS.
- **No supersede:** ADR-0001 (topología auth dos mundos — preservada explícitamente) · ADR-0008 §2/§4 ("cuenta sin place" estado legítimo; signup NO siembra `app_user`) — V1.2 mantiene la canon; el `ensureAppUser` TX 1 fix del S6 close (gotcha `accept-invitation-requires-ensure-app-user-tx1`) sigue en pie · ADR-0010 §2 (invitation token-link + consent explícito) · ADR-0021 (member-read RLS) · ADR-0026 (Feature A custom domain V1) · ADR-0031 (Feature B custom-domain routing) · ADR-0032 (Feature C SSO — contrato intacto) · ADR-0033 (apex login `?returnTo` allowlist intacto) · ADR-0034 (zone-aware DB helper — `acceptInvitationAction` usa `getAuthenticatedDbForRequest` que dispatcha al verifier correcto según zone, ya cubre el caso "accept ejecutado desde cookie SSO local") · ADR-0037 (member invite quota schema-only) · ADR-0041 (extract invitations slice — sub-cap 1800 sin cambio en V1.2) · ADR-0044 §D1/§D2/§D4-D7 (no tocadas — sólo §D3 refinada).

Las ADR son registro histórico: no se editan, se reemplazan con una nueva ADR que la supersede.

## Contexto

### El UX problem detectado post-S6 close

El smoke E2E del S6 close (`docs/features/invitations/spec.md` §"Smoke ejecutado 2026-05-26") validó que el flow accept funciona end-to-end **para el caso subdomain canónico** (visitor → `mi-place.place.community/invite/{token}` → login apex → vuelta al subdomain → accept → Hub). El user al observar el flow reportó (literal): *"todo el proceso se realiza en diferentes URL […] Esto genera una desconfianza terrible porque el usuario jamás sabe dónde está de verdad"*.

El problema es estructural en V1.1: el invite link emitido **ignora** si el place tiene custom domain. Un place con `place_domain.verified_at` (e.g. `nocodecompany.co`) emite invites con URL `mi-place.place.community/invite/{token}` — el invitee aterriza en un dominio que NO reconoce (vs el `nocodecompany.co` que el owner publicita públicamente). Post-credential, vuelve al subdomain — nunca al custom domain. El owner que invirtió en su custom domain pierde la coherencia de marca exacto en el momento de mayor confianza requerida (incorporación de nuevos miembros).

### Diagnóstico técnico (G-B1) — qué SE puede y qué NO se puede mover a custom domain

Lectura completa de ADR-0032 + RFC 6265 §5.4 + arqueología del handler `src/app/api/auth/sso-issue/route.ts`:

1. **`sso-issue` REQUIERE sesión apex.** Líneas 213-216 del handler: `getSessionJwt()` → null = `redirectToApexLogin`. El ticket Signed Ticket se emite SÓLO si el caller (server) puede verificar la cookie Neon Auth (`Domain=.place.community`) en el request. La cookie es propiedad EXCLUSIVA del registrable apex.

2. **RFC 6265 §5.4 (cookie scope per-registrable-domain) es ley del browser.** Un endpoint cualquiera bajo `nocodecompany.co` NO puede emitir Set-Cookie con `Domain=.place.community` — el browser lo descarta silently. **Esto significa que NO existe forma de crear sesión Neon Auth desde el origin del custom domain** sin reescribir el contrato de la cookie (que es propiedad de Neon Auth managed, fuera de nuestro control).

3. **Neon Auth managed no expone API de "session-establish from external assertion".** Auditoría 2026-05-26: el SDK provee `signIn`/`signUp` browser-side (que internamente hacen credential POST a `*.place.community` + Set-Cookie scoped apex), pero NO un endpoint server-side para "create session for user X without password" tipo OAuth2 token exchange. Sin esa primitiva, no se puede convertir una sesión SSO local (`__Host-place_sso_session` en custom domain) en una sesión apex Neon Auth — el cripto va siempre apex → custom (una dirección, S7 issue → S8 redeem), no al revés.

**Conclusión técnica**: el credential entry (login + signup) **DEBE ejecutarse en el origin del apex** porque la cookie destino vive ahí. La interpretación *estricta* de "todo en custom domain" es imposible sin construir cripto nueva fuera del scope V1.2 (e.g. un Neon Auth shim que aceptemos delegar, que no existe API hoy).

### Lo que SÍ se puede mover (interpretación pragmática)

Tres piezas del flow accept se pueden ejecutar en custom domain SIN tocar cripto:

1. **URL emission del invite**: el modal `<InviteMemberModal />` puede emitir `nocodecompany.co/invite/{token}` en vez de `mi-place.place.community/invite/{token}` consultando `place_domain.verified_at` server-side.

2. **Render del preview + CTA Aceptar**: la page `invite/[token]/page.tsx` ya funciona en custom domain (el proxy reescribe el host); `app.invitation_preview` es DEFINER sin claim, retorna preview sin auth. **Ya funciona V1.1**.

3. **Post-credential → vuelta al custom domain**: tras login successful en apex con `?invite={token}`, en lugar de redirigir al Hub apex hardcoded, redirigir a `/api/auth/sso-issue?aud={customDomainHost}&returnTo=/invite/{token}` — el SSO existente (S7-S8) cripta la cookie local en el custom domain, deja al invitee en `nocodecompany.co/invite/{token}` con sesión local, y la action accept ya es zone-agnostic (ADR-0034 cubre).

Lo que sigue siendo *visible* en apex: ~5 segundos de credential entry (form login/signup). Para mitigar la sensación "te fuiste", el login apex se enriquece con branding del place inviting (texto + nombre del place) — el modelo Circle/Discourse (ADR-0032 §A4 reference) donde "el form de credential se ve como del place que te invitó aunque viva en el SSO provider".

### Por qué V1.2 y no V2 ni hotfix

- **V1.2**: cierre de la coherencia UX del flow V1.1 (que dejó deuda UX explícita el día del smoke). NO es nueva capability — es la diferencia entre "el accept funciona" y "el accept se percibe coherente cuando el place tiene custom domain". El flow V1.1 sin V1.2 es shippeable pero degradado para places con custom domain configurado.
- **NO hotfix**: el cierre involucra 5 sesiones (S0-S4) con scope distribuido (helper nuevo + branding + silent SSO + smoke matriz). Patrón canon de Features A-E.
- **NO V2**: no hay nueva capability conceptual. V2 sería e.g. "form de login custom auto-completed con email del invite" (autofill) o "logo del place en branding apex" (requiere column nueva). V1.2 es text-only branding + zone-aware emission.

## Decisión

### D1 — Zone-aware URL emission via `buildPlaceCanonicalUrl(slug)`

Helper nuevo en `src/shared/lib/auth-redirect.ts`:

```typescript
/**
 * Resuelve la URL canónica de un place según su zone configurada.
 * - Si `place_domain.verified_at IS NOT NULL` → `https://nocodecompany.co{path}`.
 * - Sino → `https://{slug}.place.community{path}` (subdomain canónico).
 *
 * Memoizado per-request via React.cache (consume el wrapper Feature A
 * `lookupCustomDomainBySlug` que también está cacheado).
 */
export const buildPlaceCanonicalUrl = cache(async (opts: {
  slug: string;
  path?: string;
}): Promise<string> => {
  const customDomain = await lookupCustomDomainBySlug(opts.slug);
  if (customDomain) {
    const path = (opts.path ?? "/").startsWith("/") ? (opts.path ?? "/") : `/${opts.path}`;
    return `${apexScheme()}://${customDomain}${path}`;
  }
  return buildSubdomainCanonicalUrl(opts);  // fallback al helper existente
});
```

**Wrapper Feature A nuevo `lookupCustomDomainBySlug(slug): Promise<string | null>`** en `src/features/custom-domain/server/lookup.ts` (o paralelo a `lookupPlaceByDomain` existente). Query: `SELECT domain FROM place JOIN place_domain ON place_domain.place_id = place.id WHERE place.slug = $1 AND place_domain.verified_at IS NOT NULL LIMIT 1`. **Memoizado con `React.cache`** per-request (mismo pattern que `lookupPlaceByDomain`). Public barrel `src/features/custom-domain/public.ts` extendido con export.

**2 callsites wire**:
- `src/app/(app)/place/[placeSlug]/settings/members/page.tsx:204` — el modal `<InviteMemberModal />` recibe `placeCanonicalUrl` como prop pre-resuelta (server-side en RSC) en lugar de `placeSubdomain`. **Backwards-compat**: el modal V1 acepta cualquier base URL.
- `src/app/(app)/place/[placeSlug]/invite/[token]/page.tsx:122,132,135` — los CTAs `login`, `signup`, `placeHomeUrl` se construyen via `buildPlaceCanonicalUrl({slug, path: ...})` en lugar de hardcode apex/subdomain.

**Por qué async + React.cache (NO sync)**: la lookup va a DB. `cache()` hace que múltiples llamadas en el mismo render (e.g. invite page + branding del header) compartan una sola query. Pattern canon ya usado por `lookupPlaceByDomain` en Feature B.

**Por qué helper nuevo (NO inline en cada page)**: invariante DRY + futuras pages que emitan URL del place reusan el helper. Single source of truth para la decisión zone-aware.

### D2 — Apex login/signup branding text-only via `inviteContext`

El componente `<AccessFlow>` (`src/features/access/ui/access-flow.tsx`, 249 LOC actuales) recibe prop nueva opcional:

```typescript
inviteContext?: {
  placeSlug: string;
  placeName: string;
  /** URL pre-resuelta server-side donde navegar tras success.
   *  - Place con custom domain: `https://place.community/api/auth/sso-issue?aud=<host>&returnTo=/invite/<token>&state=<>&nonce=<>`.
   *  - Place sin custom domain: `https://<slug>.place.community/invite/<token>` (subdomain canon).
   *  NUNCA confiar en este input client-side sin validación server-side previa
   *  — mismo principio que `returnTo` (ADR-0033). */
  postCredentialUrl: string;
};
```

**Renderizado condicional**:
- Si `inviteContext === undefined` (path actual V1): comportamiento intacto.
- Si `inviteContext !== undefined`: header reemplaza `<h1>{l.title}` por `<h1>{l.inviteTitle.replace('{placeName}', inviteContext.placeName)}</h1>` (e.g. "Te invitan a unirte a Nocode Company"). El subtitle se reemplaza por copy invite-specific (e.g. "Ingresá tu correo para aceptar la invitación").

**`onSuccess` override**: cuando `inviteContext !== undefined`, en lugar de `navigate(returnTo ?? hubDefault)`, navega a `inviteContext.postCredentialUrl`. La decisión de zone-aware ya se tomó server-side (en la page que renderiza `<AccessFlow>`); el Client NO toma decisiones DB-aware — solo navega lo que recibe.

**Lookup server-side en `(marketing)/[locale]/login/page.tsx` + `(marketing)/[locale]/crear/page.tsx`**: cuando `searchParams.invite` está presente, la page server-side:
1. Llama `app.invitation_preview(token)` para obtener `placeSlug` + `placeName` + `invitee_email`.
2. Si retorna null (token inválido/expirado/usado) → render normal sin branding (defense-in-depth: NO leak "este token no existe").
3. Si retorna válido → construye `postCredentialUrl` via `buildPlaceCanonicalUrl({slug: placeSlug, path: '/invite/' + token})` para places sin custom domain, o via `sso-issue` builder helper nuevo para places con custom domain.
4. Pasa `inviteContext` al `<AccessFlow>`.

**Tampering-safe by structure**: el `placeName` viene del DEFINER lookup del token, NO de URL param separable. Un attacker puede manipular `?invite={fakeToken}` pero `invitation_preview(fakeToken)` retorna null → no branding renderizado. NO hay forma de inyectar branding falso sin tener un token válido.

**Sin logo V1.2** (G-B3): la tabla `place` no tiene columna `logo_url`/`icon` (schema verificado 2026-05-26 — solo `name`, `description`, `theme_config jsonb`). Agregar logo requiere migration + storage + UI de upload (scope V1.3+). V1.2 ships text-only branding ("Te invitan a unirte a {placeName}") como mínimo viable que ya cierra el 80% del problema percibido.

### D3 — Hide login/signup toggle en invite path

El `<AccessFlow>` cuando `inviteContext !== undefined` esconde el grupo de botones `<div role="group">` (lines 88-108 del componente actual) que permite switchear entre tabs login y signup. El user llegó vía un CTA específico (CTA Login o CTA Signup desde el invite page) — la opción contraria NO le sirve en este flow.

**Por qué hide y no disable**: hide reduce visual noise + transmite "estás en un flow específico, no decision-paradox". Disable mantendría el control visible pero gris — peor UX que ausencia.

**Backwards-compat**: cuando `inviteContext === undefined` (path actual V1, signup desde landing, login directo, etc.) el toggle queda visible — comportamiento intacto.

**Nota: el "crear cuenta" toggle NO es "crear place"** — el user confirmó con screenshot 2026-05-26 que el form actual NO ofrece "crear place" como opción visible en el `<AccessFlow>` (esa opción vive en `/crear` que es page separada). Por lo tanto D3 solo aborda el toggle login↔signup, no un toggle inexistente "crear place".

### D4 — Silent SSO post-credential para places con custom domain

Cuando un place tiene `place_domain.verified_at` Y el invite se emitió para ese place, el `postCredentialUrl` (D2) apunta a:

```
https://place.community/api/auth/sso-issue?aud=<customDomainHost>&returnTo=/invite/<token>&state=<>&nonce=<>
```

donde `state` + `nonce` se generan en la page server-side (NO en el handler `sso-init` — V1.2 reusa el subset del flow sin pasar por init porque ya estamos en apex con sesión válida tras el login).

**Sub-decisión: `state` + `nonce` se setean en cookie host-only `__Host-place_sso_state` PERO scoped al apex (no al custom domain)**. Wait — re-evaluación: el redeem en custom domain valida `state` cookie scoped al custom domain (no apex). Esto significa que el state cookie debe ser seteado por un endpoint del custom domain ANTES del sso-issue.

**Refinamiento del flow**: en lugar de saltar `sso-init`, el `postCredentialUrl` apunta a:

```
https://<customDomainHost>/api/auth/sso-init?returnTo=/invite/<token>
```

El `sso-init` (S8 Feature C) ya:
1. Setea state cookie `__Host-place_sso_state` host-only en el custom domain.
2. Redirige a `https://place.community/api/auth/sso-issue?aud=<host>&state=<>&nonce=<>&returnTo=<>`.
3. `sso-issue` emite ticket (la cookie apex Neon Auth está fresca tras el login — pasa el check de sesión).
4. Redirige al `sso-redeem` en custom domain con ticket.
5. `sso-redeem` valida + mintea cookie local + redirige a `/invite/{token}` en custom domain.

**4 redirects HTTP** (canon ADR-0032 §8): apex login post → custom-domain init → apex issue → custom-domain redeem → page invite. Sub-segundo en redes normales (ADR-0032 §"Cost budget post-C" valida p95 < 400ms).

**Para places SIN custom domain**: `postCredentialUrl` apunta directamente a `https://<slug>.place.community/invite/{token}`. La cookie `.place.community` se propaga al subdomain automáticamente (cross-subdomain canon, ADR-0001 §1). Sin SSO necesario.

**Pre-condición CRÍTICA**: `validateLoginReturnTo` (ADR-0033) ya permite `/api/auth/sso-init` (allowlist verificado en `src/shared/lib/sso/validate-login-return-to.ts`). G-B2 confirmado sin cambios.

### D5 — `sso-issue` contrato sin cambios (G-B1 cerrado)

El handler `src/app/api/auth/sso-issue/route.ts` (Feature C S7) ya soporta el caso "sesión apex válida + ticket emit + redirect a redeem". V1.2 NO modifica:

- El runtime config (`runtime = 'nodejs'`, `dynamic = 'force-dynamic'`).
- El zod schema (`querySchema`: `aud` + `state` + `nonce` + `returnTo`).
- La validación de `aud` (`lookupPlaceByDomain` Feature B).
- La validación de sesión apex (`getSessionJwt` + `verifyAccessToken`).
- El `mintTicket` (claims canónicas + ES256 sign + 60s TTL).
- El redirect 302 al `sso-redeem`.

El único cambio operativo es WHO invoca `sso-init` → `sso-issue`: pre-V1.2, solo el silent SSO desde un visit a custom domain (Feature C usecase canon). Post-V1.2, también el handler post-credential del login apex con `?invite=<token>` cuando el place inviting tiene custom domain.

**Implicación operacional**: V1.2 NO toca el sub-cap LOC `src/shared/lib/sso/` (1400 LOC, ADR-0032 §5 addenda). Ni un byte del módulo SSO se modifica.

### D6 — `acceptInvitationAction` zone-agnostic ya (ADR-0034 cubre)

El handler `src/features/invitations/actions/accept-invitation.ts` (post S6 close, commit `c13fcfd`) usa `getAuthenticatedDbForRequest` para AMBAS transacciones (TX 1 ensureAppUser + TX 2 DEFINER). Este helper coordinador (ADR-0034) dispatcha al verifier correcto según `HostZone`:

- Apex/subdomain: verifica cookie Neon Auth (`Domain=.place.community`).
- Custom domain: verifica cookie SSO local (`__Host-place_sso_session`).

**V1.2 NO requiere cambio de código en la action**. La invariante "todo Server Action zone-agnostic usa el coordinator" (ADR-0034) ya cubre el caso V1.2: tras la cadena init→issue→redeem, el invitee tiene cookie SSO local en `nocodecompany.co`; click "Aceptar" dispara la action que `getAuthenticatedDbForRequest` resuelve al verifier SSO local → `claims.sub` extraído → `ensureAppUser` + `app.accept_invitation` ejecutan con identidad correcta.

**Sesión D smoke verifica este path empíricamente** — no se asume, se mide con Neon evidence.

### D7 — Backwards-compat 100% para places sin custom domain

Toda la lógica zone-aware se activa SOLO si `place_domain.verified_at IS NOT NULL` para el place del token. Para places sin custom domain configurado:

- `buildPlaceCanonicalUrl({slug, path})` retorna `https://{slug}.place.community{path}` (fallback al `buildSubdomainCanonicalUrl` existente).
- El `postCredentialUrl` apunta al subdomain canon directo, sin SSO.
- El branding apex se renderiza igual (text-only "Te invitan a unirte a {placeName}") — la mejora UX aplica a TODOS los places, sea con o sin custom domain.
- El toggle login/signup hide aplica también.

**Cero regresión**: places que no configuraron custom domain ven el mismo flow técnico V1.1 (modulo el branding apex y el toggle hide, que son mejoras puras del invite path).

## Alternativas rechazadas

### α — Full custom domain (signup/login también en `nocodecompany.co`)

Mover el credential entry al custom domain. **Imposible técnicamente sin reescribir cripto fuera de scope V1.2**:

1. **RFC 6265 §5.4**: un Set-Cookie emitido desde `nocodecompany.co` con `Domain=.place.community` es rechazado silently por el browser. Neon Auth requiere cookie scoped al apex.
2. **Neon Auth managed sin API de delegate-session**: no existe primitiva server-side para "create session for user X via assertion" — el SDK solo expone `signIn`/`signUp` browser-side que internamente POSTean al apex.
3. **Construir un Neon Auth shim** (proxy custom domain → apex con re-Set-Cookie scope manipulation): viola el modelo de identidad ADR-0001 §2 + requiere mantener un shim que firma sesiones independientes (escope superior a V1.2; potencialmente V2 si se justifica).

Documentado como constraint estructural en §"Diagnóstico técnico" arriba.

### β — Status quo (no cambiar nada; apex login sin branding, subdomain post-login always)

Mantener V1.1 sin más cambios. Rechazada:

- El user identificó explícitamente la degradación UX como "desconfianza terrible". Ignorarla viola `feedback_production_minded` (V1.2 = production grade, sin gaps conscientes shippeables).
- El cost técnico de V1.2 (5 sesiones, ~600 LOC totales code + docs) es modesto vs el beneficio UX para places con custom domain (segmento que invirtió en marca propia).

### γ — Solo D1 (URL emission zone-aware, sin branding apex ni silent SSO)

Implementar SOLO el helper `buildPlaceCanonicalUrl`: el invite link se emite con custom domain, pero post-login el invitee vuelve al subdomain canon. Rechazada:

- Resuelve menos del 50% del problema percibido: el invitee ABRE el link en custom domain → ve `nocodecompany.co/invite/...` (mejora) → clickea Aceptar → redirigido a `place.community/login` (gap UX) → post-login redirigido a `mi-place.place.community/...` (gap UX, NO al custom domain).
- Crea una asimetría más confusa que el status quo: la URL del link es de un dominio, la URL del Hub es de OTRO dominio, sin explicación intermedia.

Solo-D1 es worse-than-nothing porque introduce esperanza falsa de coherencia.

### δ — Form de login/signup específico para invite (slice nuevo `invite-access/`)

User preguntó: *"si tener otro form de login/signup específico para los casos de invitación. No se como lo ves? total es copiar lo que ya tenemos, pero simplificar algunas cosas"*. Considerado y rechazado para V1.2:

- Duplicar `<AccessFlow>` viola DRY estructural. La diferencia entre "form general" y "form invite" se reduce a (1) hide del toggle + (2) header con branding + (3) `onSuccess` con redirect distinto. **Los 3 son props inyectables** sin duplicar componente.
- Slice `invite-access/` agregaría LOC + barriers ESLint adicionales sin beneficio cohesivo (la "feature" sería un wrapper trivial sobre `<AccessFlow>` extendido).
- Reusa `feedback_pre_plan_approval_gap_closure` canon: simplificar via props inyectables es production-grade; duplicar componentes es deuda técnica disfrazada de "claridad".

V1.2 implementa la simplificación CON props (D2 + D3) sobre el componente existente.

### ε — Logo del place en branding apex (V1.2 incluye column `place.logo_url` + UI upload)

User preguntó por "mostrar su icono o logo para que sepan que ese form es parte de ese place". Considerado y deferido a V1.3+:

- Schema `place` no tiene columna logo (verificado 2026-05-26: solo `name`, `description`, `theme_config jsonb`).
- Agregar logo requiere: migration nueva + storage backend (Cloudflare R2/S3/etc., aún TBD per `docs/stack.md`) + UI de upload + validación file type/size + tests + i18n del UI upload.
- Scope mínimo V1.3 estimado: ~400-500 LOC + 1 ADR del storage choice. Excede el time-budget V1.2.
- **V1.2 ships text-only branding como mínimo viable** que cierra el 80% del problema percibido (la sensación "este form es del place que me invitó" se obtiene principalmente del nombre + copy, no exclusivamente del logo).

V1.3 podría agregar logo cuando el storage TBD se cierre.

### ζ — Auto-accept post-SSO (skip el segundo click "Aceptar")

V1.1 §D2 canon: consent explícito requiere click. Post-SSO en V1.2, el invitee llega a `nocodecompany.co/invite/{token}` con sesión local y tiene que clickear "Aceptar" otra vez. Considerado auto-accept tras SSO success — rechazado:

- Viola ADR-0010 §2 (capability + consent explícito). El SSO valida AUTH; NO valida CONSENT al join. Confundirlos rompe el modelo.
- Vulnerable a el mismo edge case ADR-0044 §"Alternativas rechazadas #2" (preview-fetch de bots iMessage/Slack — aunque post-login es menos probable, no es imposible si el invitee dejó el tab abierto y compartió la URL).
- El doble click es mild friction, no UX-hostil; el invitee acaba de loguearse hace 2 segundos — el segundo click es perceptiblemente "el acto de aceptación", no fricción.

V1.2 preserva el click. Si user feedback V1.2+ demanda auto-accept, evaluar en su propia ADR.

### η — `state` + `nonce` generados en la page server-side (saltar `sso-init`)

Considerado en redacción inicial de D4 — rechazado en favor de pasar por `sso-init`:

- Saltar `sso-init` requiere setear cookie state desde apex con `Domain=.nocodecompany.co` (rechazado por browser, RFC 6265 §5.4 otra vez).
- `sso-init` ya hace exactamente lo que necesitamos: setea state cookie host-only en el custom domain + redirige a `sso-issue` apex.
- Reusar `sso-init` mantiene el contrato Feature C intacto y reduce surface area de cambio.

V1.2 navega a `sso-init` post-credential cuando aplica.

### θ — Migration nueva para `invitation_preview` retornar `place.theme_config`

Considerado incluir colores del place en branding apex (no solo nombre, también theme color del background). Rechazado V1.2:

- `theme_config jsonb` no tiene shape canon definido (es free-form). Renderizar colores arbitrarios en apex requiere validación + sanitization + fallbacks.
- Mismo argumento que ε (logo): mínimo viable text-only ya cierra el 80%. Theme color es deferido a V1.3+ cuando el shape de `theme_config` esté formalizado.

## Consecuencias

### Positivas

1. **Coherencia UX completa del flow accept para places con custom domain**: el invitee ABRE en custom domain → ve preview en custom domain → cuando es necesario va a apex con branding del place → post-credential vuelve al custom domain → acepta en custom domain → aterriza en Hub del custom domain. Los 4 momentos visibles (preview + branding-apex + accept + Hub) son del place; solo el credential entry tiene apex visible (~5s) con branding apex del place.
2. **Sin regresión para places sin custom domain**: el flow V1.1 actual queda intacto (subdomain canónico). La mejora del branding apex aplica también, sumando UX sin breaking.
3. **Pattern reusable para futuras pages con CTA cross-zone**: el helper `buildPlaceCanonicalUrl` + el `inviteContext` pattern del `<AccessFlow>` quedan como template para flows análogos (e.g. magic-link recovery V2, co-owner invite V1.1).
4. **Tampering-safe by structure**: el branding viene del token DEFINER, NO de URL params manipulables. Defense-in-depth sin necesidad de allowlist/sanitization adicional.
5. **Sin cripto nueva**: V1.2 reusa el contrato Signed Ticket existente (ADR-0032 S7-S8) sin tocar el sub-módulo SSO. Cero risk de regresión de seguridad.
6. **Sin migration nueva**: V1.2 es 100% código aplicación + i18n + docs. Rollback total = `git reset --hard baseline/feature-e-invite-accept-done`.

### Neutras

1. **Sub-cap LOC sin bump V1.2**: `access/` componente actual 249 LOC + bump ~35 LOC = 284 LOC ≤ cap 300 por archivo. NO requiere bump del cap.
2. **Custom-domain slice extendido con wrapper nuevo**: `lookupCustomDomainBySlug` agrega ~30-40 LOC al slice `custom-domain` (Feature A). El slice está actualmente en ~XXX LOC (medir en Sesión A pre-implementación); si overshoot del cap se detecta, bump con justificación documentada (precedente: ADR-0044 §D6 bump 1500→1800 invitations/).
3. **i18n namespace `access` extendido con keys de branding**: ~3 keys nuevas (`inviteTitle`, `inviteSubtitle`, `inviteAcceptHint`) × 6 locales = 18 entries. Sin namespace nuevo (extiende existente).
4. **`/login` y `/crear` ahora hacen 1 query DB extra cuando `?invite=` está presente**: `app.invitation_preview` lookup. Acceptable (DEFINER barato, single SELECT, sin auth check). Memoizado con `React.cache` per-request.

### Negativas

1. **Credential entry sigue en apex (~5s visible)**: la promesa "todo en custom domain" se relaja a "todo menos el form login/signup". Mitigation: branding apex (D2) reduce la disonancia. Si user reports persistent percepción de gap, evaluar V2 con shim Neon Auth custom domain (estimado fuera de scope, requiere ADR propia).
2. **Doble click en invite path cross-domain**: el invitee clickea "Aceptar" → login apex → vuelta al invite page → clickea "Aceptar" otra vez. Justified por consent explícito (ζ rechazada). Friction mild.
3. **Sin logo del place en branding apex**: text-only V1.2 (G-B3). Cuando V1.3 cierre el storage TBD, logo se agrega. UX gap mild.
4. **4 redirects HTTP post-credential vs 1 redirect (places sin custom domain)**: redes lentas en mobile podrían percibir lag sub-segundo en lugar de instant. Sub-segundo per ADR-0032 §"Cost budget post-C" — acceptable.

## Plan de implementación

5 sesiones (S0-S4) con guardrails canon Features A-E + reinforced V1.2 user-reaffirmed 2026-05-26: production-grade sin gaps, LOC estrictos, TDD obligatorio, save point pre-V1.2, commit pre/post-sesión, compact entre sesiones que ocupen ≥50% (memory `compact-between-sessions-50pct`), tag por sesión.

- **S0** (esta sesión): docs setup — ADR-0046 (este archivo) + entry en `decisions/README.md` + update de `docs/features/invitations/spec.md` §"Followups V1.2" (de "pendiente" a "S0 cerrado, plan en este ADR") + update `plan-sesiones.md` con tabla §Status V1.2.
- **S1 (Sesión A)** — URL emission zone-aware: helper nuevo `lookupCustomDomainBySlug` en slice `custom-domain` + helper `buildPlaceCanonicalUrl` en `auth-redirect.ts` + wire 2 callsites + tests. ~80 LOC + ~40 LOC tests. Commit + tag `baseline/feature-e-invite-v1.2-s-a-done`.
- **S2 (Sesión B)** — `inviteContext` branding + toggle hide: extender `<AccessFlow>` con prop `inviteContext` + lookup `invitation_preview` en `(marketing)/[locale]/login/page.tsx` + `(marketing)/[locale]/crear/page.tsx` cuando `?invite=` + i18n keys × 6 locales + tests. ~70 LOC + i18n + ~50 LOC tests. Commit + tag.
- **S3 (Sesión C)** — Silent SSO post-credential: handler post-success del `<AccessFlow>` navega a `sso-init` del custom domain cuando aplica + builder helper `buildSsoInitUrlForInvite(opts)` server-side + integration con `app.invitation_preview` (resuelto en S2, ahora consumido para decidir target URL) + tests E2E del builder. ~150-200 LOC + ~100 LOC tests. Commit + tag.
- **S4 (Sesión D)** — Smoke E2E matriz 2x2 + push: smoke matriz (place con custom domain × visitor logged/unlogged + place sin custom domain × visitor logged/unlogged) + re-validar los 4 steps V1.1 deferidos (3/6/9/10) + write-back evidence en `spec.md` + push autorizado por turno + tag `baseline/feature-e-invite-v1.2-done`. ~80 LOC docs + push.

**Save point pre-V1.2**: `baseline/feature-e-invite-accept-done` = `627ad4c` (S6 close de V1.1, deploy `dpl_GBYXwwPDKkN1DtAdQPxQxuphPj11` READY en prod). Rollback total: `git reset --hard baseline/feature-e-invite-accept-done`.

**Guardrails entre sesiones** (canon reinforced 2026-05-26):

- Pre-sesión: `git status --short` clean + typecheck verde + suite verde. Si no, debug antes de empezar.
- Compact pre-sesión si la sesión recién cerrada ocupó ≥50% de ventana de contexto (`feedback_compact_between_sessions_50pct`).
- Post-sesión: commit con mensaje canónico + tag `baseline/feature-e-invite-v1.2-s<X>-done` + push diferido a S4.
- Sesiones cortas: si scope mid-sesión se infla, pausar + subdividir (canon `feedback_review_and_split_sessions`) antes de seguir. Precedente: S6.d.fix (V1.1) absorbido dentro de S6 porque era contenido (P0002 bug); si V1.2 detecta un bug que requiere refactor cross-feature, se hace sesión-bis separada.
- Diagnóstico antes de cada implementación: leer el código + verificar evidencia antes de modificar (canon `feedback_diagnose_before_fix`).
- TDD obligatorio (CLAUDE.md §"Durante la implementación"): tests primero, verificar que fallan, implementar, verificar que pasan.

## Pointers operacionales

- **Save point pre-V1.2**: `baseline/feature-e-invite-accept-done` = `627ad4c`.
- **Tag final V1.2**: `baseline/feature-e-invite-v1.2-done` (asignado en S4 post-push).
- **DEFINER primitives consumidas (sin migration nueva)**:
  - `app.invitation_preview(p_token text) RETURNS TABLE (place_slug, place_name, invitee_email)` — `src/db/migrations/0003_accept_invitation_fn.sql:24-46` (consumida por `/login` + `/crear` server-side cuando `?invite=`).
  - `app.accept_invitation(p_token text) RETURNS text` — `src/db/migrations/0003_accept_invitation_fn.sql:57-111` (consumida por `acceptInvitationAction`, sin cambio).
- **Slices consumidos**:
  - `src/features/custom-domain/` — wrapper nuevo `lookupCustomDomainBySlug` (Sesión A). Sub-cap LOC actual a medir; posible bump documentado en Sesión A si overshoot.
  - `src/features/access/` — extension `<AccessFlow>` con prop `inviteContext` (Sesión B). Sin bump cap (estimado 284 LOC ≤ 300).
  - `src/features/invitations/` — sin cambio de código (la action V1.1 cubre).
  - `src/shared/lib/sso/` — sin cambio (G-B1 + G-B2 + D5 confirmados).
  - `src/shared/lib/auth-redirect.ts` — helper nuevo `buildPlaceCanonicalUrl` (Sesión A).
- **Pages tocadas**:
  - `src/app/(marketing)/[locale]/login/page.tsx` — extension `?invite=` lookup + `inviteContext` prop al `<AccessFlow>` (Sesión B).
  - `src/app/(marketing)/[locale]/crear/page.tsx` — extension `?invite=` lookup + `inviteContext` prop al `<AccessFlow>` (Sesión B).
  - `src/app/(app)/place/[placeSlug]/settings/members/page.tsx` — wire al `buildPlaceCanonicalUrl` (Sesión A).
  - `src/app/(app)/place/[placeSlug]/invite/[token]/page.tsx` — wire al `buildPlaceCanonicalUrl` (Sesión A).
- **Smoke matriz V1.2 (Sesión D)**: 2x2 escenarios canónicos:
  1. Place SIN custom domain × visitor logged (subdomain canon flow, V1.1 path).
  2. Place SIN custom domain × visitor unlogged (subdomain canon flow + apex login + branding apex, V1.2 mejora aplicable).
  3. Place CON custom domain × visitor logged (custom domain flow puro + accept directo, V1.2 happy path).
  4. Place CON custom domain × visitor unlogged (custom domain → apex login con branding → silent SSO → custom domain accept → Hub custom domain, V1.2 full flow).
- **Bug evidence completa V1.1 que motiva V1.2**:
  - User feedback literal post-S6 close: "todo el proceso se realiza en diferentes URL […] Esto genera una desconfianza terrible porque el usuario jamás sabe dónde está de verdad".
  - Smoke V1.1 §"Followups V1.2" en `docs/features/invitations/spec.md` documenta el gap UX explicitamente.
- **ADRs relacionadas no superseded**:
  - ADR-0001 (topología auth dos mundos — preservada).
  - ADR-0008 §2/§4 (signup NO siembra app_user — gotcha V1.1 S6 sigue en pie).
  - ADR-0010 §2 (capability + consent explícito — V1.2 honra).
  - ADR-0026/0031 (Features A+B custom domain — V1.2 consume wrappers).
  - ADR-0032 (Feature C SSO — contrato intacto, V1.2 reusa).
  - ADR-0033 (apex login returnTo allowlist — sin cambio, allowlist ya permite sso-init).
  - ADR-0034 (zone-aware DB helper — `acceptInvitationAction` cubre via coordinator).
  - ADR-0044 (V1.1 — §D3 refinada por V1.2, resto intacto).
  - ADR-0045 (V1.1 S5 signup CTA via `/login?mode=signup` — V1.2 extiende con `?invite=` adicional, mismo pattern).
