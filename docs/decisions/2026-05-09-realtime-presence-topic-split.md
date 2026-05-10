# Realtime: topic split para presence — `post:<id>` (broadcast) vs `post:<id>:presence`

**Fecha:** 2026-05-09
**Estado:** Aceptada
**Origen:** Bug de producción reportado en `the-company.place.community/conversations/una-prueba-adicional`. Browser console mostraba `cannot add presence callbacks for realtime:post:<id> after subscribe()`. Diagnóstico completo en `docs/gotchas/supabase-channel-topic-collision.md`.

## Contexto

El ADR `2026-04-21-shared-realtime-module.md` (C.J) introdujo `shared/lib/realtime/` con `SupabaseBroadcastSubscriber` para que las features compartan el transport de broadcasts en private channels. Su § "Consecuencias" incluía:

> "thread-presence.tsx hoy usa `supabase.channel()` inline; migrarlo a `SupabaseBroadcastSubscriber` es refactor agendado, **no bloqueante**."

Resultó bloqueante. La razón técnica:

- `@supabase/realtime-js@2.103.x` dedupea channels por topic exacto: `supabase.channel('post:<id>')` devuelve el mismo `RealtimeChannel` instance si ya existe uno para ese topic.
- `RealtimeChannel.on()` rechaza con throw cualquier callback de tipo `presence` o `postgres_changes` agregado después de `subscribe()`. Broadcast callbacks NO tienen esta restricción.
- En el thread detail, `<PostHiddenWatcher>` y `<CommentRealtimeAppender>` (broadcast subscribers vía `SupabaseBroadcastSubscriber`) y `<ThreadPresence>` (presence subscriber inline) **comparten** topic `post:<id>`. Ambos viven bajo `<Suspense>` distintos en el page; el orden de mount no es determinístico.
- Cuando los broadcast watchers ganan la carrera, llaman `subscribe()` y el channel pasa a JOINING/JOINED. Cuando ThreadPresence monta, recibe el channel ya subscrito y el primer `channel.on('presence', ...)` throwea — el throw bubblea al error boundary y la página queda inutilizable.

El bug existe desde C.J pero permaneció latente: hasta hoy, ThreadPresence ganaba la carrera por ser un Suspense child más rápido. Cambios de bundle/perf de los últimos meses invirtieron el orden de resolución.

## Alternativas consideradas

### A. Extender `shared/lib/realtime` con `SupabasePresenceSubscriber`

ThreadPresence migra a un nuevo método `subscriber.subscribePresence(topic, ...)`. El shared centraliza el lifecycle del channel y registra todos los listeners (presence + broadcast del mismo topic) ANTES de subscribe.

- **Pros**: alineado con la dirección eventual del ADR original. Todo realtime en un módulo.
- **Contras**:
  - Presence tiene API estructuralmente diferente a broadcast: `track()` + `presenceState()` + sync/join/leave events, vs broadcast = single `event + payload`. El subscriber tendría que conocer ambos protocolos, rompiendo la pureza "topic agnostic" del shared.
  - Requiere coordinator pattern: el shared tiene que saber **antes** de llamar `subscribe()` qué presence callbacks va a recibir. Eso fuerza sincronización entre componentes que viven bajo distintos `<Suspense>` — refactor invasivo en el slice de discussions y futuro en el de events.
  - No resuelve el problema general — sólo lo desplaza al shared.

**Descartada.** Si se justifica en el futuro (más features con presence), se vuelve a evaluar con su propio ADR.

### B. Topic split — presence usa topic dedicado `post:<id>:presence` (elegida)

ThreadPresence sigue abriendo channel inline pero con topic distinto. Broadcast watchers siguen como están. Cero coordinación, cero colisión.

- **Pros**:
  - Cambio local, una línea de código + una migration backward-compat.
  - Honesto: presence y broadcast SON protocolos distintos. Compartir topic era una optimización accidental ("cero conexiones nuevas") que se reveló frágil.
  - Cero churn al `shared/lib/realtime` — sigue siendo broadcast-only y agnóstico.
  - Cero impacto a callers existentes de broadcast (su topic queda igual).
  - Forward-compat: el regex extractor (`split_part`) acepta cualquier suffix futuro (`post:<id>:foo:bar`).
- **Contras**:
  - Una conexión WebSocket adicional por viewer en el thread detail (presence + broadcast = 2 channels). Multiplexados sobre el mismo socket — costo trivial.
  - La RLS function `realtime.discussions_post_id_from_topic()` necesita actualizar para extraer postId del nuevo formato. Migration nueva.

**Elegida.** Lower-risk + más alineada con vertical slice paradigm (cada feature decide su topic naming sin coordinar con shared).

### C. Coordinator Provider arriba de los `<Suspense>`

Un `<PostRealtimeProvider postId={...}>` que abre el channel una sola vez, registra TODOS los listeners (presence + broadcast del feature) sincrónicamente y luego subscribe. Componentes hijos consumen state via context.

- **Pros**: architecturally pure. Lifecycle coordinado garantizado.
- **Contras**: refactor grande. Cambia `_thread-content.tsx` + `_comments-section.tsx` + `page.tsx`. Requiere context shape para presence + broadcast events. Costo desproporcionado para un bug que se arregla en 1 línea.

**Descartada.** Sobre-ingeniería para el problema actual.

## Decisión

1. **Topic split**: presence sobre `post:<id>:presence`. Broadcast sigue sobre `post:<id>`.
2. **Migration `20260509230000_realtime_topic_split_presence`**: actualiza `realtime.discussions_post_id_from_topic()` para extraer postId vía `split_part(substring(topic FROM 6), ':', 1)`. Las policies (`discussions_thread_receive`, `discussions_thread_send`) usan `LIKE 'post:%'` y ya cubren ambos formatos sin cambios.
3. **Convención** documentada en `docs/gotchas/supabase-channel-topic-collision.md`: nuevas features que abran channels Supabase Realtime sobre un topic ya en uso deben usar suffix dedicado si emiten `presence` o `postgres_changes`.

## Consecuencias

- **`shared/lib/realtime/` queda intacto** — sigue siendo broadcast-only y topic-agnostic.
- **El sub-slice `presence/` puede consolidarse en un PR separado** sin tocar este fix. La duplicación temporal de `thread-presence.tsx` (legacy `ui/` + sub-slice `presence/ui/`) se mantiene; ambos archivos quedan con el fix.
- **Forward-compat**: cualquier feature futura puede sumar otro suffix sobre `post:<id>` (ej: `post:<id>:typing`, `post:<id>:reactions-live`) sin tocar la SQL function.
- **RLS sigue gateando**: las policies enforcan membership igual; el cliente puede inventar topics pero Supabase rechaza la subscription si el viewer no es miembro del place del post.
- **Migration es backward-compat**: aplicar la migration ANTES o DESPUÉS del deploy del código nuevo no tira 5xx. Si el deploy va antes, presence queda degradada (sin avatares) hasta migrar — sin tirar errores de página.

## Limitación conocida (no fixeada en este patch)

Race condition secundaria: si las deps del `useEffect` de ThreadPresence cambian mid-session (ej: `viewer.displayName` se actualiza en otra tab), React corre cleanup async + effect de nuevo. El cleanup async puede no completar antes del próximo mount → channel todavía SUBSCRIBED → mismo throw. En este codebase el viewer es prop estática post-render del page, así que la race es teórica. Documentado en el gotcha § "Limitación conocida". Si se vuelve real, la fix es restringir las deps a `[postId, viewer.userId]` y actualizar display/avatar vía `channel.track()` sin remount.

## Verificación

- **SQL function**: `tests/rls/helpers-realtime.test.ts` valida 4 casos (legacy `post:<id>`, presence `post:<id>:presence`, multi-suffix forward-compat, topic no matcheante → NULL).
- **Browser**: hard refresh en `/conversations/<postSlug>` con DevTools abierto. Console NO debe mostrar `cannot add presence callbacks ... after subscribe()`. Los logs DEBUG TEMPORAL del commit `7c329f4` (mantenidos) ayudan a confirmar.
- **Deploy ordering**: aplicar migration primero (al Supabase de prod), después push del código. Cualquier orden es safe (sin 5xx) pero migration-first elimina la ventana de presence degradada.

## Referencias

- ADR original `docs/decisions/2026-04-21-shared-realtime-module.md` (C.J — diseño del shared/realtime).
- Gotcha `docs/gotchas/supabase-channel-topic-collision.md` — síntoma + diagnóstico completo + convención para nuevas features.
- Migration `prisma/migrations/20260509230000_realtime_topic_split_presence/migration.sql`.
- Migration policies original `prisma/migrations/20260424000000_realtime_discussions_presence/migration.sql`.
