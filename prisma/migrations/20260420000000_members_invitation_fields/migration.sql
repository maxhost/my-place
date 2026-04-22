-- Slice `members` (2.E): agrega flag `asAdmin` y unique parcial para invitaciones abiertas.
-- Ver docs/features/members/spec.md.

-- Columna `asAdmin`: define el rol que recibirá el invitee al aceptar (MEMBER vs ADMIN).
-- No otorga `PlaceOwnership` — ownership se transfiere por flow aparte.
ALTER TABLE "Invitation"
  ADD COLUMN "asAdmin" BOOLEAN NOT NULL DEFAULT false;

-- Unique parcial: una única invitación abierta (acceptedAt IS NULL) por (placeId, email).
-- Email normalizado a lower() para evitar duplicados por casing.
-- Postgres trata dos NULL como distintos en unique regular, por eso no alcanza con @@unique.
-- Re-invitar post-aceptación o post-expiración sigue permitido.
CREATE UNIQUE INDEX "invitation_open_unique"
  ON "Invitation" ("placeId", lower("email"))
  WHERE "acceptedAt" IS NULL;
