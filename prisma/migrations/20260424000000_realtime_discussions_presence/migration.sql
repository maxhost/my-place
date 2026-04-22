-- Realtime Authorization para topics `post:<id>` (presencia en threads del foro).
-- Ver docs/realtime.md + plan C.F.
--
-- Arquitectura: Supabase Realtime con private channels. El cliente opta-in con
-- `{config: {private: true}}` al crear el channel. Supabase chequea las policies
-- sobre `realtime.messages` antes de permitir subscribir (SELECT) y trackear
-- presencia (INSERT).
--
-- IMPORTANTE: este toggle debe estar activado en Dashboard → Project Settings →
-- Realtime → "Enable Realtime Authorization". Con OFF, las policies se ignoran
-- silenciosamente (ver CLAUDE.md § Gotchas).
--
-- NOTA: `Membership.userId` es TEXT (consistente con `User.id`). Casteamos
-- `auth.uid()` a text, igual que en la migración 20260422000100_discussions_rls.

-- Idempotencia: re-apply local + staging sin fallar si ya existen.
DROP POLICY IF EXISTS "discussions_thread_receive" ON realtime.messages;
DROP POLICY IF EXISTS "discussions_thread_send" ON realtime.messages;
DROP FUNCTION IF EXISTS realtime.discussions_viewer_is_thread_member();
DROP FUNCTION IF EXISTS realtime.discussions_post_id_from_topic();

-- Extraer postId del topic 'post:<id>'.
CREATE OR REPLACE FUNCTION realtime.discussions_post_id_from_topic()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN realtime.topic() LIKE 'post:%' THEN substring(realtime.topic() FROM 6)
    ELSE NULL
  END
$$;

-- Helper booleano: viewer es miembro activo del place del post.
--
-- Decisión explícita: NO filtra `hiddenAt` — admin debe poder ver presencia en
-- posts ocultos (consistente con la vista admin de la lista que los renderiza
-- con badge). Solo filtra `deletedAt` (soft-delete del contenido). Miembros no
-- admin ya reciben 404 a nivel app layer en
-- `src/app/[placeSlug]/(gated)/conversations/[postSlug]/page.tsx:33`, así que
-- la policy permisiva en hidden no expone contenido oculto.
CREATE OR REPLACE FUNCTION realtime.discussions_viewer_is_thread_member()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "Post" p
    JOIN "Membership" m
      ON m."placeId" = p."placeId"
     AND m."userId" = auth.uid()::text
     AND m."leftAt" IS NULL
    WHERE p.id = realtime.discussions_post_id_from_topic()
      AND p."deletedAt" IS NULL
  )
$$;

-- SELECT: permitir subscribir (recibir broadcasts/presence) si es miembro del place.
CREATE POLICY "discussions_thread_receive"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  realtime.topic() LIKE 'post:%'
  AND realtime.discussions_viewer_is_thread_member()
);

-- INSERT: permitir trackear presence (channel.track) si es miembro del place.
CREATE POLICY "discussions_thread_send"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (
  realtime.topic() LIKE 'post:%'
  AND realtime.discussions_viewer_is_thread_member()
);
