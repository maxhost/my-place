# `pnpm test` con ambos projects en paralelo: flake observado una vez, no reproducible

## Síntoma

El 2026-05-28 (Phase 1.B), `pnpm test` (= `vitest run` sin filtro de project → corre los
projects `node` y `ui` concurrentemente) reportó **26 tests / 7 files failed** con stack
traces de WebSocket close en tests de DB (`src/db/__tests__/lookup-place-by-domain.test.ts`
y otros tests Neon del project `node`). Aislando los projects (`vitest run --project node`
y `--project ui`) ambos daban verde total. De ahí la hipótesis original: **contención entre
los workers jsdom del project `ui` y los workers node-DB del project `node`** (pool de
conexiones Neon + WS disconnect) cuando corren en paralelo.

## Qué se investigó (Phase 2.C.1, 2026-06-02)

Repro empírico con la **config idéntica** a la del hallazgo (`vitest.config.ts` sin cambios
desde 2026-05-18, anterior al flake; `testTimeout` node = 30s ya presente):

- 1 corrida baseline sin carga → ✅ 1177/1177.
- 5 corridas bajo **8 CPU burners** en una máquina de 8 cores (oversubscripción 8x, load
  averages 65-76) → ✅ 1177/1177 cada una.

**6/6 verde**, ambos projects en paralelo. La hipótesis de starvation de CPU queda
**refutada**: si el mecanismo fuera contención de CPU sobre el event loop del worker node
(impidiéndole servir el heartbeat del WS de neon-serverless a tiempo → close), load
averages de 70+ lo habrían disparado. No lo hizo, y cada iter tardó ~8min incluso bajo
carga → la suite node es **I/O-bound** (esperando round-trips a Neon), no CPU-bound.

## Causa probable (no confirmada)

El flake del 2026-05-28 fue real, pero su causa **no es la documentada** y **no es
reproducible** con config idéntica y *más* tests que entonces (1177 vs 1160). El candidato
que queda es una **condición transitoria del lado de Neon** ese día (restart del compute
scale-to-zero, blip de red, o límite de conexiones del branch `test` en ese momento), ya
resuelta. No hay evidencia reproducible que justifique un fix de pools/concurrency — hacerlo
sería arreglar un fantasma.

## Mitigación aplicada (higiene, no fix)

- Scripts `test:node` y `test:ui` (`package.json`) para correr una capa aislada — DX +
  status check independiente por project en CI (`.github/workflows/tests.yml` los corre como
  pasos separados; el project `node` lleva los secrets de Neon, el `ui` jsdom no toca DB).
  Esto además hace verdadera la afirmación previa del tracker "CI separa los projects".
- `pnpm test` (ambos projects en paralelo) queda **sin cambios** — es el entrypoint local.

## Si reaparece

1. Capturar el stack trace fresco (`pnpm test 2>&1 | tee` y grep `WebSocket|ECONNRESET|
   Connection terminated|terminating`).
2. Verificar el **límite de conexiones** del branch `test` en el dashboard de Neon vs el
   número de workers (91 archivos node × forks). Si es ese el techo, limitar
   `poolOptions.forks.maxForks` del project node — pero recién **con** la evidencia, no antes.
3. Workaround inmediato sin diagnóstico: `pnpm test:node && pnpm test:ui` (secuencial, sin
   concurrencia entre projects).
