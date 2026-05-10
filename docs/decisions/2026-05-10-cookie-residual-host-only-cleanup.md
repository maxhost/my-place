# 2026-05-10 — Cleanup defensivo de cookies residuales host-only en middleware

## Contexto

Después de implementar el flow de invitación end-to-end (callback → accept page → POST → place subdomain), apareció un bug crítico de auth en producción: el user llegaba al subdomain del place y era inmediatamente redirigido a `/login` con error `refresh_token_not_found`, perdiendo la sesión recién creada.

### Diagnóstico

Reproduciendo con `/api/debug-getsession` (endpoint diagnóstico temporal que invoca `supabase.auth.getSession()` y retorna el JSON completo), confirmamos:

- **Cookie del callback en apex (`www.place.community`):** `valueLen: 2579`, refresh_token válido server-side.
- **Cookie en subdomain (`the-company.place.community`) post-POST:** `valueLen: 2951` (DIFERENTE), refresh_token desconocido para Supabase → `Refresh Token Not Found`.

Query directo a `auth.refresh_tokens`: el refresh_token del callback (`docpeidmcbox`) seguía válido, no rotado, no revoked. Entonces NO era un bug de rotación.

**Causa raíz identificada:** el browser tenía DOS cookies con el mismo name `sb-tkidotchffveygzisxbn-auth-token`:

1. **Cookie A** (nueva, callback): `Domain=place.community` (apex con leading dot implícito), value=2579 bytes, refresh_token válido.
2. **Cookie B** (residual de un flow anterior): `Domain=the-company.place.community` (host-only, sin Domain attribute), value=2951 bytes, refresh_token de un flow viejo invalidado server-side.

Por **RFC 6265**, cuando el browser envía cookies a `the-company.place.community`, las más específicas (host-only) tienen precedencia y aparecen primero en el header. El SDK `@supabase/ssr` lee la primera cookie que matchéa su `storageKey` → lee la **B** (residual invalidada) → trata de refresh → Supabase responde `refresh_token_not_found` → middleware redirige a `/login`.

¿De dónde salieron las cookies host-only? De código pre-fix que emitía cookies `sb-*` sin `Domain` attribute. El código actual ya usa `cookieDomain()` consistentemente, pero los browsers de testers internos quedaron con el state residual de despliegues anteriores.

## Decisión

Cuando el middleware detecta `isStaleSessionError` (que cubre `refresh_token_not_found`, `refresh_token_already_used`, `session_not_found`, `session_expired`), después del `signOut({scope:'local'})` del SDK emite manualmente Set-Cookie `Max-Age=0` host-only para `sb-{currentRef}-auth-token` y sus chunks `.0`/`.1`/...

Características clave:

- **Host-only intencional** (sin `Domain` attribute): apunta al host actual exclusivamente. El `signOut` del SDK ya limpia la versión `Domain=apex`; este cleanup limpia la versión `Domain=<host>` que el SDK no toca.
- **Filtrado por `currentRef`**: solo afecta cookies del proyecto Supabase actual (`tkidotchffveygzisxbn`). Cookies de OTROS proyectos Supabase coexistentes en el browser quedan intactas.
- **Activado solo en path stale** (catch del `getSession` con `isStaleSessionError`): requests OK no se ven afectados.
- **Loggea `MW_stale_cleanup`** con `host`, `path`, `currentRef`, `clearedCount`, `clearedNames` para observability vía Vercel Logs.

## Alternativas consideradas

### A. Cleanup proactivo en el callback con `Domain=apex`

Descartada. El callback corre en apex (`www.place.community`); solo puede emitir Set-Cookie con `Domain=place.community` o host-only para el apex. Las cookies residuales viven en subdomains place con `Domain=<host>` (host-only) — **inalcanzables desde el callback**. RFC 6265 prohíbe que un host emita Set-Cookie con Domain de otro host hermano.

### B. Borrar todas las cookies `sb-*` sin filtro de ref

Descartada. Un user puede tener cookies legítimas de OTROS proyectos Supabase coexistentes en el mismo browser (multi-tenant). Borrar sin filtro romperia esas sesiones — efecto colateral inaceptable.

### C. Bloquear emisión de cookies host-only desde el código (boundary test)

**Complementaria, no alternativa.** Cubierta en Sesión 2 del plan `docs/plans/2026-05-10-cookie-cleanup-hardening.md`: agregar test guard que bloquea cualquier nuevo `Set-Cookie` de `sb-*` sin `Domain` explícito. Esto previene **futuras** emisiones; el cleanup defensivo de este ADR cubre **residuales históricas**.

### D. Cleanup proactivo en middleware del subdomain (parsing del cookie header raw)

**Complementaria.** Cubierta en Sesión 3 del plan: detectar duplicados (cookies host-only + apex con mismo name) en el header raw ANTES de llamar `getSession`, emitir cleanup proactivo. Eliminaría el redirect a `/login` que el approach reactivo deja la primera vez.

Por ahora, el approach reactivo (este ADR) es suficiente: los users impactados son testers internos con state previo. Para producción con users genuinamente nuevos no hay residuales.

## Tradeoffs aceptados

1. **Reactivo, no proactivo.** El user ve UN redirect a `/login` la primera vez que el bug aparece. La siguiente visita es limpia. Mejorable con Sesión 3 del plan.

2. **Multi-subdomain self-heals individualmente.** Si el user tiene cookies residuales en N place subdomains, necesita visitar cada uno una vez para que cada uno limpie las propias. Documentado como gotcha en Sesión 4 del plan.

3. **Cleanup también se activa en stale codes legítimos** (`session_not_found` de revocación remota, `refresh_token_already_used` de race entre tabs). Para esos casos borrar la cookie del current project es OK — el user logueó out genuinamente o tiene un race; reloguear es lo correcto. Discriminación más fina por error code en Sesión 4 del plan.

4. **Sin metrics agregadas.** El log estructurado `MW_stale_cleanup` es queryable por Vercel Logs (`debug:'MW_stale_cleanup'`). Suficiente para detectar prevalence del problema sin instrumentar PostHog/DataDog (decisión user 2026-05-10).

## Cómo verificarlo

### Test automatizado

`pnpm vitest run src/shared/lib/supabase/__tests__/middleware-stale-cleanup.test.ts` — 6 tests cubren:

- Happy path no emite cleanup
- `refresh_token_not_found` emite cleanup para 3 cookies (base + 2 chunks)
- Cleanup NO toca cookies de otros project refs
- Cleanup NO toca cookies no-supabase
- Set-Cookie tiene Path=/, Max-Age=0, Secure, SameSite=Lax, **sin** Domain
- Log `MW_stale_cleanup` tiene shape esperado

### Smoke test manual

1. En DevTools del browser, en `*.place.community`: crear cookie `sb-tkidotchffveygzisxbn-auth-token` con `Domain=the-company.place.community` (host-only, sin dot leading), value `base64-eyJ0ZXN0Ijp0cnVlfQ==` (JSON inválido).
2. Abrir `https://the-company.place.community/api/debug-getsession`.
3. **Esperado:**
   - JSON con `sdkError: { code: "refresh_token_not_found" }` (porque el JSON de la cookie no decodea como session real).
   - En Vercel Logs, log `MW_stale_cleanup` con `clearedNames: ["sb-tkidotchffveygzisxbn-auth-token"]`.
   - Próximo request a la misma URL: cookie ya no aparece en `cookiesSeenBySdk`. Limpia.

## Pre-requisitos

- **Sesión 2 del plan:** auditar que el código actual NO emite cookies `sb-*` sin Domain (el código emisor bug-causante ya fue removido en commits anteriores; Sesión 2 agrega test guard contra regresión futura).

## Referencias

- Bug original: thread de diagnóstico end-to-end (sesión 2026-05-10).
- Endpoint diagnóstico: `src/app/api/debug-getsession/route.ts` (DEBUG TEMPORAL).
- Plan completo de hardening: `docs/plans/2026-05-10-cookie-cleanup-hardening.md`.
- RFC 6265 § 5.3 step 6 — host-only flag, precedencia de cookies.
- Implementación: `src/shared/lib/supabase/middleware.ts:181-220` (catch path de stale).
