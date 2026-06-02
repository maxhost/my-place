# Biblioteca (`library`) — spec [stub]

> _Spec stub creado 2026-06-01 (Phase 2.D tech-debt closure). Feature **no empezada**: este archivo existe para cumplir la convención de `CLAUDE.md` ("cada objeto del core con ontología canónica tiene su entrada en `docs/features/`"). La **fuente de verdad del dominio es la ontología** [`../../ontologia/library.md`](../../ontologia/library.md) (cerrada y canónica); este spec se completa con el alcance de implementación (V1, journeys, schema, RLS, tests) recién cuando el slice entre en construcción._

## Estado

**No empezada.** Scaffold limpio: no hay UI, ni schema dedicado, ni slice `src/features/library/`. La **ontología está cerrada y es canónica**; la implementación es 0%. El detalle de pantallas y el schema de categorías/recursos/progreso vivirán acá cuando se construya la feature.

## Contexto

Un **recurso de biblioteca es una Discusión** (la Discusión es el primitivo, ver [`../../ontologia/conversaciones.md`](../../ontologia/conversaciones.md)): mismo hilo de mensajes y mismas reglas; cambia la **morfología del mensaje principal** (el recurso: documento, curso, guía) y se le suma estructura organizativa que la Zona Discusión NO tiene: **categorías**. Jerarquía: Biblioteca (zona) → Categoría (la crea solo el owner) → Recurso publicado (= una Discusión). El acceso es role-aware por categoría (tipo, visibilidad, escritura, acceso parcial).

Biblioteca es una **zona opcional**: el owner la activa/desactiva desde `/settings` (sección "Zonas", hoy "Próximamente" en el sidebar de settings — ver [`../settings/spec.md`](../settings/spec.md)). Desactivada, no aparece en el place.

## Pointers

- **Ontología canónica (fuente de verdad del dominio)**: [`../../ontologia/library.md`](../../ontologia/library.md) — principio, jerarquía, la Categoría (tipo/visibilidad/escritura/acceso parcial), el Recurso, comportamiento por horario, qué NO tiene.
- **Primitivo del que deriva**: [`../../ontologia/conversaciones.md`](../../ontologia/conversaciones.md) — la Discusión (recurso = Discusión con mensaje principal distinto + categorías).
- **Objeto hermano** (también una Discusión, mismo modelo de acceso role-aware): [`../../ontologia/eventos.md`](../../ontologia/eventos.md).
- **Schema base + invariantes del dominio**: [`../../data-model.md`](../../data-model.md) — zonas opcionales del place.
- **Activación de zona** (opcional, owner-only): [`../settings/spec.md`](../settings/spec.md) § sidebar "Zonas".
- **Storage de assets** (documentos/archivos de recursos): Cloudflare R2, wrapper `src/shared/lib/storage/blob.ts` (ADR-0048) — ver [`../README.md`](../README.md) fila "Storage".
- **Gate de horario del place** (regla técnica): `../../architecture.md` § "Gate de horario del place".
- **Autores/lectores = miembros del place**: [`../../ontologia/miembros.md`](../../ontologia/miembros.md).
- **Slice futuro**: `src/features/library/` (no existe aún).
