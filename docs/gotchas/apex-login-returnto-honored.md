# Apex login `/[locale]/login` debe honrar `?returnTo` para que el cold-start SSO desde custom domain aterrice en el path correcto

## Síntoma

El user no autenticado abre incógnito + navega a `https://nocodecompany.co/settings` (custom domain). El silent SSO dispara correctamente: page → `/api/auth/sso-init` → setea state cookie → redirect a apex `/api/auth/sso-issue` → detecta sin sesión Neon Auth → redirect a `https://www.place.community/{locale}/login?returnTo=<URL completa del sso-issue con query>`.

El user llena email + password + submit. Login exitoso. **Aterriza en `https://app.place.community/{locale}/` (Hub canónico) en lugar de continuar el flow SSO** (que requeriría volver al `?returnTo` para emitir el ticket y completar el redeem en `nocodecompany.co/settings`).

Síntoma colateral confuso: si vuelve a navegar manual a `nocodecompany.co/settings`, AHORA sí funciona (la sesión Neon Auth ya existe; el silent SSO toma el M2 path que no requiere login apex). El bug es **invisible en happy-path post-login**; sólo se nota en cold-start M1 (visitor anónimo + custom domain como first-touch).

## Por qué ocurre

El emisor del `?returnTo` (`/api/auth/sso-issue` cuando no hay sesión apex, `src/app/api/auth/sso-issue/route.ts:145-153`) construye correctamente la URL completa:

```typescript
function redirectToApexLogin(requestUrl: URL, defaultLocale: string): NextResponse {
  const continueUrl = `${apexBaseUrl()}${requestUrl.pathname}${requestUrl.search}`;
  const loginUrl = new URL(buildApexLoginUrl({ defaultLocale }));
  loginUrl.searchParams.set("returnTo", continueUrl);
  return NextResponse.redirect(loginUrl.toString(), 302);
}
```

El `returnTo` viaja en URL del browser, encoded correctamente. Hasta acá todo OK.

**El consumer del `?returnTo` NO existe en la página de login** (pre-S11.3):

1. `src/app/(marketing)/[locale]/login/page.tsx:22` — `type Props = { params: Promise<{ locale: string }> };` — no incluye `searchParams`. Next.js App Router NO expone search params a un Server Component si el tipo no los declara. El `?returnTo` es invisible a la page.
2. `src/app/(marketing)/[locale]/login/page.tsx:38-41` — guard "ya logueado" redirige a `https://app.place.community/${locale}/` hardcoded (Hub canónico).
3. `src/features/access/ui/access-flow.tsx:52` — `onSuccess: () => navigate(\`https://app.place.community/${locale}/\`)` hardcoded en el callback de submit exitoso.

Los 3 puntos forman una cadena coherente: la page NUNCA lee `returnTo`, el guard NO lo respeta, el callback navega hardcoded al Hub.

## Por qué no se detectó hasta S11.3 (post-S11.2 smoke owner-driven)

- **Feature C T1.1 (silent SSO)** partía siempre de owner ya logueado en apex. El `sso-issue` detectaba sesión apex → emitía ticket directo → nunca tocaba el login apex.
- **Feature C T1.2 (Server Actions zone-aware)** también partía de owner logueado.
- **Smoke M1 (cold-start sin sesión)** sólo se ejecutó en owner-driven manual post-S11.2 con cuenta anónima en incógnito. Allí se evidenció que el flow SSO completo emite el `returnTo` correctamente pero el login apex lo descarta.
- **El bug es pre-existing en el login apex** (pre-Feature-C). Feature C lo expone sin causarlo — es la primera feature que enviaría users a `/login?returnTo=…` esperando honor.

## Fix canónico (S11.3, ADR-0033)

1. Page `/[locale]/login` lee `searchParams.returnTo` (tipo extendido).
2. Validación con helper PURE nuevo `src/shared/lib/sso/validate-login-return-to.ts`: allowlist explícito (`/api/auth/sso-{issue,init}` + relative paths) + same-registrable-domain HTTPS para absolute URLs + reject de protocol-relative / scheme injection / attacker domains.
3. Guard "ya logueado" honra `returnTo` si valid, sino Hub canónico (backwards-compat).
4. `AccessFlow` recibe nuevo prop `returnTo?: string` + en `onSuccess` navega a `returnTo ?? hubCanonical` (closure sobre el prop).
5. `useAccessForm` NO se toca — superficie del hook intacta, separation of concerns preservada.

12 TDD tests cubren el helper PURE (null/undefined/empty/whitespace, relative paths simples y con query+hash, protocol-relative, scheme injection, attacker domain, allowlist hit, allowlist miss, HTTP no-HTTPS). 2 tests RTL nuevos cubren respeta-returnTo + regression Hub canónico sin returnTo.

## Tests que enforcen

- `src/shared/lib/sso/__tests__/validate-login-return-to.test.ts` (S11.3.B): 12 TDD tests para edge cases del helper PURE. Si en el futuro un PR loosens la policy (acepta más paths/dominios), estos tests fallan.
- `src/features/access/ui/__tests__/access-flow.test.tsx` (S11.3.C): 2 tests nuevos sobre el behavior de `onSuccess` con/sin `returnTo` prop. Regression-guard del Hub canónico cuando `returnTo` ausente.

## Modelo mental para futuros consumers de `/login?returnTo=…`

El contrato es:

1. **Caller (cualquier feature que redirija a login apex)** construye `?returnTo=<URL completa o path relativo>` y emite redirect.
2. **Login apex** valida con `validateLoginReturnTo(raw, APEX_HOST)`. Si valid → honrar (guard "ya logueado" + post-submit). Si null → Hub canónico (fallback default).
3. **Allowlist policy V1**: paths absolutos same-registrable-domain HTTPS DEBEN estar en allowlist explícito de `/api/auth/sso-{issue,init}` ÚNICAMENTE. Paths relativos `/<anything>` aceptados (aterrizan en apex mismo, same-origin = sin vector cross-domain).
4. **Ampliar allowlist V2** = ADR explícita + actualización del helper + test nuevo. Cost-of-mistake asimétrico (open-redirect = phishing vector severo).

## Referencias

- ADR-0033 (canon V1): `docs/decisions/0033-apex-login-honors-returnto.md` — decisión + alternativas rechazadas + consecuencias.
- Smoking guns con file:line: ADR-0033 §"Smoking guns" tabla.
- Spec write-back con evidencia: `docs/features/custom-domain-sso/spec.md` §"T1.3 inicial ROJO + S11.3 fix".
- Plan ejecutivo S11.3: `docs/features/custom-domain-sso/plan-sesiones.md` §"Mapeo S11.3.A → S11.3.D" + §"Desviación #5".
- Precedente same-registrable-domain policy: `docs/gotchas/jose-jwks-redirect-manual.md` + ADR-0032 §12 (S11.1 fix JWKS redirect).
