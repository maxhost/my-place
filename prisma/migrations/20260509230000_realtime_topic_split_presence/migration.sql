-- Topic split presence: ThreadPresence migra de `post:<id>` a
-- `post:<id>:presence` para evitar colisión con los broadcast watchers
-- (PostHiddenWatcher, CommentRealtimeAppender) que comparten `post:<id>`.
--
-- Por qué: `RealtimeClient.channel(topic)` de @supabase/realtime-js v2
-- DEDUPEA channels por topic exacto. Cuando un broadcast watcher monta
-- primero, llama `subscribe()` y el channel queda en estado
-- JOINING/JOINED. Cuando ThreadPresence monta y pide el mismo topic,
-- recibe ese channel ya subscrito; el siguiente `channel.on('presence', ...)`
-- throwea con `cannot add presence callbacks for ... after subscribe()`
-- (guard explícito en RealtimeChannel.on() — presence/postgres_changes
-- callbacks no se aceptan después de subscribe).
--
-- Detalle del bug + fix + alternativas en
-- `docs/gotchas/supabase-channel-topic-collision.md` y ADR
-- `docs/decisions/2026-05-09-realtime-presence-topic-split.md`.
--
-- Esta migration sólo actualiza la SQL function que extrae el postId del
-- topic. Las policies en `realtime.messages` (`discussions_thread_receive`,
-- `discussions_thread_send`) usan `LIKE 'post:%'` y ya matchean ambos
-- formatos sin cambios — no se tocan.
--
-- Backward-compat completa: la función sigue devolviendo el postId correcto
-- para `post:<id>` (formato legacy de broadcast) y además acepta
-- `post:<id>:<suffix>` (presence + futuros). Si la migration se aplica
-- antes que el deploy del código nuevo, el código viejo sigue funcionando.
-- Si el deploy va primero, presence queda degradada (sin avatares) hasta
-- aplicar la migration, sin tirar 5xx ni romper la página (RLS deniega
-- silenciosamente la subscription).

CREATE OR REPLACE FUNCTION realtime.discussions_post_id_from_topic()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN realtime.topic() LIKE 'post:%' THEN
      split_part(substring(realtime.topic() FROM 6), ':', 1)
    ELSE NULL
  END
$$;
