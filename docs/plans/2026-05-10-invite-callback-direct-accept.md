# Plan — Eliminar PÁGINA 2 del flow de invitación (callback acepta directo)

## Context

### Flow actual (2 páginas intermedias)

```
Click email
  → /auth/invite-callback (verifyOtp + cookies)
  → PÁGINA 1 htmlRedirect "Continuar →"  (necesario para Safari iOS ITP)
  → /invite/accept/[token] (RSC: getUser + load invitation)
  → PÁGINA 2 accept-invitation-view "Aceptar y entrar"
  → POST /invite/accept (server action: requireAuthUserId + accept tx)
  → window.location → place subdomain
```

### Flow target (1 página intermedia)

```
Click email
  → /auth/invite-callback (verifyOtp + cookies + ACCEPT inline + redirect)
  → PÁGINA 1 htmlRedirect "Continuar →" (necesario para Safari iOS ITP)
  → place subdomain (ya como member)
```

El user mantiene 1 click de "Continuar" (Safari iOS ITP requiere user-interaction)
pero elimina el paso "Aceptar y entrar". 1 click visible = adentro.

### Por qué hacer el cambio

- UX: 50% menos pasos para entrar.
- Friction: el step "Aceptar/Cancelar" es low-value — el user que clickeó el email
  ya quiere entrar. Cancel se puede ofrecer como "Salir del place" desde adentro.
- Coherente con la filosofía cozytech: nada grita, nada demanda atención
  innecesaria. La invitación enviada por un admin es ya el "consentimiento" de la
  relación; el user solo confirma que es él (verificación del email).

### Bug original NO relacionado

El bug `refresh_token_not_found` post-aceptar (resuelto en commit cleanup
defensivo middleware) tenía causa raíz independiente: cookies residuales
host-only de flows previos. Este plan NO depende del bug, es mejora UX
independiente.

## Diseño técnico

### Cambio 1 — Refactor accept logic a shared lib

`acceptInvitationAction` actual mezcla:

- Auth (`requireAuthUserId`)
- Validation (parse token)
- Domain logic (find invitation, check expiry/active, accept tx)
- Cache invalidation (`revalidatePath`, `revalidateMemberPermissions`)

Necesitamos extraer (1)–(3) a una función pure que acepte `userId` como
parámetro (sin depender de `requireAuthUserId` que necesita session context).
Cache invalidation (4) se hace solo desde server action context.

**NEW `src/features/members/invitations/server/accept-core.ts`** (~80 LOC):

```ts
export type AcceptInvitationResult =
  | { ok: true; placeSlug: string; alreadyMember: boolean }
  | {
      ok: false
      reason:
        | 'invalid_token'
        | 'expired'
        | 'archived'
        | 'over_capacity'
        | 'already_used_by_other'
        | 'admin_preset_missing'
    }

export async function acceptInvitationCore(
  token: unknown,
  actorId: string,
): Promise<AcceptInvitationResult>
```

- Parsea token con `acceptInvitationTokenSchema`
- Busca invitación
- Valida (expiry, place active)
- Llama `acceptInvitationTx`
- Retorna result discriminado (no throws para errores de dominio esperables;
  sí throws para errores inesperados como Prisma conexión)

### Cambio 2 — Server action usa accept-core

`acceptInvitationAction` queda como wrapper:

- `requireAuthUserId('Necesitás...')` para get actorId
- `acceptInvitationCore(token, actorId)`
- Si `result.ok === false`, mappea reasons a `ValidationError`/`NotFoundError`/etc.
- Si `ok`, hace los `revalidatePath` + `revalidateMemberPermissions`
- Retorna `{ ok: true, ... }`

Tests existentes del action siguen pasando sin cambios (mismo contrato).

### Cambio 3 — Callback acepta inline

`/auth/invite-callback/route.ts` ya tiene el `next` param (formato
`/invite/accept/<token>`). Después del verifyOtp + user.upsert exitoso:

1. Extraer `<token>` del `next` (regex match)
2. Si match: llamar `acceptInvitationCore(token, user.id)`
3. Si `result.ok`:
   - `revalidatePath` para place + inbox (igual que el action)
   - `revalidateMemberPermissions(actorId, placeId)`
   - Cambiar `redirectTarget` de `/invite/accept/<token>` → `placeUrl(slug)`
4. Si `result.ok === false`:
   - Para errores recuperables (`expired`, `archived`, `over_capacity`,
     `already_used_by_other`, `admin_preset_missing`): redirect a la accept
     page actual con un query `?error=<reason>` para que muestre el mensaje
     apropiado (la accept page ya maneja `not_found`/`expired`/`archived`,
     extender para los nuevos casos)
   - Para `invalid_token`: redirect a `/login?error=invalid_link`

Si el `next` NO matchéa `/invite/accept/<token>` (caso no-invitación, ej.
magic link de re-login): callback hace lo de hoy (redirect a `next`).

### Cambio 4 — Accept page como fallback

NO eliminar `/invite/accept/[token]/page.tsx`. Casos donde el user llega
directo a esa ruta sin pasar por callback:

- User ya autenticado clickea link de invitación (en otro browser ya logueado
  con el mismo email)
- User comparte link de invitación (uso indebido pero soportado)
- Refresh manual de la página

Mantener la accept page con su flow actual: muestra invitation details, botón
"Aceptar". Es el fallback. La mayoría del tráfico irá via callback (1 click).

### Cambio 5 — `accept-invitation-view.tsx` simplificación

Si la mayoría del tráfico llega ya como member (via callback), la view debe
detectar:

- User no es member del place + invitation válida → mostrar botón "Aceptar"
  (flow actual)
- User ya es member del place → mostrar "Ya estás adentro" + link al place
- Invitación inválida / error → mensaje + link "Volver"

La page ya hace `findInvitationByToken` + checks. Sumar check de membership
para mostrar el branch "Ya estás adentro".

## Archivos tocados

| Archivo                                                                    | Cambio                                 | LOC     |
| -------------------------------------------------------------------------- | -------------------------------------- | ------- |
| `src/features/members/invitations/server/accept-core.ts`                   | NEW                                    | ~80     |
| `src/features/members/invitations/server/actions/accept.ts`                | Refactor a wrapper                     | -50 +30 |
| `src/features/members/invitations/server/actions/__tests__/accept.test.ts` | Sin cambios (mismo contrato)           | 0       |
| `src/features/members/invitations/server/__tests__/accept-core.test.ts`    | NEW                                    | ~150    |
| `src/app/auth/invite-callback/route.ts`                                    | Sumar accept inline                    | +60     |
| `src/app/auth/invite-callback/__tests__/route.test.ts`                     | Sumar tests del happy + error paths    | +120    |
| `src/app/invite/accept/[token]/page.tsx`                                   | Detect already-member, render branch   | +20     |
| `src/features/members/invitations/ui/accept-invitation-view.tsx`           | Simplificar (no más POST si ya member) | ±15     |
| `docs/features/members/spec.md` § "Aceptar"                                | Update flow description                | +30     |

**LOC delta total:** ~+440 / -50 = +390 net.

## Test plan

### Unit (Vitest)

- `accept-core.test.ts`: cobertura de cada result.reason
- `accept.test.ts` action: smoke (mismo contrato)

### Route handler (Vitest + mocks)

- `invite-callback`: token `next` matches `/invite/accept/<tok>`
  - Happy: verifyOtp OK + acceptCore OK → redirect a placeUrl
  - acceptCore returns `expired` → redirect a accept page con `?error=expired`
  - acceptCore returns `over_capacity` → redirect con error
  - acceptCore throws unexpected → log + redirect a accept page (fallback safe)
- `invite-callback`: token `next` NO matches → comportamiento actual (redirect a next)

### E2E manual checklist

- [ ] User nuevo (sin sesión, sin cookies): click email → "Continuar" → DIRECTO al place ✓
- [ ] User ya autenticado en otro browser: click email → "Continuar" → DIRECTO al place ✓
- [ ] User clickea email de invitación expirada: → mensaje "Invitación expirada" ✓
- [ ] User clickea email de invitación a place archivado: → mensaje "Place archivado" ✓
- [ ] User llega directo a `/invite/accept/<token>` (sin callback): página actual con botón Aceptar ✓
- [ ] User ya member del place clickea email otra vez: → DIRECTO al place (idempotente) ✓
- [ ] Safari iOS: el flow funciona (PÁGINA 1 con click "Continuar" preserva ITP fix) ✓

## Riesgos

1. **Cleanup pre-launch**: el plan agrega complejidad al callback (route handler).
   El callback ya estaba tocado por el bug de cookies; agregar accept inline lo
   hace más crítico. Mitigación: tests robustos del happy + 4-5 error paths.

2. **Cookies stale**: si el user tiene cookies residuales (bug original), el
   accept en el callback puede fallar a nivel storage cuando el SDK setea las
   nuevas cookies. Mitigación: el cleanup defensivo en middleware (deploy de
   2026-05-10) ya cubre este caso. Tras stale, próxima visita es limpia.

3. **Idempotencia**: si el user clickea el email DOS veces, el primer callback
   acepta + redirect; el segundo va a fallar verifyOtp porque token consumido.
   Mitigación: el callback ya maneja `verifyOtp_failed` → mostrar `/login?error=invalid_link`.
   El user tiene la membership creada del primer click — al loguearse con magic
   link después puede entrar al place desde el inbox.

4. **Error UX**: redirect a accept page con `?error=expired` requiere que la
   page muestre ese error. Hoy la page maneja errores via `<InvitationProblem>`
   internamente. Sumar query param parsing es un toque trivial.

## Cumplimiento CLAUDE.md

- ✅ Sesión focalizada: solo backend + 1 modif UI menor
- ✅ TDD: tests primero del accept-core + route handler tests
- ✅ Vertical slices: cambios en `features/members/invitations/`, `app/auth/invite-callback/`, `app/invite/accept/`
- ✅ Idioma: comentarios en español, código en inglés
- ✅ Tipos estrictos: result discriminated union
- ✅ LOC limits: archivo más grande post-cambios `route.ts` ~150 LOC, accept-core ~80 LOC

## Estimado

~1 sesión focalizada de 1.5h:

1. Refactor accept-core + tests (~30 min)
2. Modificar callback + tests (~30 min)
3. Update accept page para handling already-member + error params (~20 min)
4. Update spec doc (~10 min)
5. E2E manual checklist (~10 min)

## Pre-requisitos

- Cleanup defensivo middleware deployado (commit pendiente 2026-05-10) ✓
- Confirmar empíricamente que Safari iOS sigue funcionando con flow actual
  (PÁGINA 1 + redirect directo al place, sin PÁGINA 2)
