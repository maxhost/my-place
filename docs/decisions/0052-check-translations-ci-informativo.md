# 0052 — `check-translations.mjs` corre en CI como step informativo no-bloqueante

- **Fecha:** 2026-06-05
- **Estado:** Aceptada
- **Alcance:** CI (`.github/workflows/tests.yml`), proceso de traducción (visibilidad del drift i18n sin bloquear), tooling (`scripts/check-translations.mjs`)
- **Refina:** ADR-0024 §87 — esa ADR fijó que `check-translations.mjs` **no corre en CI** ("no en `pnpm build`, no en GitHub Actions"; "este script queda como reporte general" invocado manualmente). Esta ADR revierte **solo** esa cláusula operativa: el script ahora **sí** corre en CI, pero como **step informativo que siempre hace `exit 0`** (nunca fail-fast). La sustancia de ADR-0024 (deep-merge runtime como red de seguridad real + NO fail-closed que bloquee velocity) queda intacta.
- **No supersede:** ADR-0024 (sigue siendo la decisión canónica del fallback i18n + el carácter informativo del script; sólo cambia *dónde* corre)
- **Relación:** ADR-0024 anticipó adiciones a CI (§87 "si en el futuro… se escribe un check separado"; §158 "se agrega un check específico en CI sin romper este patrón") — esas cláusulas contemplaban checks **fail-closed selectivos**; esta ADR cubre el caso complementario (correr el reporte general **existente** en CI sin bloquear). Cierra el item Phase 3.E del tracker `docs/tech-debt-pre-v1.3.md`.

Las ADR son registro histórico: no se editan, se reemplazan con una nueva ADR que la supersede.

## Contexto

El tracker de cierre de deuda técnica (`docs/tech-debt-pre-v1.3.md`, Phase 3.E) pide "agregar `check-translations.mjs` a CI (warning visible, no fail-fast)". El script ya existe (creado en S1 del feature settings por ADR-0024) y es informativo por construcción: `process.exit(0)` siempre, incluso con drift (ver `scripts/check-translations.mjs` §1).

La tensión: ADR-0024 §87 dice literalmente que el script **no corre en CI**. El rationale original era evitar que el drift de traducciones bloqueara deploys (velocity de un MVP single-maintainer donde traducir es operación de producto, no de código). Ese rationale apunta a **no fail-closed**, no a "invisibilidad en CI": correr el script como step que siempre pasa **no** reintroduce ningún bloqueo. La intención de ADR-0024 se preserva; sólo se gana visibilidad pasiva del drift en cada PR (hoy hay que acordarse de correrlo a mano).

Como las ADR son inmutables (ADR-0024 §10), el cambio de esa cláusula operativa se registra en esta ADR nueva en vez de editar 0024.

## Decisión

1. **Job `translations` en `.github/workflows/tests.yml`** que corre `node scripts/check-translations.mjs` en cada PR a `main`.
   - **Sin `needs`** → corre en paralelo con `vitest` (no serializa el gate bloqueante).
   - **Sin `pnpm install`** → el script es Node ESM puro (`fs`/`path`/`url`, cero deps de runtime; ver `check-translations.mjs` §4). Sólo necesita `actions/checkout` + `actions/setup-node`. Más rápido y sin tocar el lockfile.
   - **Sin secrets** → no toca DB ni red.

2. **No-bloqueante por construcción.** El script hace `exit 0` siempre, así que el step **nunca** marca el job en rojo por drift. La "visibilidad" es el output en el log de Actions (`de.json: N keys missing`, etc.). No se agregan anotaciones `::warning::` (sería re-implementar la lógica de severidad que ADR-0024 deliberadamente dejó como reporte plano).

3. **El carácter del script no cambia.** Sigue siendo el reporte general informativo de ADR-0024 §3; ahora corre además en CI. Se actualiza el header del script (§1) que afirmaba "no en CI" para reflejar "manualmente o como step informativo en CI (nunca fail-fast)".

## Alternativas rechazadas

- **Honrar ADR-0024 §87 literal y no tocar CI** (dejar el script sólo manual). Cumple la letra de 0024 pero deja el item Phase 3.E sin cerrar y mantiene el drift invisible salvo que alguien recuerde correr el script. El rationale de §87 (no bloquear velocity) no se viola al correrlo non-blocking, así que respetar la letra cuesta visibilidad sin proteger nada. Rechazada.

- **Agregar el step a CI sin ADR nueva.** Deja el texto de ADR-0024 §87 ("no corre en CI") contradiciendo el repo → drift de documentación, exactamente lo que el mapa de docs canónicos de `CLAUDE.md` previene. Rechazada.

- **Editar ADR-0024 con un banner que cambie §87.** Viola la inmutabilidad de las ADR (ADR-0024 §10). El banner forward (puntero, no cambio de la decisión) sí se agrega; el cambio de la cláusula vive acá. Rechazada como mecanismo de cambio.

- **Fail-closed selectivo en CI** (e.g. "es↔en deben estar 100% sincronizados, `exit 1` si no"). Es lo que ADR-0024 §87/§158 contemplan para *el futuro*, como check **separado**. No es lo que pide Phase 3.E (warning visible, no fail-fast) ni lo que el MVP necesita hoy (traducir sigue siendo operación de producto). Diferida: cuando la velocity de traducciones lo justifique, se escribe ese check separado en su propia ADR. Rechazada para V1.3.

- **Correr el script dentro del job `vitest` como step extra.** Acopla un reporte i18n al gate de tests + obliga a `pnpm install` que el script no necesita. Job separado es más limpio y rápido. Rechazada.

## Consecuencias

- **Drift i18n visible en cada PR** sin acción manual. Cuando alguien agrega keys a `es.json` sin traducir, el log de Actions lo muestra — señal pasiva, no bloqueo.
- **Cero impacto en velocity.** El job nunca falla por drift (`exit 0`); no puede bloquear un merge.
- **Cero costo de secrets/DB.** Job liviano (checkout + node + run), corre en paralelo, sin lockfile install.
- **`scripts/check-translations.mjs` §1 actualizado** ("manualmente o como step informativo en CI").
- **ADR-0024 recibe banner forward** apuntando a ésta (mismo patrón que ADR-0020 ← ADR-0051).
- **Forward:** si la operación de producto quiere fail-closed selectivo (algún par de locales 100% sincronizado), se escribe un check **separado** en su propia ADR (ADR-0024 §87/§158) — esta ADR no lo cubre y el deep-merge runtime sigue como red real.

## Notas

- El script duplica deliberadamente el array de locales de `src/i18n/routing.ts` (ver su §"Locales operativos") para no arrastrar un bundler transitivo a `scripts/`. Si se agrega un locale a `routing.ts`, agregarlo también en el script — el job de CI no detecta esa omisión (compara contra su propia lista).
