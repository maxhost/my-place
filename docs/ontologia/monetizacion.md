# Monetización · objeto consolidado

Documento canónico de la monetización del creador en Place. Nace con el pivot (ADR-0053), que cierra el TBD histórico de Pagos en dirección **Stripe Connect**.

> _Última actualización: 2026-06-11 (ADR-0053)._ Ontología canónica del dominio. Si una decisión de producto cambia, se actualiza acá **en la misma sesión** y se ajusta la fecha; el schema (`docs/data-model.md`) es su expresión, no su fuente.

---

## El principio

**El dinero de los oyentes es del creador.** El creador conecta **su propia cuenta de Stripe** (Stripe Connect) y cobra suscripciones a sus oyentes directamente; **Place toma 0%** de ese dinero. El negocio de Place es otro: la suscripción SaaS que el creador paga por su place (modelo ADR-0003/0005 — trial 30 días + suscripción del owner; pricing concreto TBD).

Este 0% es posicionamiento, no detalle: es el diferencial frente a Patreon/Supercast/Apple (15–30%) y la traducción literal de "el Substack para podcasts" — Substack creció sobre la promesa de que la plataforma no tasa al creador más allá de su fee.

---

## Qué desbloquea pagar: los threads privados

La unidad de monetización es la **visibilidad del thread** (ver `conversaciones.md` §Visibilidad):

- Un thread marcado **privado** solo lo abren los **suscriptores**: oyentes con suscripción paga activa al creador.
- **Cualquier tipo de thread puede ser privado** — típicamente episodios exclusivos, pero también discusiones del owner, eventos solo-suscriptores, etc.
- **Existencia visible, contenido gateado**: el thread privado puede verse listado (título, tipo) con su candado; abrirlo, escucharlo, leer y participar en su hilo exige suscripción. El candado es a la vez gate y CTA de suscripción.
- Lo no-privado no requiere pago: la suscripción es **contenido extra**, no la entrada a la comunidad. (Un creador que quiera comunidad solo-de-pago lo logra marcando privado lo que publica — el mecanismo es el mismo, no hay un "modo" aparte.)

**V1 asume precio único por place** (el creador define su precio de suscripción). Tiers múltiples quedan como pregunta abierta de ADR-0053.

---

## Roles del modelo

- **Anónimo** — ve la cara pública (página, blogposts, episodios públicos, RSS).
- **Oyente** — se unió a la comunidad del place. Accede a lo de comunidad según la configuración del owner.
- **Suscriptor** — oyente con suscripción paga activa. Además, abre los threads privados.
- **Owner (creador)** — publica, configura visibilidad, conecta su Stripe, ve métricas de audiencia.

El ciclo de vida fino (qué pasa exactamente al cancelar/expirar la suscripción, prorrateos, reembolsos, acceso retroactivo al catálogo privado) se define en el spec del feature con Stripe como fuente de verdad del estado de pago. Regla de producto por defecto: **sin suscripción activa no se abren threads privados** — el acceso es por estado presente, no por compra histórica.

---

## Qué hace Place y qué hace Stripe

- **Stripe (cuenta del creador, vía Connect):** el cobro, los medios de pago, los impuestos del creador, las disputas, los reembolsos. La relación de cobro es creador↔oyente.
- **Place:** el onboarding de Connect (conectar la cuenta desde `/settings`), el mapeo "suscripción activa → acceso a threads privados", el gate de visibilidad, y la UI de suscribirse dentro del place.
- **Place NO custodia fondos** ni emite facturas del creador. No somos merchant of record del contenido del creador.

El detalle de integración (Connect onboarding flow, webhooks de estado, modelado de la suscripción en schema) es del spec del feature — esta ontología fija el comportamiento, no la implementación.

---

## Lo que la monetización NO tiene

- **No hay comisión de Place** sobre las suscripciones de oyentes. 0%.
- **No hay propinas/donaciones one-off en V1** — solo suscripción recurrente. Revalidable a futuro.
- **No hay cobro por evento puntual (ticketing) en V1** — un evento solo-suscriptores se logra marcándolo privado; vender entradas sueltas es otro eje y exige su propia decisión (hereda el criterio pre-pivot de `eventos.md`).
- **No hay marketplace ni discover de shows pagos** — la conversión a suscriptor ocurre dentro del place del creador, con su marca.
- **No hay urgencia artificial en el paywall** — el candado informa y ofrece; no hay countdowns ni "oferta por tiempo limitado" del producto (el creador escribe su propio pitch).

---

## Estado

**Ontología:** cerrada — este documento es canónico. **Implementación:** no empezada (no hay schema de suscripciones, ni integración Connect, ni gate de visibilidad — el enum `billing_mode` pre-pivot queda dormido hasta la migración del feature, ver `data-model.md` § banner pivot).

---

## Referencias cruzadas

- `docs/ontologia/conversaciones.md` — visibilidad de threads (el gate que la suscripción abre)
- `docs/ontologia/episodios.md` — el contenido privado típico; pregunta abierta del feed RSS privado
- `docs/ontologia/miembros.md` — el oyente, su identidad y ciclo de vida
- `docs/producto.md` — visión (monetización sin peaje)
- `docs/decisions/0053-pivot-substack-para-podcasts.md` — la decisión madre + preguntas abiertas
- `docs/decisions/0003-lifecycle-cuenta-place-tombstone.md` — la suscripción SaaS creador→Place (el otro eje de cobro, intacto)
