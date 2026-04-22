# ADR — Resend como mailer primario; Supabase Auth como generador de URLs

**Fecha:** 2026-04-20
**Estado:** Implementada (2026-04-20)
**Plan de ejecución:** `docs/plans/2026-04-20-members-email-resend.md`

## Implementación

Completada en 6 sesiones (S1–S6). Superficies tocadas:

- `src/shared/lib/mailer/` — nuevo módulo con `Mailer` interface, `ResendMailer`, `FakeMailer`, template JSX inline.
- `src/shared/lib/supabase/admin-links.ts` — `generateInviteMagicLink` con fallback `invite → magiclink` al detectar 422 `email_exists`.
- `src/shared/errors/domain-error.ts` — `isDomainError` shape-based + 2 subclases nuevas. Sobrevive el boundary de server actions de Next 15.
- `src/features/members/` — `inviteMemberAction` reescrito (tx corta + delivery fuera de tx), nuevo `resendInvitationAction`, `PendingInvitationsList` + `ResendInvitationButton` en `/settings/members`.
- `src/app/api/webhooks/resend/route.ts` — svix verify + máquina de estados monótona (`PENDING < FAILED < SENT < DELIVERED < BOUNCED ≡ COMPLAINED`, con `BOUNCED`/`COMPLAINED` terminales).
- `prisma/migrations/20260425000000_invitation_delivery_tracking/migration.sql` — enum + 4 columnas + índice.

445 tests verdes al cierre.

## Contexto

El flujo de invitaciones (feature `members`) depende del SMTP interno de
Supabase Auth vía `admin.auth.admin.inviteUserByEmail()`. Dos limitaciones
estructurales se descubrieron en producción local:

1. **`inviteUserByEmail` falla 422 `email_exists`** cuando el invitado ya tiene
   cuenta en `auth.users`. En un producto multi-place (`docs/features/members/spec.md:137`)
   ese caso es el frecuente, no el edge.
2. **Rate limits agresivos** del SMTP de Supabase: 60s por email, cap horario
   bajo. Un admin invitando 5 personas seguidas toca el límite.

## Decisión

Separar generación de URL de envío:

- **Supabase Auth admin API** se usa solo para `generateLink` (`type:'invite'` con
  fallback a `type:'magiclink'` si el user ya existe). `generateLink` devuelve
  URL sin enviar email — no consume rate limits del SMTP de Supabase.
- **Resend** (dominio `ogas.ar` verificado, temporal) envía todos los emails
  transaccionales de la app, empezando por invitaciones. Template en React Email.
- **Webhook de Resend** actualiza `Invitation.deliveryStatus` (SENT → DELIVERED /
  BOUNCED / COMPLAINED). Closed loop de observabilidad.
- **Botón Reenviar** en `settings/members` permite al admin forzar un nuevo
  envío sin rotar el token de invitación.

## Alternativas consideradas

- **A — `inviteUserByEmail` con pre-check de existencia.** Requeriría `listUsers`
  filter por email (paginado y lento) o branching por error. Seguiría atado a
  los rate limits de Supabase. Descartada.
- **B — Usar SMTP custom en Supabase Auth con proveedor externo.** Se mantiene
  la dependencia de Supabase dispatchando, heredando su rate limiting interno y
  sin webhooks de entrega visibles. Descartada.
- **C — Mailer propio solo para user-existente; Supabase para nuevos.** La
  versión inicial de este plan. Descartada al confirmar que `ogas.ar` está
  verificado en Resend: no hay razón para mantener dos paths.

## Consecuencias

**Positivas:**

- Rate limits de Supabase dejan de aplicar al flujo de invitaciones.
- Observabilidad end-to-end con webhook (sent / delivered / bounced / complained).
- Template y copy controlados por nosotros; alineados al tono Place.
- Interfaz `Mailer` queda lista para reusar en futuras notificaciones (welcome,
  digests, etc.) sin tocar Supabase.

**Negativas / costos:**

- Dependencia nueva: Resend (API + SDK + webhook). Una caída de Resend bloquea
  envío; mitigamos con `deliveryStatus=FAILED` + botón Reenviar.
- Env vars nuevas: `RESEND_API_KEY`, `EMAIL_FROM`, `RESEND_WEBHOOK_SECRET`.
- DNS del dominio sender requiere SPF/DKIM/DMARC (ya hechos para `ogas.ar`).
- Dev local: agregamos `FakeMailer` (no requiere API key).

**Deuda conocida:**

- `ogas.ar` es temporal. Migración al dominio definitivo = cambio de env vars +
  DNS, sin código.
- `Reply-To` desactivado por decisión del user (buzón de respuestas no se
  atiende en MVP). Re-habilitar requiere un email real de soporte.

## Referencias

- Plan de ejecución: `docs/plans/2026-04-20-members-email-resend.md`
- Spec afectada: `docs/features/members/spec.md` §100-106 (reescrita al cerrar el plan)
- Código punto de entrada: `src/shared/lib/mailer/`
