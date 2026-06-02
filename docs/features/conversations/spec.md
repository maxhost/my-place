# Discusiones (`conversations`) — spec [stub]

> _Spec stub creado 2026-06-01 (Phase 2.D tech-debt closure). Feature **no empezada**: este archivo existe para cumplir la convención de `CLAUDE.md` ("cada objeto del core con ontología canónica tiene su entrada en `docs/features/`"). La **fuente de verdad del dominio es la ontología** [`../../ontologia/conversaciones.md`](../../ontologia/conversaciones.md) (cerrada y canónica); este spec se completa con el alcance de implementación (V1, journeys, schema, RLS, tests) recién cuando el slice entre en construcción._

## Estado

**No empezada.** Scaffold limpio: no hay UI, ni schema dedicado, ni slice `src/features/conversations/`. La **ontología está cerrada y es canónica**; la implementación es 0%. El detalle de pantallas y el schema de discusiones/mensajes/hilos vivirán acá cuando se construya la feature, no en la ontología (que describe el dominio, no la implementación).

## Contexto

La **Discusión es el primitivo del dominio** del que derivan los demás objetos de contenido: un evento es una Discusión, un recurso de biblioteca es una Discusión — cambia solo la **morfología del mensaje principal**, el hilo de mensajes y sus reglas son los mismos (ver [`../../ontologia/eventos.md`](../../ontologia/eventos.md) y [`../../ontologia/library.md`](../../ontologia/library.md)).

Por ser el primitivo, la **Zona Discusión es Core y no se puede desactivar** (a diferencia de Eventos y Biblioteca, zonas opcionales que el owner activa/desactiva desde `/settings`). Las discusiones viven dentro del horario del place (gate de actividad), son traídas por los miembros (no autorizadas), incluyen a los lectores como parte de la conversación, nunca se cierran, y al cerrar la temporada quedan como artefacto.

## Pointers

- **Ontología canónica (fuente de verdad del dominio)**: [`../../ontologia/conversaciones.md`](../../ontologia/conversaciones.md) — principio, vocabulario (Zona Discusión vs Discusión), estructura, interacciones, moderación, comportamiento por horario.
- **Objetos derivados del primitivo** (misma Discusión, distinto mensaje principal): [`../../ontologia/eventos.md`](../../ontologia/eventos.md) · [`../../ontologia/library.md`](../../ontologia/library.md).
- **Schema base + invariantes del dominio**: [`../../data-model.md`](../../data-model.md) — invariante "Zona Discusión no desactivable" + zonas opcionales del place.
- **Gate de horario del place** (regla técnica que rige cuándo se puede escribir): `../../architecture.md` § "Gate de horario del place".
- **Perfil del miembro** (accesible desde nombres en los hilos): [`../../ontologia/miembros.md`](../../ontologia/miembros.md).
- **Routing multi-tenant** (zona dentro de `{slug}.place.community`): [`../../multi-tenancy.md`](../../multi-tenancy.md).
- **Slice futuro**: `src/features/conversations/` (no existe aún).
