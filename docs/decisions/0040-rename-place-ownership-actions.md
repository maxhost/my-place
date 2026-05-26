# ADR-0040 — Rename slice `members-ownership/` → `place-ownership-actions/` (capability-named)

**Fecha**: 2026-05-25
**Estado**: Adoptada
**Contexto inmediato**: Feature E (members slice V1) — sesión S10.6 (refactor slice diet, primera de S10.6-S10.9). Cierre del nombre canónico del slice extraído en S10.5 antes de los 3 splits siguientes (`invitations/`, `member-profile/`, `member-row-actions-menu` page-level).

## Contexto

S10.5 ejecutó el Plan B split documentado en `plan-sesiones.md` §S8: extraer los 3 wrappers TS sobre las DEFINER Feature D reutilizadas (`app.elevate_to_owner`, `app.revoke_ownership`, `app.transfer_founder_ownership`) a un slice hermano de `members/` para mantener ambos slices bajo el cap LOC ≤1500 (CLAUDE.md §"Límites de tamaño"). El slice extraído quedó bautizado `members-ownership/`.

Durante el planning de los splits siguientes (S10.7-S10.9), el gap-scan detectó que el nombre `members-ownership/` mapea **la relación de consumo** (qué slice consume estas actions) en lugar de **la capability** (qué hace el slice). Análisis específico:

- **Lo que el slice hace**: wrapper sobre 3 funciones DEFINER PostgreSQL que mutan el slot `place_ownership` (fila en `place_ownership` + opcional move atómico de `place.founder_user_id`). Es ortogonal al slot `membership`. La capability es **acciones que coordinan transiciones del slot place_ownership**.
- **Lo que el nombre `members-ownership/` sugiere**: "ownership perteneciente a members" — semánticamente impreciso (ownership pertenece al place, no al member) y direccionalmente erróneo (sugiere dependency `members → ownership` cuando en realidad la dependency cross-slice es `members/ui → place-ownership-actions/public` consumer-to-capability).

El nombre canónico **`place-ownership-actions/`** corrige ambos defectos:

- Mapea la capability: las actions tocan el schema slot `place_ownership`.
- Es consumer-agnostic: si en V1.1+ otro slice también necesita estas actions (e.g., un `place-settings` con UI de roster owners), no hay confusión semántica.
- Es self-documenting: el nombre sólo dice `actions` (no `commands` ni `mutations`) para mantener simetría con los conceptos del codebase (Server Actions de Next.js).

## Decisión

Renombrar `src/features/members-ownership/` → `src/features/place-ownership-actions/`. Cambio puramente nominal:

- Estructura interna intacta (13 archivos, 717 LOC, sin tocar lógica).
- `git mv` preserva history per-file.
- 2 cross-slice imports actualizados (`members/ui/members-list.tsx`, `members/ui/member-row-actions-menu.tsx`).
- 9 doc comments actualizados in-place (4 dentro del slice renombrado, 5 en `members/`).
- 3 referencias en `docs/features/members/plan-sesiones.md` actualizadas (incluida §S8 line 606 — la decisión canónica original, ahora write-back con evolución completa).
- Suite de tests sin tocar (passing pre y post).

## Alternativas rechazadas

### `members-ownership/` (status quo)

**Rechazada porque**: el nombre mapea la relación de consumo en S10.5 (sólo `members/ui/` consume) en lugar de la capability del slice. Si V1.1+ agrega un segundo consumer, el nombre queda mentiroso. Además sugiere semánticamente "ownership perteneciente a members" — incorrecto: el ownership pertenece al place.

### `place-ownership/` (sin sufijo `-actions`)

**Rechazada porque**: ya existe `docs/features/place-ownership/` como Feature D canónica (spec + plan + decisions DB-only). Usar el mismo nombre para un slice de código causaría confusión doc↔código (la doc Feature D es DB-only, el slice de código es Server Actions wrappers). El sufijo `-actions` desambigua: el slice de código son los wrappers TS, distintos de las DEFINER DB que Feature D documenta.

### `ownership-actions/` (sin prefijo `place-`)

**Rechazada porque**: pierde el contexto del schema slot. "Ownership" sola podría confundirse con member ownership de algo, account ownership, etc. El prefijo `place-` ancla la capability al objeto canónico del dominio (place, fila en `place` con FK).

### `place-ownership-wrappers/` o `place-ownership-commands/`

**Rechazada porque**: `wrappers` es jerga técnica (no transparente para nuevos contributors). `commands` introduce convención nueva (CQRS-like) sin precedente en el repo — el resto de slices usa `actions/` para Server Actions. Mantener el sufijo `-actions` preserva simetría.

## Consecuencias

### Adoptadas

- **Going-forward**: cualquier nuevo consumer de wrappers Feature D importa desde `@/features/place-ownership-actions/public`. El nombre del slice ya no sugiere relación con `members/` específicamente.
- **ADR-0028 § "Política a futuro" cumplida**: el slice satisface los 3 criterios para promoción a slice propio:
  1. Cap LOC heurístico: extracción mantiene `members/` bajo 1500.
  2. ADR/spec/migration propias: las migrations 0014-0016 (Feature D DEFINERs) son la SoT de las primitives wrapped + ADR-0035.
  3. Consumers cross-slice futuros: el rename anticipa que V1.1+ (e.g., UI roster owners en un futuro `place-settings`) podría consumir sin que el nombre quede mentiroso.
- **Plan-sesiones write-back**: §S8 line 606 (canonical decision section, locked durante implementación) actualizada con la evolución completa de la decisión (Original → Plan B → Rename). Cualquier futuro lector entiende el arc.

### Forward-compat

- **S10.7-S10.9** (slice splits siguientes: `invitations/`, `member-profile/`, `member-row-actions-menu` page-level) heredan el patrón capability-named. ADR-0041/0042/0043 documentan los siguientes 3 splits.
- **Doc comments anchor**: `members/types.ts` línea ~33, `members/public.ts` línea ~43, y los archivos del slice renombrado tienen anchors actualizados con el nuevo nombre — grep por `place-ownership-actions` recupera todos los pointers.

### No-impacto

- **Tests**: el rename es puramente nominal. Suite 930/930 verde pre y post.
- **Build**: no requiere migration de runtime ni de DB.
- **History per-file**: `git mv` preserva blame/history línea-por-línea de los 13 archivos.

### Excepción inmutabilidad ADR

- **ADR-0039:16** menciona `members-ownership/` en contexto del gap-scan que precedió a S10.5.5. **NO se edita** (regla de inmutabilidad ADR del `decisions/README.md`). Es coherente con el momento en que ADR-0039 fue escrita — el rename no había ocurrido aún.

## Verificación

Post-rename, los siguientes comandos deben pasar verdes:

- `pnpm lint` — clean (las 2 cross-slice imports updated apuntan a `/public`, regla ADR-0039 satisfecha).
- `pnpm typecheck` — clean (paths absolutos actualizados, paths relativos intra-slice intactos).
- `pnpm test` — clean (sin cambios de lógica).
- `git status` — confirma R (rename) en los 13 files, M en los 9 files con doc comment updates.

## Referencias

- ADR-0028 (Custom Domain slice promotion) — política de promoción a slice propio (cap LOC + ADR/spec propia + consumers futuros)
- ADR-0035 (place_ownership multi-owner V1) — SoT del slot `place_ownership` que el slice mutates
- ADR-0039 (eslint slice boundaries enforcement) — regla que valida los 2 cross-slice imports actualizados
- `docs/features/members/plan-sesiones.md` §S8 line 606 — canonical decision con write-back completo
- `src/features/place-ownership-actions/public.ts` — barrel canónico post-rename
