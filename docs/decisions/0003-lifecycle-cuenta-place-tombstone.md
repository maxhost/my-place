# 0003 — Lifecycle de cuenta y de place; tombstone; reemplazo de los 365 días

- **Fecha:** 2026-05-16
- **Estado:** Aceptada
- **Alcance:** ontología de miembros, modelo de datos, billing (mecanismo TBD)
- **Supersede:** la regla "Derecho al olvido" de 365 días por-place de `docs/data-model.md` y `docs/ontologia/miembros.md`

Las ADR son registro histórico: no se editan, se reemplazan con una nueva ADR que la supersede.

## Contexto

El modelo previo anonimizaba contenido 365 días después de que el miembro **dejara un place** (trigger per-place). No cubría inactividad de cuenta, ni el costo de mantener un place, ni distinguía pago de gratis. Se redefine en **dos lifecycles independientes**.

## Decisión

### 1. Lifecycle de cuenta de miembro (login-based)

- **6 meses** sin login → estado `inactivo` (solo flag; el inactivo no es visible en ningún lado igual, no hay efecto adicional).
- **12 meses** sin login → **eliminación de cuenta + anonimización irreversible (tombstone)**: scrub de PII (email, display_name, avatar), `handle` liberado para reuso, identidad de login de Better Auth borrada; la fila `app_user` queda como cáscara anónima "ex-miembro" para preservar integridad referencial del contenido.
- **Avisos** por email: 30 días antes, 7 días antes, y aviso final de eliminación. Best-effort (si rebota, la eliminación procede igual).
- **Login resetea el contador** a cero en cualquier momento previo a la eliminación. La eliminación re-chequea actividad al ejecutarse.
- **Exención (condición, no atributo permanente):** un usuario está fuera de esta escala mientras **sea owner de ≥1 place activo** O **tenga ≥1 pago activo** (suscripción/tier). Si deja de ser ambas cosas, recién ahí la cuenta entra a la escala. Los tiempos solo corren para usuarios sin pago / de tier gratuito que no loguean.
- **DMs siguen la escala de cuenta:** al eliminar la cuenta, los mensajes del usuario pasan a "ex-miembro"; si **ambas** partes están tombstoned, la conversación se elimina por completo.

### 2. Lifecycle del place (suscripción del owner → plataforma)

Todo owner paga una **suscripción mensual** para que su place exista (independiente del tier de los miembros). Al impago:

1. **Pago-pendiente** (vencimiento): el owner puede conectarse pero **no entrar** al place; solo puede transferir ownership, cerrar el place, o regularizar. Emails al owner el día del vencimiento, +2 días, +7 días.
2. **Proceso de inactividad** (no regularizó tras los avisos): email **a todos los miembros**, transparente — el owner dejó de pagar el mantenimiento, que cancelen su tier hasta regularización, 20 días para inactividad, eliminación a los 12 meses si nunca se regulariza.
3. **Inactivo** (20 días sin regularizar): place no accesible para nadie.
4. **Eliminado** (12 meses sin regularizar nunca): place borrado completo — contenido, memberships, todo. Los DMs sobreviven (viven en el inbox universal, el place era solo el contexto donde se conocieron).

### 3. Mecánica de borrado: tombstone (no sentinel)

Scrub de PII + `handle` liberado; la fila `app_user` persiste como cáscara "ex-miembro". Razón: integridad referencial sin `UPDATE` masivo, y dos ex-miembros distintos siguen siendo distinguibles (preserva coherencia de threads y el invariante de DMs "una conversación por par").

## Alternativas rechazadas

- **365 días por-place, reversible.** Rechazada: la reversibilidad obligaba a anonimización no destructiva compleja; el trigger per-place no cubría inactividad ni costo del place. Reemplazada por escala de cuenta + lifecycle de place.
- **Sentinel global de borrado** (repuntar todo a un "ex-miembro" único). Rechazada: colapsa identidades distintas, rompe coherencia de threads y DMs.
- **Anonimizar antes de los 12m / a los 6m.** Rechazada: hace churn social ("ex-miembro" sobre alguien solo en pausa). Anonimización solo en la eliminación.

## Consecuencias

- Schema: `app_user.last_active_at` + `app_user.tombstoned_at`; `place.subscription_status` + `place.subscription_past_due_at`. El estado `inactivo` se deriva de `last_active_at`; `tombstoned_at` marca el fin irreversible.
- El borrado a 12m es operación de dos sistemas (scrub `app_user` + borrado de identidad Better Auth), transaccional/ordenada — detalle en el spec.
- **Diferido al spec de tiers** (no se modela ahora): tiers gratis/pago por place, estado de pago por membership, y la política exacta del miembro de tier-pago que no loguea (la exención por "pago activo" ya queda decidida; el schema se escribe en esa feature). Mecanismo de cobro = Pagos TBD (`docs/stack.md`).
- **Pregunta abierta de producto** (a validar con usuarios reales, no se resuelve ahora): si un place está en el máximo de 150 y un miembro inactivo se reactiva quedando 151, qué se ofrece.

## Detalle operativo canónico

- Ontología (qué significa para el miembro): `docs/ontologia/miembros.md` § "Derecho al olvido".
- Schema e invariantes: `docs/data-model.md`.
