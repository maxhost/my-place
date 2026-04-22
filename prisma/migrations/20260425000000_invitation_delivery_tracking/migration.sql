-- Delivery tracking para Invitation.
-- Ver docs/plans/2026-04-20-members-email-resend.md § S2.
--
-- Contrato:
-- - Rows existentes backfillean a PENDING (asumimos email no enviado). Esto
--   es conservador: el botón "Reenviar" de la UI se habilita para PENDING,
--   así que un admin puede reactivar invitaciones legacy si hace falta.
-- - `providerMessageId` indexable para lookup O(1) desde webhook.

CREATE TYPE "InvitationDeliveryStatus" AS ENUM (
  'PENDING',
  'SENT',
  'DELIVERED',
  'BOUNCED',
  'COMPLAINED',
  'FAILED'
);

ALTER TABLE "Invitation"
  ADD COLUMN "deliveryStatus"    "InvitationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "providerMessageId" TEXT,
  ADD COLUMN "lastDeliveryError" TEXT,
  ADD COLUMN "lastSentAt"        TIMESTAMP(3);

CREATE INDEX "Invitation_providerMessageId_idx" ON "Invitation" ("providerMessageId");
