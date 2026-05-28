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

## Identity reading (RSC + Server Actions) — post-D.fix.3

El mismo gap arquitectónico que motivó esta gotcha **para queries DB** se replica **para lectura de identidad del user vigente**. Cualquier callsite (RSC, Server Action, route handler) que lea identity via Neon Auth SDK directo (`getAuth().getSession()` o equivalentes) tiene el mismo bug bajo custom domain: el SDK SOLO lee la cookie cross-subdomain `Domain=.place.community` — NO la cookie SSO local `__Host-place_sso_session` minteada por el redeem custom domain. Resultado simétrico al de la sección anterior: el render/mutation falla con "unauth" aunque el user tenga sesión activa post SSO-chain.

**Bug histórico evidente — smoke matriz 2x2 V1.2 (ADR-0046 Feature E Invite Accept Flow, 2026-05-27)**:

- **Bug A — RSC reader**: invite page bajo custom domain mostraba CTA "Aceptar" oculto (variant "unauth") porque el RSC leía email via `getAuth().getSession()`.
- **Bug B — Server Action**: `acceptInvitationAction` retornaba `unauthenticated` al click "Aceptar" desde custom domain por la misma razón.

### Fix canónico — `getCurrentUserIdentityForRequest`

Helper unificado en `src/shared/lib/current-user-identity.ts` (ADR-0046 §"Addendum operacional — Sesión D.fix.3"). Espejo conceptual exacto de `getAuthenticatedDbForRequest` pero para identidad: detecta `HostZone` + lee cookie correcta + abre tx autenticada via coordinator + ejecuta DEFINER `app.lookup_user_identity_by_id(uuid)` que retorna `{email, name}` desde `neon_auth.user`. Retorna `{authUserId, email, displayName} | null` ATÓMICO (los 3 campos del MISMO `claims.sub`, single lookup).

```typescript
// ANTES (broken-on-custom-domain, idéntico bug a la sección anterior):
import { getAuth } from '@/shared/lib/auth';

const session = await getAuth().getSession();
if (!session.data?.session) return { variant: 'unauth' };
const email = session.data.user.email;

// DESPUÉS (zone-aware, post-D.fix.3):
import { getCurrentUserIdentityForRequest } from '@/shared/lib/current-user-identity';

const identity = await getCurrentUserIdentityForRequest();
if (identity === null) return { variant: 'unauth' };
const { authUserId, email, displayName } = identity;
```

**Fail semantics**: `getCurrentUserIdentityForRequest` es fail-soft a `null` para cualquier error (NoSessionError, DB transport, drift de schema, payload Zod inválido). Apto para callers que tratan "sin identidad" == flujo legítimo (RSC reader → variant "unauth"; Server Action → `{kind: 'unauthenticated'}` en el discriminated union de su return type).

### Invariante going-forward (post-D.fix.3)

**Todo nuevo RSC, Server Action, o route handler que lea identidad del user vigente Y pueda ejecutarse desde una page montada en `/place/[placeSlug]/...` DEBE usar `getCurrentUserIdentityForRequest`**, no `getAuth().getSession()` ni equivalentes.

Excepciones simétricas a las de la sección DB: callers provadamente confinados a zona apex/inbox/marketing (e.g. handlers de `/api/auth/sso-{issue,jwks}`, pages del apex login/landing) pueden usar el SDK Neon Auth directo — la cookie cross-subdomain SÍ está disponible ahí por design.

**Enforcement por code review**: cualquier nuevo callsite en `src/features/<slice>/actions/` o `src/app/(app)/place/[placeSlug]/.../page.tsx` que invoque `getAuth()` se revisa contra esta invariante. Si overlap con custom domain → migrar al integrator.

### Continuidad RLS / continuidad de identidad

Mismo argumento que la sección anterior: `claims.sub` retorna el MISMO valor en custom domain que en apex (ADR-0032 §6). El `sub` del local session JWT === `sub` del Neon Auth JWT que el apex verificó en `sso-issue`. El DEFINER `lookup_user_identity_by_id` matchea la misma row en `neon_auth.user` independientemente de la zona origen — cero refactor de policies, cero divergencia de identidad.

### Por qué no se subsume en `getAuthenticatedDbForRequest`

Considerado: extender el coordinator DB para retornar también identity en el callback (e.g. `(sql, claims, identity) => ...`). Rechazado:

- El coordinator DB es un primitive de **acceso a datos autenticado**; agregar lookup de identity en su crítico path penaliza a TODOS los callers que solo necesitan ejecutar SQL (mayoría de Server Actions del proyecto).
- El integrator de identity es opt-in: callers que NO necesitan identity (e.g. settings update que solo usa `claims.sub` para WHERE) no pagan el round-trip extra al DEFINER `lookup_user_identity_by_id`.
- Separación de concerns: 1 integrator por concern (DB / identity / locale / etc.). Pattern reusable para futuros readers zone-aware (e.g. `getCurrentUserLocaleForRequest` si V1.3+ lo necesita).

## Tests pertinentes

- `src/shared/lib/__tests__/db-for-request.test.ts` (8 tests PURE) — cubre todos los branches del dispatch + propagation de `expectedHost` + cookie name exacto.
- El integrador `getAuthenticatedDbForRequest` NO se vitest'ea (canon seam-split `update-default-locale.ts:13`): cruza `next/headers` + Neon Auth SDK + DB real → correctitud por tipo/build + smoke owner-driven.
- **Identity reading (D.fix.3)**:
  - `src/shared/lib/__tests__/user-identity-by-id-lookup.test.ts` (10 tests PURE) — cubre wrapper TS sobre el DEFINER `app.lookup_user_identity_by_id` + Zod parse + fail modes.
  - `src/db/__tests__/lookup-user-identity-by-id.test.ts` (9 tests integration) — cubre el DEFINER directo: happy + payload shape jsonb + ACL + SECURITY DEFINER bypass + drift de `neon_auth.user` schema + caller anónimo + uuid inválido.
  - El integrador `getCurrentUserIdentityForRequest` NO se vitest'ea (mismo canon seam-split): correctitud por tipo/build + smoke E2E V1.2 Sesión D matriz 2x2.

## Pointers

- **ADR canónica**: `docs/decisions/0034-zone-aware-db-helper.md`.
- **ADR que estableció continuidad RLS** (precondición del coordinator): `docs/decisions/0032-custom-domain-sso-signed-ticket.md` §6.
- **ADR del identity reader unificado**: `docs/decisions/0046-invite-flow-cross-domain-coherence.md` §"Addendum operacional — Sesión D.fix.3" — refactor que cerró Bug A (RSC) + Bug B (Server Action) del smoke matriz V1.2.
- **Spec del feature**: `docs/features/custom-domain-sso/spec.md` §"S11.2 — fix Opción B" + §"T1.2 retry post-fix VERDE".
- **Gotcha hermano** (custom domain cookie scope desde otro ángulo): `docs/gotchas/host-prefix-cookie-path.md` — el prefix `__Host-` enforce `Path=/` + sin `Domain=` (cookie host-only); es lo que hace que la cookie SSO local funcione en custom domain. Esta gotcha cubre el ángulo opuesto: la cookie Neon Auth tiene `Domain=` por design + por eso NO funciona en custom domain.
