# Eventos (`events`) — spec [stub]

> _Spec stub creado 2026-06-01 (Phase 2.D tech-debt closure). Feature **no empezada**: este archivo existe para cumplir la convención de `CLAUDE.md` ("cada objeto del core con ontología canónica tiene su entrada en `docs/features/`"). La **fuente de verdad del dominio es la ontología** [`../../ontologia/eventos.md`](../../ontologia/eventos.md) (cerrada y canónica); este spec se completa con el alcance de implementación (V1, journeys, schema, RLS, tests) recién cuando el slice entre en construcción._

## Estado

**No empezada.** Scaffold limpio: no hay UI, ni schema dedicado, ni slice `src/features/events/`. La **ontología está cerrada y es canónica**; la implementación es 0%. El detalle de pantallas, el schema del mensaje-principal-evento (fecha/recurrencia/confirmaciones) y los 3 momentos vivirán acá cuando se construya la feature.

## Contexto

Un **evento es una Discusión** (la Discusión es el primitivo, ver [`../../ontologia/conversaciones.md`](../../ontologia/conversaciones.md)): mismo hilo de mensajes y mismas reglas; cambia solo la **morfología del mensaje principal** — en vez del cuerpo libre, el formulario del evento (título, tipo, fecha/recurrencia). Dos tipos sobre el mismo objeto en datos: **único** (ocasión) y **recurrente** (ritual). El evento tiene 3 momentos (preparación colectiva → suceder → memoria) y los eventos-ritual acumulan como memoria cálida del place.

Eventos es una **zona opcional**: el owner la activa/desactiva desde `/settings` (sección "Zonas", hoy "Próximamente" en el sidebar de settings — ver [`../settings/spec.md`](../settings/spec.md)). Desactivada, no aparece en el place.

## Pointers

- **Ontología canónica (fuente de verdad del dominio)**: [`../../ontologia/eventos.md`](../../ontologia/eventos.md) — principio, estructura del mensaje principal, zona horaria, visibilidad/participación, 3 momentos, ritual/acumulación, qué NO tiene.
- **Primitivo del que deriva**: [`../../ontologia/conversaciones.md`](../../ontologia/conversaciones.md) — la Discusión (evento = Discusión con mensaje principal distinto).
- **Objeto hermano** (también una Discusión, mismo modelo de acceso role-aware): [`../../ontologia/library.md`](../../ontologia/library.md).
- **Schema base + invariantes del dominio**: [`../../data-model.md`](../../data-model.md) — zonas opcionales del place.
- **Activación de zona** (opcional, owner-only): [`../settings/spec.md`](../settings/spec.md) § sidebar "Zonas".
- **Gate de horario del place** (regla técnica, con excepción owner): `../../architecture.md` § "Gate de horario del place".
- **Participantes = miembros del place**: [`../../ontologia/miembros.md`](../../ontologia/miembros.md).
- **Diferidos (Parked)**: eventos con pago/ticketing, sala de video integrada, invitaciones a no-miembros, integración calendario externo — ver [`../README.md`](../README.md) tabla "Parked".
- **Slice futuro**: `src/features/events/` (no existe aún).
