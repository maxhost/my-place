# Server Action que llama DEFINER dependiente de `app_user` falla post-signup si no precede con `ensureAppUser` TX 1

## Síntoma

Un Server Action invoca una función `SECURITY DEFINER` que en su cuerpo plpgsql hace `SELECT id FROM app_user WHERE auth_user_id = v_auth` (e.g. `app.accept_invitation`, `app.create_place`, cualquier futura que cruce `app_user` ↔ JWT sub). Cuando el caller acaba de hacer `signUpAccountAction` (Neon Auth signup) sin pasar por PlaceWizard, la action retorna error sin pistas:

- Panel UI muestra copy genérico "Algo salió mal" (fallback `errorUnknown` del slice).
- Vercel runtime logs: 0 errors / fatals; el POST retorna **200** (Server Action devuelve `{status: 'error'}`, no throw).
- Neon `invitation.accepted_at` o `place.id` (según el DEFINER) sigue null/inexistente — la DEFINER nunca llegó al INSERT/UPDATE.

Sólo aparece al diagnosticar Neon directo: la `app_user` row del invitee **no existe** (0 rows con su email). El user TIENE cuenta en Neon Auth (signup OK, sesión vigente, página RSC vio su email), pero su `app_user` espejado nunca se sembró.

## Causa

**ADR-0008 §2/§4** (canon): `signUpAccountAction` (`features/access/auth-actions.ts:45-61`) crea SÓLO la identidad Neon Auth — **NO siembra `app_user`**. Razón canónica: "cuenta sin place" es estado legítimo (un user puede signup-ear sin crear/aceptar nada). El siembrado de `app_user` está delegado a `ensureAppUser` (`shared/lib/ensure-app-user.ts`, ADR-0006, idempotente por `auth_user_id UNIQUE`).

El UNICO caller histórico de `ensureAppUser` era `place-creation/actions.ts:33-45` (`sessionIdentity()` + `create-place.ts:71-77`): TX 1 separada antes de la TX 2 de `app.create_place` DEFINER. Razón del split tx (ADR-0005 §4): rollback de la TX 2 (e.g. slug-dup) NO debe borrar el `app_user` recién sembrado.

Pre-Feature-E-V1.1 (S6 fix, 2026-05-26), ese era el único path post-signup que sembraba `app_user`. Cualquier OTRO path post-signup hacia un DEFINER dependiente de `app_user` rompía. Feature E V1.1 Accept Invitation fue el primer caso descubierto: el invitee signup-ea via `/login?mode=signup` (ADR-0045) → redirect al invite URL → click "Aceptar" → `app.accept_invitation` DEFINER → `SELECT id FROM app_user WHERE auth_user_id = v_auth` → 0 rows → `RAISE EXCEPTION 'app_user inexistente' USING errcode = 'P0002'`.

**Síntoma confuso doble**:
1. `mapAcceptError(P0002)` correctamente retorna `{kind: 'app_user_missing'}`, pero `errorCopy` del panel (V1.1 S3) cae al `default: errorUnknown` porque no hay copy específico para `app_user_missing` (asumido "no debería ocurrir" en design original).
2. Server Action retorna 200 (envelope `{status: 'error'}` no throw), por lo tanto **no aparece en Vercel error logs**. Sólo el contenido del response payload tiene el detalle, invisible sin DevTools Network tab.

## Fix canónico

Wire `ensureAppUser` en **TX 1 separada** antes de cualquier DEFINER que dependa de `app_user`. Patrón paralelo exacto a `create-place.ts:65-77`:

```typescript
// ANTES (broken-post-signup):
export async function someInvitationAction(input) {
  // ... validación
  try {
    const rows = await getAuthenticatedDbForRequest((sql) =>
      sql(`SELECT app.some_definer($1) AS result`, [input.token]),
    );
    return { status: 'success', ... };
  } catch (err) {
    return { status: 'error', error: mapSomeError(err) };
  }
}

// DESPUÉS (production-grade):
import { getAuth } from '@/shared/lib/auth';
import { ensureAppUser } from '@/shared/lib/ensure-app-user';

export async function someInvitationAction(input) {
  // ... validación
  try {
    const session = await getAuth().getSession();
    if (!session.data?.session) {
      return { status: 'error', error: { kind: 'unauthenticated' } };
    }
    const email = session.data.user.email ?? '';
    const displayName = session.data.user.name ?? '';

    // TX 1 — ensureAppUser (idempotente, ON CONFLICT DO NOTHING). Commitea
    // en su propia tx para que rollback eventual de TX 2 NO borre el
    // app_user (ADR-0005 §4, paralelo a create-place.ts:65-77).
    await getAuthenticatedDbForRequest((sql, claims) =>
      ensureAppUser(sql, { authUserId: claims.sub, email, displayName }),
    );

    // TX 2 — DEFINER de dominio (en este punto app_user está garantizado).
    const rows = await getAuthenticatedDbForRequest((sql) =>
      sql(`SELECT app.some_definer($1) AS result`, [input.token]),
    );
    return { status: 'success', ... };
  } catch (err) {
    return { status: 'error', error: mapSomeError(err) };
  }
}
```

**Costo runtime**: 1 query extra por accept del DEFINER (idempotente, `ON CONFLICT DO NOTHING` → no-op para users existentes). En el caller del PlaceWizard (post-Acceso login normal), el `app_user` ya existe → la TX 1 es un single SELECT `ON CONFLICT` no-op (<1ms). Sólo el primer accept post-signup hace el INSERT real.

## Cuándo vuelve a morder

**Cualquier futura Server Action que**:

1. Sea invocable post-`signUpAccountAction` SIN pasar por PlaceWizard (auth-actions.ts → no app_user → DEFINER falla)
2. Y llame una función `SECURITY DEFINER` cuyo body haga lookup en `app_user WHERE auth_user_id = app.current_user_id()`

Casos candidatos a auditar antes de shippear:
- Invite Accept (V1.1, **fixed S6 2026-05-26**).
- Cualquier "social" o "comunity" action que asuma `app_user` pre-existente (TBD futuros slices).
- DEFINERs que insertan filas con FK a `app_user.id` (membership, post, comment, etc.).

**Test rápido pre-merge**: en un branch ephemeral con migraciones aplicadas, simular signup-then-action sin `create_place` intermedio. Si la action retorna error → falta `ensureAppUser` TX 1.

## Por qué no se mueve `ensureAppUser` adentro de los DEFINERs

Alternativa rechazada en ADR-0006: "el DEFINER siembra app_user si falta". Razones:
1. SQL puro plpgsql en DEFINER no tiene acceso al `email`/`name` de Neon Auth (los lee la app via SDK); habría que pasarlos como params de cada DEFINER → ensanchar superficie + duplicar canon en 4+ migrations.
2. El DEFINER ya hace heavy lifting (validaciones del dominio); mezclar siembra de identidad rompe single-responsibility.
3. El patrón TX 1 ensureAppUser / TX 2 DEFINER deja la siembra atómica + rollback-resistant en una sola capa (action), donde es testeable + auditable.

## Pointers

- **Canon de ensureAppUser**: `src/shared/lib/ensure-app-user.ts` (ADR-0006).
- **Patrón canónico**: `src/features/place-creation/create-place.ts:65-77` (TX 1 + TX 2 split).
- **Fix V1.1 S6**: commit `c13fcfd` en `src/features/invitations/actions/accept-invitation.ts`.
- **ADR del comportamiento de signup**: ADR-0008 §2/§4 + `src/features/access/auth-actions.ts:36-44` (comment).
- **DEFINER que falló**: migration `0003_accept_invitation_fn.sql` (P0002 si app_user missing, línea 31).
- **Evidencia de smoke V1.1 S6**: `docs/features/invitations/spec.md` §"Smoke ejecutado (2026-05-26, S6 close)".
