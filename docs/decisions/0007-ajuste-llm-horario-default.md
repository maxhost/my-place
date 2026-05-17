# 0007 — Ajuste: el LLM del onboarding no propone horario; horario default

- **Fecha:** 2026-05-16
- **Estado:** Aceptada
- **Alcance:** producto (onboarding), IA, modelo de datos (`opening_hours`)
- **Ajusta:** ADR-0005 §5 (alcance del LLM) y §6/§Decisión donde enumera `opening_hours` como salida del LLM

Las ADR son registro histórico: no se editan, se reemplazan con una nueva ADR que la supersede.

## Contexto

ADR-0005 §5 definió que el LLM del onboarding propone, a partir de la descripción libre, **paleta + borrador de descripción + sugerencia de `opening_hours`**. Al revisarlo, el horario es una **decisión operativa fuerte y precisa del owner** (qué días/horas abre su lugar): una sugerencia de LLM ahí aporta poco y puede molestar/confundir más que ayudar (el owner igual la va a fijar a mano). Un default determinístico sensato + edición en settings es mejor experiencia y más simple de garantizar.

## Decisión

1. **El LLM NO propone horario.** Su salida en el onboarding queda en: **(a) paleta acotada + (b) borrador de descripción del place**. Sigue siendo propose-only y confirmada por el humano (reconciliación de `producto.md` / ADR-0005 §6 intacta).
2. **Horario default determinístico al crear el place:** `opening_hours` se setea a **09:00–20:00 todos los días, en el timezone del owner** (capturado en el onboarding o derivado del browser; a confirmar en la spec de feature). El place nace usable con ese horario.
3. **Editable después en `/settings`** por el owner (gateado por email verificado, ADR-0005 §9). El cambio de horario no es parte del onboarding ni de S1.

## Alternativas rechazadas

- **Mantener el horario en el alcance del LLM (ADR-0005 §5).** El horario es operativo y preciso; una propuesta de LLM es ruido sobre una decisión que el owner toma deliberadamente. Rechazada.
- **Pedir el horario obligatorio en el onboarding.** Suma fricción en el alta sin valor: un default razonable + settings cubre el 99%. Rechazada.
- **Default "cerrado" / vacío.** Un place sin horario al nacer no es usable y confunde. Rechazada.

## Consecuencias

- `data-model.md`: `opening_hours` documenta el default 09:00–20:00 tz-owner y que el LLM no lo propone.
- `architecture.md` (§Onboarding) y `producto.md` (nota de reconciliación del LLM): se corrige la enumeración a "paleta + descripción" (sin horario).
- La feature spec (`docs/features/onboarding/`) refleja: captura/derivación del timezone del owner, default aplicado en la saga, edición diferida a settings.
- El **gate de horario** (bloquear fuera de hora) sigue siendo concern **a nivel del place**, no de features, y **no es parte de S1** — es trabajo posterior con su propio alcance (ver `architecture.md` § "Gate de horario del place"). Que un place tenga `opening_hours` no implica construir el gate en S1.

## Detalle operativo canónico

- Shape y default de `opening_hours`: `docs/data-model.md` § Shapes JSON.
- Alcance del LLM y reconciliación de principio: ADR-0005 §5/§6 (ajustado por esta ADR) + `docs/producto.md`.
- Gate de horario (place-level, post-S1): `docs/architecture.md` § "Gate de horario del place".
