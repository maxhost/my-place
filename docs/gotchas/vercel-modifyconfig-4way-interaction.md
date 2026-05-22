# Vercel `modifyConfig` falla con `path argument undefined` ante combinaciones específicas de cambios en `src/features/`

**Síntoma**: en el build de Vercel (`vercel build`, CLI 54.3.0, Next.js 16.2.6 + Turbopack) aparece, ANTES de que arranque `next build` real:

```
Applying modifyConfig from Vercel
> Build error occurred
TypeError: The "path" argument must be of type string. Received undefined
    at ignore-listed frames {
  code: 'ERR_INVALID_ARG_TYPE'
}
 ELIFECYCLE  Command failed with exit code 1.
Error: Command "pnpm run build" exited with 1
```

**Local `pnpm build` y `next build` pasan verde** — el error solo aparece en infra Vercel.

## Cuándo aparece

Empíricamente confirmado por bisección de 9 iteraciones (task #110, 2026-05-22): el bug se dispara solo ante una **interacción 4-way exacta** entre los siguientes sets de cambios coexistentes en un mismo commit. Cualquier subset de 3 (o menos) NO dispara el bug.

Los 4 sets que disparan el bug en este caso concreto:

- **A** Cambios en 3 archivos `.ts` runtime del slice `custom-domain` + `custom-domain-verification` (Server Action + helpers puros del lazy poll). Agrega un nuevo `export` (`isApexDomain`) consumido cross-archivo.
- **B** Creación de un archivo de test NUEVO (`v6-helpers-mappers.test.ts`) en `src/features/<slice>/actions/__tests__/`.
- **C** Modificación grande de un archivo `.test.ts` existente (recorte de 395 → 205 LOC, content moved a B) + modificación de un ADR markdown.
- **D** Modificación de un OTRO archivo `.test.ts` agregando un `describe` que **importa el nuevo export** del set A (`isApexDomain`).

La sospecha cualitativa: el adapter `@vercel/next` durante `modifyConfig` construye un module graph que combina TypeScript program (vía `tsconfig.json "include": ["**/*.ts"]`) + nuevo export + nuevo file + import cross-archivo, y dispara una path resolution con `undefined` en algún edge case. No tuvimos visibilidad al stack (Vercel ignore-listed los frames).

## Cómo se reproduce

1. Commit que toque simultáneamente los 4 sets descritos. Push a Vercel.
2. El build remoto falla en `Applying modifyConfig from Vercel` con el TypeError.
3. Cualquier commit que toque SOLO 3 (o menos) de los 4 sets: deploy READY.
4. Local `pnpm build` no reproduce (`modifyConfig` es un step específico de Vercel CLI, no de `next build` puro).
5. Cache vs no-cache de Vercel no afecta — el bug es determinístico al working tree.

## Workaround production-grade

**Estrategia α (probada verde en task #110)**: evitar set B (no crear archivo de test nuevo) y consolidar todos los tests del flow en un solo archivo existente, aunque supere el cap LOC ≤300 de `CLAUDE.md`. Documentar la excepción como **one-off**, no regla.

Empíricamente verificado en commit `6d22c74` (branch `bisect/strategy-alpha`) → deploy `dpl_8xegVGPAtpSMeRLQHqVw2b1NkbJG` READY.

**Otras estrategias factibles** (no verificadas pero plausibles):
- Cambiar filename del archivo nuevo (e.g. `mappers.test.ts` en vez de `v6-helpers-mappers.test.ts`) — explora si el patrón de naming triggea
- Cambiar path del archivo nuevo (e.g. ubicarlo en `src/features/custom-domain/types/__tests__/`) — explora si la combinación de paths triggea
- Mover el `describe` del set D a otro archivo que NO importe el nuevo export del set A

## Cómo detectarlo en el futuro

- Si un commit toca simultáneamente archivos `__tests__/*.test.ts` en múltiples slices + agrega un nuevo export consumido cross-archivo en un archivo `.ts` runtime + crea un nuevo archivo de test + modifica significativamente otro test existente, **alta probabilidad** de disparar el bug.
- El stack ignorado de Vercel hace muy difícil diagnosticar sin bisección. **Bisección por subsets de archivos del commit es el camino**.
- Producción no se ve afectada — Vercel preserva el deploy READY previo. Pero el commit nuevo queda en ERROR.

## Referencias

- Task #110 — bisección completa con 9 iteraciones (ramas remotas `bisect/*` en ambos remotes mientras dure la investigación).
- ADR-0029 — fix custom domain verified-false-positive, que motivó task #110.
- Issue Next.js #85371, #86140 — bugs Turbopack production Next.js 16 (relacionados temáticamente pero NO la causa raíz de este caso: nuestro error sucede ANTES de que Turbopack se inicie).
- Discussion Next.js #76882 — TypeORM + Turbopack `paths[0] argument undefined` (similar patrón error pero distinto layer del pipeline).
- Build log del deploy ERROR `dpl_ESbEBUhQGaG7fhh94nPfXimk35cf` (commit `6d21be2`) vs READY `dpl_8xegVGPAtpSMeRLQHqVw2b1NkbJG` (commit `6d22c74`) preservados en MCP Vercel.

## Reportarle a Vercel

Si el patrón se repite o bloquea trabajo nuevo, abrir issue en `vercel/next.js` o ticket en Vercel support con:
- Logs de los 2 commits ERROR + READY diferenciados solo en el set B
- Working tree mínimo reproducible
- Mención del step exacto: `Applying modifyConfig from Vercel` + `ERR_INVALID_ARG_TYPE`
