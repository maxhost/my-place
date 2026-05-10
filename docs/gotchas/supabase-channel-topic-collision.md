# Supabase Realtime: `supabase.channel(topic)` dedupea por topic — presence + broadcast en el mismo topic colisionan

`@supabase/realtime-js` (v2.103.x) **dedupea channels por topic exacto**:

```js
// node_modules/@supabase/realtime-js/dist/main/RealtimeClient.js
channel(topic, params) {
  const realtimeTopic = `realtime:${topic}`
  const exists = this.getChannels().find((c) => c.topic === realtimeTopic)
  if (!exists) { ...crear nuevo... }
  else { return exists }  // ← reusa channel existente
}
```

Y `RealtimeChannel.on()` tiene un guard que **prohíbe agregar callbacks de `presence` o `postgres_changes` después de `subscribe()`**:

```js
const stateCheck = isJoined() || isJoining()
const typeCheck = type === PRESENCE || type === POSTGRES_CHANGES
if (stateCheck && typeCheck) {
  throw new Error(`cannot add \`${type}\` callbacks for ${topic} after \`subscribe()\`.`)
}
```

(`broadcast` callbacks SÍ se aceptan post-subscribe — el guard sólo aplica a presence + postgres_changes.)

## Síntoma

En el browser console aparece:

```
cannot add presence callbacks for realtime:post:<postId> after subscribe().
```

La página queda capturada por un error boundary local con copy genérico tipo "Algo no salió bien". **Cero logs en runtime de Vercel** porque el throw es 100% client-side.

## Causa raíz

Múltiples componentes que comparten el mismo topic. Caso real (commit a994f24..7c329f4):

- `<PostHiddenWatcher>` y `<CommentRealtimeAppender>` (en `_comments-section.tsx`) abren `post:<id>` para escuchar broadcasts (`post_hidden`, `comment_created`).
- `<ThreadPresence>` (en `_thread-content.tsx`) abre **el mismo** `post:<id>` para presence.

Ambos están bajo `<Suspense>` distintos en el page de `/conversations/[postSlug]`. El orden de mount no es determinístico — depende de qué query Suspense termine primero.

Si los broadcast watchers montan primero, llaman `subscribe()` y el channel pasa a JOINING/JOINED. Cuando ThreadPresence monta, `supabase.channel('post:<id>')` le devuelve **el mismo channel ya subscrito**, y el primer `channel.on('presence', ...)` throwea.

## Fix aplicado

**Topic split**: presence usa topic dedicado `post:<id>:presence`. Broadcast watchers siguen usando `post:<id>`. Cero colisión.

- Code: `src/features/discussions/ui/thread-presence.tsx` (legacy wireado) + `src/features/discussions/presence/ui/thread-presence.tsx` (sub-slice, defensivo).
- Migration: `prisma/migrations/20260509230000_realtime_topic_split_presence/migration.sql` actualiza `realtime.discussions_post_id_from_topic()` para extraer postId con `split_part(substring(topic FROM 6), ':', 1)`. Backward-compat completa: matchea `post:<id>` legacy y `post:<id>:<suffix>` nuevo.
- Las policies en `realtime.messages` usan `LIKE 'post:%'` y ya cubren ambos formatos sin cambios.
- Test: `tests/rls/helpers-realtime.test.ts` valida los 4 casos (legacy, presence, multi-suffix, topic no matcheante).

ADR completo con alternativas descartadas: `docs/decisions/2026-05-09-realtime-presence-topic-split.md`.

## Convención

**Para cualquier nueva feature que abra channels Supabase Realtime sobre un topic ya en uso**, decidir explícitamente entre:

1. **Mismo topic + sólo `broadcast`** (callbacks aceptados anytime, sin guard) → seguro, OK reusar topic.
2. **Mismo topic + presence o postgres_changes** → **PELIGRO**: usar topic con suffix dedicado (`post:<id>:<feature>`) para evitar colisión.

El shared `SupabaseBroadcastSubscriber` usa `broadcast` y por eso es safe compartir topic entre múltiples consumers de broadcast (PostHidden + CommentRealtime hoy). El día que se sume otro consumer de `presence` para el mismo dominio, repetir el patrón de suffix.

## Limitación conocida (no fixeada)

Si las deps del `useEffect` de ThreadPresence cambian mid-session (ej: `viewer.displayName` se actualiza en otra tab), React corre cleanup → effect de nuevo. El cleanup hace `channel.unsubscribe()` + `removeChannel()` async (returns Promise, no awaited). React no espera Promises de cleanups, así que el siguiente effect puede correr antes del removeChannel completo → `supabase.channel()` devuelve el mismo channel todavía SUBSCRIBED → `on('presence', ...)` throwea de nuevo.

En este codebase el viewer no cambia mid-session (se carga server-side y se pasa como prop estática), así que la race es teórica. Si en el futuro el viewer puede mutarse en runtime, fixear con: (a) deps reducidas a `[postId, viewer.userId]` + actualizar display/avatar via `channel.track()` sin remount, o (b) ref con flag de "channel torn down" para esperar el cleanup async.
