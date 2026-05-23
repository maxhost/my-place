# jose v6 hardcodea `redirect: 'manual'` en el JWKS fetch y rompe contra apex→www

> Documentado 2026-05-23 al diagnosticar smoke production T1.1 (Feature C — Custom Domain SSO via Signed Ticket).

## Síntoma

El redeem aterriza en `?sso_error=signature_invalid` aunque la firma del ticket es matemáticamente válida. Confunde porque el ticket está bien formado, el `kid` coincide, y el clock skew está dentro de tolerancia — todo apunta a un fallo de firma que no es de firma.

Verificable empíricamente con dos scripts equivalentes que sólo difieren en el host del JWKS:

- `verify-ticket-www.mjs` contra `https://www.place.community/api/auth/sso-jwks` → **pass**.
- `verify-ticket.mjs` contra `https://place.community/api/auth/sso-jwks` → **fail** con `Expected 200 OK from the JSON Web Key Set HTTP response`.

Mismo ticket, misma key, mismo `kid`. Lo único que cambia es el host del JWKS endpoint.

## Causa raíz

jose v6 `createRemoteJWKSet` internamente llama `fetchJwks(url, headers, signal, fetchImpl)` con `redirect: 'manual'` hardcodeado (`node_modules/.pnpm/jose@6.2.3/node_modules/jose/dist/webapi/jwks/remote.js` línea 19). El JWKS del apex `https://place.community/api/auth/sso-jwks` responde **HTTP 307** redirigiendo a `https://www.place.community/api/auth/sso-jwks` por configuración platform-level de Vercel (apex → www). jose ve el 307 como respuesta inválida (esperaba 200) y throws con `Expected 200 OK from the JSON Web Key Set HTTP response` (mismo archivo, línea 129). El pipeline del redeem mapea cualquier fallo del JWKS fetch a `signature_invalid` por defense-in-depth: el cliente no debe poder distinguir "firma mala" de "JWKS no alcanzable" — ambos son `signature_invalid` para evitar leak de qué falló (oracle anti-debug).

`redirect: 'manual'` es una **defensa intencional** de jose contra JWKS-hijack: un atacante con position en el path del DNS podría redirigir el JWKS a un endpoint con su propia public key, y los tickets firmados por el atacante verificarían. La defensa es correcta en abstracto; el problema es que choca con el redirect platform-level apex→www de Vercel que ningún consumer puede deshabilitar sin perder SEO + paridad de dominio.

## Fix

ADR-0032 addendum 2026-05-23 §"Same-registrable-domain redirect policy". Inyectar un `customFetch` (Symbol export de jose v6) al `createRemoteJWKSet` que sigue redirects sólo bajo policy estricta:

- **Same-registrable-domain** (last-two-labels match origin host).
- **`https:` only** (no downgrade a `http:`).
- **≤3 hops** (Vercel apex→www es 1; +2 de buffer).

Cualquier violación → `SsoJwksRedirectError` → jose lo envuelve en `JOSEError` → el pipeline del redeem cae en el mismo `signature_invalid` (no se rompe la semántica anti-oracle). Implementación en `src/shared/lib/sso/sso-jwks-fetcher.ts`; wire-up en `src/app/api/auth/sso-redeem/route.ts` líneas 80-100.

## Por qué NO otras 8 opciones evaluadas

Detalle completo en el ADR-0032 addendum; resumen del descarte:

- **A. Cambiar `NEXT_PUBLIC_APP_URL` a www**: alta blast radius (lo usa `rootDomain()` para cookie scoping cross-subdomain — rompería Feature B).
- **B. Hardcode `www.place.community` en la JWKS URL**: frágil, rompe dev, ata el código al deploy actual.
- **C. Follow simple sin validar target**: pierde la defensa anti-hijack que jose puso por buena razón.
- **E. Deshabilitar el redirect Vercel apex→www**: pierde SEO + el cambio es fuera del scope SSO.
- **F. Fork de jose**: superficie de mantenimiento desproporcionada para 1 línea.
- **G. Pre-resolver el JWKS server-side y hardcodear el JWK en env**: complica rotation, anula los benefits de un JWKS endpoint.
- **H. Proxy interno del JWKS**: añade un hop + cache layer extra para nada.
- **I. Downgrade a jose v5**: regresa fixes de seguridad recientes; el problema no se va (mismo comportamiento).

## Cómo prevenir regresión

- **10 unit tests** en `src/shared/lib/sso/__tests__/sso-jwks-fetcher.test.ts` cubren cada policy violation (protocol downgrade, cross-registrable, too-many-redirects, etc.).
- **ADR-0032 §"Same-registrable-domain redirect policy"** documenta la decisión canónica y la racional vs alternativas.
- **Si en futuro jose v7+** cambia el default (sigue redirects opt-in o default `follow`), revisar esta gotcha: el `customFetch` puede simplificarse o eliminarse. Hoy es necesario.
- **`getTwoLabelRoot` es naive**: NO maneja ccTLDs con sufijo público multi-label (`*.co.uk`, `*.com.ar`, `*.gov.uk`). Documentado en el header de `sso-jwks-fetcher.ts`. Place actualmente sólo deploya bajo gTLDs (`place.community`, `nocodecompany.co`); si en el futuro se agrega un custom domain bajo ccTLD multi-label, hay que integrar el Public Suffix List o equivalente antes de aceptarlo.

## Referencias

- `node_modules/.pnpm/jose@6.2.3/node_modules/jose/dist/webapi/jwks/remote.js` líneas 15 (definición de fetch defaults), 19 (`redirect: 'manual'` hardcoded), 129 (throw `Expected 200 OK from the JSON Web Key Set HTTP response`).
- ADR-0032 §"Same-registrable-domain redirect policy" — addendum 2026-05-23.
- `src/shared/lib/sso/sso-jwks-fetcher.ts` — `makeSafeRedirectFollowingFetch` + `SsoJwksRedirectError`.
- `src/app/api/auth/sso-redeem/route.ts` líneas 80-100 — wire-up del `customFetch` en `createRemoteJWKSet`.
- Smoke production T1.1 (2026-05-23) — primera detección empírica con `verify-ticket.mjs` vs `verify-ticket-www.mjs`.
- Gotcha paralelo: `sso-signing-key-no-log.md` — la otra mitad del trust model SSO (signing side; este gotcha cubre el verify side).
