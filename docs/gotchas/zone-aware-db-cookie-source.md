# Server Action falla con `error`/`none` desde custom domain aunque el user esté autenticado

## Síntoma

Una Server Action (o RSC con efectos) owner-only retorna `{status: 'error'}` o `{status: 'none'}` cuando se invoca desde un page renderizado en un **custom domain** del place (`nocodecompany.co`), pero funciona perfectamente cuando se invoca desde el **subdomain canónico** del mismo place (`mi-place.place.community`).

El user está visiblemente logueado: el chrome de la zona-place se renderea con su locale, las pages owner-only renderean sin redirect a login, las pages de settings populan estado del DB. **El layout + page funcionan**. Solo la **mutación post-submit** falla.

UI muestra error genérico del slice (sin detalle de auth — by design, ver no-doxx). Logs server-side muestran `NoSessionError` o (pre-S11.2) `requireSessionJwt() === null` aunque la cookie Neon Auth está visiblemente en el browser para `*.place.community`.

## Causa

**RFC 6265 §5.4**: cookies con atributo `Domain=` se envían SOLO a hosts dentro de ese registrable domain. La cookie Neon Auth se setea con `Domain=.place.community` (cross-subdomain para apex+subdomains+inbox) → **el browser jamás la envía a `nocodecompany.co`** (registrable domain distinto).

Pre-Feature-C (S0–S10), el contrato era `getAuthenticatedDb(token, fn)` (Feature A `src/shared/lib/db.ts`) + el caller leía el token con `requireSessionJwt()` que internamente lee la cookie Neon Auth. Las 4 Server Actions montadas en `/settings*` (que ahora puede renderearse desde custom domain post-Feature-B routing) seguían leyendo SOLO la cookie Neon Auth → null → fallo silencioso post-submit.

Feature C V1 cerró el SSO flow (cookie local `__Host-place_sso_session` se setea correctamente en custom domain) pero NO migró las 4 Server Actions porque el sub-módulo `src/shared/lib/sso/` está scoped al SSO flow + el helper `getAuthenticatedDbWithVerifier` (S4) es un primitivo que el caller tiene que invocar explícitamente. Las 4 Server Actions seguían usando `getAuthenticatedDb` directo asumiendo Neon Auth → bug T1.2 (smoke owner-driven post-S11.1, 2026-05-23).

**Síntoma confuso**: el user está autenticado (cookie SSO local activa, render funciona), pero la mutación falla porque el código no sabe que tiene que leer **otra cookie** según la zona.

## Fix canónico (post-S11.2 / ADR-0034)

Usar el **helper coordinador zone-aware** `getAuthenticatedDbForRequest(fn)` (`src/shared/lib/db-for-request.ts`) en lugar de la combinación `requireSessionJwt() + getAuthenticatedDb(token, fn)`.

El coordinator:
1. Detecta `HostZone` del request via `resolveHostWithCustomDomains`.
2. Lee la cookie correcta según zona (Neon Auth en apex/subdomain/inbox/marketing; SSO local en custom domain).
3. Dispatcha al primitivo apropiado (`getAuthenticatedDb` o `getAuthenticatedDbWithVerifier`).
4. Fail-closed con `NoSessionError` si no hay sesión válida en la zona.

```typescript
// ANTES (broken-on-custom-domain):
const token = await requireSessionJwt();
if (!token) return { status: 'error' };
return getAuthenticatedDb(token, async (sql) => {
  // ... lógica RLS
});

// DESPUÉS (zone-aware):
import { getAuthenticatedDbForRequest, NoSessionError } from '@/shared/lib/db-for-request';

try {
  return await getAuthenticatedDbForRequest(async (sql, claims) => {
    // ... lógica RLS (idéntica; claims.sub === neon_auth_user_id en ambas zonas)
  });
} catch (err) {
  if (err instanceof NoSessionError) return { status: 'error' };
  throw err;
}
```

**El `sub` recibido en `claims` es idéntico al de Neon Auth en ambas zonas** (ADR-0032 §6): el local session JWT del SSO local hereda el `sub` del Neon Auth user.id que el apex firmó en `sso-issue`. Por eso `app.current_user_id()` retorna lo mismo + las RLS policies funcionan sin cambio.

## Invariante going-forward (post-S11.2)

**Todo nuevo Server Action o RSC con efectos owner-only que pueda ejecutarse desde una page montada en `/place/[placeSlug]/...` DEBE usar `getAuthenticatedDbForRequest`**, no `getAuthenticatedDb` directo.

Excepciones: callers provadamente confinados a zona apex/inbox (e.g. handlers de `/api/auth/sso-{issue,jwks}` que sólo corren en apex por design del flow SSO, o futuro handler de `/api/inbox/...` confinado a `inbox.place.community`). En esos casos `getAuthenticatedDb` directo es correcto.

**Sin enforcement por tipo** (`getAuthenticatedDb` sigue exportado por compat con call sites apex-only). Enforcement por:
1. **Code review**: cualquier nuevo Server Action en `src/features/<slice>/actions/` montado en `/settings*` o `/place/[placeSlug]/*` se revisa contra esta invariante.
2. **Header in-code** de `db-for-request.ts` documenta la invariante para developers que toquen el helper.
3. **Esta gotcha** como referencia diagnóstica para developers que vean el síntoma confuso en el futuro.

## Tests pertinentes

- `src/shared/lib/__tests__/db-for-request.test.ts` (8 tests PURE) — cubre todos los branches del dispatch + propagation de `expectedHost` + cookie name exacto.
- El integrador `getAuthenticatedDbForRequest` NO se vitest'ea (canon seam-split `update-default-locale.ts:13`): cruza `next/headers` + Neon Auth SDK + DB real → correctitud por tipo/build + smoke owner-driven.

## Pointers

- **ADR canónica**: `docs/decisions/0034-zone-aware-db-helper.md`.
- **ADR que estableció continuidad RLS** (precondición del coordinator): `docs/decisions/0032-custom-domain-sso-signed-ticket.md` §6.
- **Spec del feature**: `docs/features/custom-domain-sso/spec.md` §"S11.2 — fix Opción B" + §"T1.2 retry post-fix VERDE".
- **Gotcha hermano** (custom domain cookie scope desde otro ángulo): `docs/gotchas/host-prefix-cookie-path.md` — el prefix `__Host-` enforce `Path=/` + sin `Domain=` (cookie host-only); es lo que hace que la cookie SSO local funcione en custom domain. Esta gotcha cubre el ángulo opuesto: la cookie Neon Auth tiene `Domain=` por design + por eso NO funciona en custom domain.
