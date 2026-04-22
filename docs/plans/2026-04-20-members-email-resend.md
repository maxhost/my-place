# Plan — Invitaciones por email con Resend (`ogas.ar`) + resend + webhook

**Fecha:** 2026-04-20
**Estado:** En ejecución
**ADR relacionado:** `docs/decisions/2026-04-20-mailer-resend-primary.md`
**Spec afectada:** `docs/features/members/spec.md` §100-106 (se reescribe en S6)

## Contexto

El flujo actual de invitación (`src/features/members/server/actions.ts:88`) llama a
`supabase.auth.admin.inviteUserByEmail`, que falla con **422 `email_exists`** cuando
el invitado ya tiene cuenta en `auth.users`. Como Place es multi-place por diseño
(`spec.md:137`), ese error es el caso **frecuente**, no el edge case.

Agravantes acoplados descubiertos en diagnóstico previo:

- **UX:** el form muestra "Error inesperado" porque `instanceof DomainError` falla
  cruzando el boundary del server action (Next 15 pierde la prototype chain en
  serialización). Afecta a toda la feature.
- **Rate limits de Supabase:** el SMTP interno tiene 60s por email + cap horario.
  Incluso si arreglamos el 422, el envío queda frágil.
- **Tx frágil:** el envío de email está _dentro_ de `prisma.$transaction`. Si el
  send ok + commit falla, el email salió sin `Invitation` persistida.

## Decisión

Usar **Resend** (dominio `ogas.ar` verificado, temporal) como mailer primario.
Supabase Auth admin queda solo como **generador de URLs** (`generateLink`), sin
envío — bypass completo del SMTP de Supabase y sus rate limits.

Detalle arquitectónico y rationale en el ADR.

## Shape final del flujo

```
inviteMemberAction(input)
 ├─ validate + authorize
 ├─ prisma.$transaction { INSERT Invitation (deliveryStatus=PENDING) }  ← tx corta
 ├─ generateInviteMagicLink(email, redirectTo)                          ← fuera de tx
 │    ├─ try generateLink({type:'invite'})
 │    └─ if 422 email_exists → generateLink({type:'magiclink'})
 ├─ mailer.sendInvitation({to, placeName, inviterName, url, expiresAt})
 ├─ UPDATE Invitation { providerMessageId, deliveryStatus: SENT }
 └─ on any post-commit failure → UPDATE deliveryStatus=FAILED + lastDeliveryError

resendInvitationAction(invitationId)
 ├─ authz: actor es inviter o admin del place
 ├─ precond: invitation no expirada, no aceptada
 ├─ generateInviteMagicLink(email, redirectTo)  ← nuevo magic link, token sigue igual
 ├─ mailer.sendInvitation(...)
 └─ UPDATE providerMessageId + deliveryStatus

POST /api/webhooks/resend
 ├─ verify svix signature
 ├─ parse email.{sent,delivered,bounced,complained}
 ├─ find Invitation by providerMessageId
 └─ UPDATE deliveryStatus con transición válida (idempotente)
```

## Config

**Env vars nuevas** (agregar a `src/shared/config/env.ts` y `.env.example`):

```
RESEND_API_KEY=re_...
EMAIL_FROM="Place <hola@ogas.ar>"
RESEND_WEBHOOK_SECRET=whsec_...   # svix, settable desde Resend dashboard
```

**Sin `EMAIL_REPLY_TO`** — decisión del user: reply desactivado. El header no se
incluye en el send; respuestas rebotan al `From` (que es un buzón que no atendemos).

**Dev local:** si `RESEND_API_KEY` no está seteada, el factory devuelve
`FakeMailer` (loguea a stdout + guarda último email en `globalThis` para debug).
En `NODE_ENV=production` sin key → crash al boot (Zod required).

## Schema Prisma — cambios en `Invitation`

```prisma
model Invitation {
  // ... campos existentes
  deliveryStatus     InvitationDeliveryStatus @default(PENDING)
  providerMessageId  String?
  lastDeliveryError  String?  // truncado a 500 chars en app layer
  lastSentAt         DateTime?
}

enum InvitationDeliveryStatus {
  PENDING      // row creada, mailer aún no intentado
  SENT         // mailer devolvió 200
  DELIVERED    // webhook email.delivered
  BOUNCED      // webhook email.bounced
  COMPLAINED   // webhook email.complained (spam report)
  FAILED       // mailer devolvió error; reenviable
}
```

## Error taxonomy

Nuevos `DomainError` subclasses:

- `InvitationLinkGenerationError` — código `INVITATION_LINK_GENERATION`. Falla en `generateLink` (ambos intentos).
- `InvitationEmailFailedError` — código `INVITATION_EMAIL_FAILED`. Falla en mailer.

Fix transversal:

- `isDomainError` pasa a **shape-based** (chequea `code` enumerable string),
  no `instanceof`. Esto sobrevive la serialización del server action boundary.
- Constructores de subclases asignan `this.code` explícitamente (no solo
  `readonly` field) para garantizar enumerabilidad en el JSON del boundary.
- Test `domain-error-serialization.test.ts` asegura regresión 0.

`friendlyMessage` en `invite-form.tsx` gana dos ramas nuevas. Nunca más cae a
"Error inesperado" para errores tipados.

## Template email

React Email, tono Place (sin CTAs gritones, sin tracking pixel, sin marketing):

```
Asunto: {inviterName} te invitó a {placeName}

Hola,

{inviterName} te abrió la puerta a {placeName}.

    [Entrar a {placeName}]  ← botón
    {inviteUrl}               ← link textual para accesibilidad / clientes que no renderizan

El link vence el {expiresAt}.

Si no lo pediste, ignoralo — no pasa nada.

—
Place · {placeName}
```

Versión plaintext incluida para deliverability.

## UI — pending invitations

Nueva sección en `settings/members` entre "Invitar" y "Transferir":

```
Invitaciones pendientes (3)
───────────────────────────
maria@example.com  · SENT      · vence 27 abr  [Reenviar]
juan@example.com   · BOUNCED   · vence 25 abr  [Reenviar]
ana@example.com    · PENDING   · vence 28 abr  [Reenviar]
```

Sin contadores agresivos, sin colores llamativos — status badges neutras
(border + color sutil), botón Reenviar tipo link.

## Webhook Resend

Endpoint: `POST /api/webhooks/resend`

- Valida firma con `svix` (Resend stack).
- Parse evento → lookup `Invitation` por `providerMessageId`.
- Update de `deliveryStatus` con **transiciones válidas** (idempotencia): no
  baja de `DELIVERED` a `SENT` si llega un evento viejo fuera de orden.
- 400 si firma inválida; 200 en todo otro caso (no retry desde Resend para eventos
  desconocidos).

Setup del webhook en Resend dashboard → URL pública del deploy. Para staging/prod,
cada ambiente tiene su endpoint. Dev local no recibe webhooks (fake mailer no
dispara).

## División en sesiones

Cada sesión es un contexto independiente. Al final de cada una: `pnpm typecheck && pnpm test && pnpm lint` verde + commit. Contexto siguiente arranca fresco leyendo este doc.

---

### S1 — Infra: Mailer module

**Objetivo:** módulo `shared/lib/mailer/` funcional con Resend + Fake, template
React Email, env wireado. Sin acoplar aún a members.

**Archivos:**

- `src/shared/lib/mailer/types.ts` — interface `Mailer`, `SendResult`, `InvitationEmailInput`.
- `src/shared/lib/mailer/resend-mailer.ts` — impl con Resend SDK.
- `src/shared/lib/mailer/fake-mailer.ts` — captura en memoria + log dev.
- `src/shared/lib/mailer/provider.ts` — factory por env.
- `src/shared/lib/mailer/index.ts` — barrel.
- `src/shared/lib/mailer/templates/invitation.tsx` — React Email + plaintext.
- `src/shared/lib/mailer/__tests__/resend-mailer.test.ts` — mock `fetch`.
- `src/shared/lib/mailer/__tests__/fake-mailer.test.ts`.
- `src/shared/lib/mailer/__tests__/invitation-template.test.tsx` — snapshot.
- `src/shared/config/env.ts` — agrega `RESEND_API_KEY`, `EMAIL_FROM`, `RESEND_WEBHOOK_SECRET` (últimas dos opcionales si `NODE_ENV !== 'production'`).
- `.env.example` — nuevas keys con comentarios.
- `CLAUDE.md` § Gotchas — entry sobre Resend domain verification + dev fallback.

**Deps:** `pnpm add resend @react-email/components @react-email/render svix`.

**Dependencia:** ninguna. Puede empezar ya.

**Exit gate:** `pnpm typecheck && pnpm test && pnpm lint` verde. Fake mailer
invocable desde un REPL dev y devuelve el email capturado.

---

### S2 — Infra: admin-links + domain errors + Prisma migration

**Objetivo:** primitivas para que S3 pueda reescribir la action sin fricción.

**Archivos:**

- `src/shared/lib/supabase/admin-links.ts` — `generateInviteMagicLink()` con fallback invite→magiclink.
- `src/shared/lib/supabase/__tests__/admin-links.test.ts` — mock del SDK, 3 casos: invite ok, invite 422 → magiclink ok, ambos error.
- `src/shared/errors/domain-error.ts` — `isDomainError` shape-based + constructores que marcan `code` enumerable + `InvitationLinkGenerationError` + `InvitationEmailFailedError`.
- `src/shared/errors/__tests__/domain-error-serialization.test.ts` — nuevo test que simula el boundary (JSON roundtrip) y verifica que `isDomainError` + `code` sobreviven.
- `prisma/schema.prisma` — nuevos campos + enum `InvitationDeliveryStatus`.
- `prisma/migrations/<ts>_invitation_delivery_tracking/migration.sql` — crea enum, agrega columnas con `DEFAULT 'PENDING'`, backfill implícito.

**Dependencia:** S1 (env vars definidos).

**Exit gate:** migration aplica clean contra DB local; `pnpm prisma generate`
actualiza tipos; tests del wrapper y de serialización verdes.

---

### S3 — Members backend: inviteMemberAction + resendInvitationAction

**Objetivo:** action reescrita + nueva action de resend + tests.

**Archivos:**

- `src/features/members/server/actions.ts` — reescribir `inviteMemberAction`; nueva `resendInvitationAction`.
- `src/features/members/schemas.ts` — nuevo `resendInvitationSchema`.
- `src/features/members/server/queries.ts` — nueva `listPendingInvitationsByPlace` + `findInvitationById` (si no existe).
- `src/features/members/public.ts` — exports nuevos.
- `src/features/members/__tests__/invite-member.test.ts` — actualizar al contrato nuevo (FakeMailer, 4 casos: nuevo-user happy, existing-user happy, link-gen falla, mailer falla).
- `src/features/members/__tests__/resend-invitation.test.ts` — nuevo.

**Dependencia:** S1 + S2.

**Exit gate:** todos los tests de members verdes; `pnpm typecheck` ok; no hay
imports nuevos cross-slice.

---

### S4 — Members UI: invite form + pending list + resend button

**Objetivo:** UI admin completa.

**Archivos:**

- `src/features/members/ui/invite-form.tsx` — `friendlyMessage` con códigos nuevos; elimina rama `manual_share` (no aplica con mailer propio).
- `src/features/members/ui/pending-invitations-list.tsx` — nuevo, Server Component (la fetch), renderiza rows.
- `src/features/members/ui/resend-invitation-button.tsx` — nuevo, Client Component con `useMutation` (TanStack Query, consistente con el resto del slice).
- `src/features/members/public.ts` — export `PendingInvitationsList`.
- `src/app/[placeSlug]/settings/members/page.tsx` — agrega sección "Invitaciones pendientes".
- `src/features/members/__tests__/pending-invitations-list.test.tsx` — render + status badges.
- `src/features/members/__tests__/resend-invitation-button.test.tsx` — click → mutation llamada.

**Dependencia:** S3.

**Exit gate:** UI navegable en dev, botón reenvía, status visible, `pnpm test` verde.

---

### S5 — Webhook Resend

**Objetivo:** endpoint que cierra el loop de observabilidad.

**Archivos:**

- `src/app/api/webhooks/resend/route.ts` — POST handler con svix verify + state machine.
- `src/app/api/webhooks/resend/__tests__/route.test.ts` — payload firmado, 400 si firma inválida, 200 con update válido, idempotencia si llega el mismo evento dos veces.
- `docs/features/members/spec.md` — nota en §100-106 (reescrita en S6) sobre estados de delivery.

**Dependencia:** S2 (schema). Puede correr en paralelo a S4.

**Exit gate:** test verde; webhook recibe payload de prueba generado por svix y
updatea la DB correctamente.

---

### S6 — Spec + verificación e2e + cierre

**Objetivo:** documentación alineada y prueba punta-a-punta.

**Archivos:**

- `docs/features/members/spec.md` — reescribir §100-106 (el flujo de email ahora es Resend; outdated claim de "Supabase crea al aceptar" eliminado).
- `docs/decisions/2026-04-20-mailer-resend-primary.md` — marcar implementado + cualquier ajuste descubierto durante la ejecución.
- `docs/roadmap.md` — tachar bug 1 del tracker.

**Verificación automatizada:** `pnpm typecheck && pnpm test && pnpm lint && pnpm build`.

**Verificación manual (dev server):**

1. Loguearse como admin A.
2. Invitar email real `maxhost27@gmail.com` (existente en `auth.users`) → ver "Invitación enviada".
3. Ver dashboard Resend: email enviado.
4. Click link → /invite/accept/<token> → Membership creada.
5. Volver a `settings/members` → ver invitación con `deliveryStatus=DELIVERED` (si webhook local configurado; si no, queda `SENT`, aceptable).
6. Invitar email nuevo → crea auth user + email enviado + accept flow.
7. Invitar email inválido (dominio bounce) → `deliveryStatus=BOUNCED` via webhook.
8. Click "Reenviar" en invitación pending → nuevo email con nuevo magic link URL, token sigue válido.

**Dependencia:** todas las anteriores.

**Exit gate:** checklist manual OK + commits limpios + tag de PR list.

---

## Riesgos (consolidados)

| Riesgo                                                                               | Mitigación                                                                                             |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| DNS de `ogas.ar` sin SPF/DKIM/DMARC correctos → emails a spam                        | Verificar en dashboard Resend antes de S6 manual. mail-tester.com como smoke.                          |
| Versión de `@supabase/supabase-js` no soporta `generateLink` como se espera          | En S2, test real contra SDK antes de confiar en shape.                                                 |
| Magic link TTL (1h Supabase) < token TTL (7d) — user abre email tarde                | Botón Reenviar lo resuelve. Documentar en spec.                                                        |
| Webhook Resend: clock skew del svix verify                                           | Tolerancia 5min default del svix lib.                                                                  |
| `globalThis` del FakeMailer se comparte entre tests                                  | Reset en `beforeEach`.                                                                                 |
| `JSON roundtrip` en test de serialización no replica exactamente el boundary de Next | Test adicional e2e en S6 valida con action real.                                                       |
| Resend webhook desconfigurado en prod inicial                                        | Sin webhook, `deliveryStatus` queda en `SENT` tras mailer ok. Degrada bien — no rompe envío ni accept. |

## Fuera de scope

- UI para ver `bounced` invitations con razón específica (S4 muestra solo el status).
- Retry automático del mailer (admin decide con botón Reenviar).
- Unsubscribe link (transaccional, no aplica).
- Email de bienvenida post-accept (feature separada).
- Migrar de `ogas.ar` a dominio definitivo (cambio de env var + DNS, no código).
