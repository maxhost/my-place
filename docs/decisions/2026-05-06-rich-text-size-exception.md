# 2026-05-06 — Excepción al cap de tamaño del slice `rich-text`

## Contexto

El paradigma del proyecto (`docs/architecture.md` § Límites de tamaño) define un cap de **1500 líneas por feature/slice**. Superarlo requiere ADR explícito.

Tras cerrar la migración TipTap → Lexical (plan `docs/plans/2026-05-06-tiptap-to-lexical-migration.md`), el slice `src/features/rich-text/` queda en **3477 LOC** sin tests:

- `domain/` (~755 LOC): types + 4 schemas Zod (general + 3 por surface) + size + excerpt + snapshot + errors.
- `ui/` (~1816 LOC): base-composer + renderer SSR + renderer-client + 3 surface composers (post, event, library-item) + comment-composer + 2 archivos de mention plugin (node + plugin con 3 triggers).
- `embeds/` sub-slice (~906 LOC): 4 plugins de embed (YouTube, Spotify, Apple Podcasts, Ivoox), cada uno con `parse-url`, `embed-node`, `embed-plugin`.

Sin esta excepción el slice debería partirse en sub-slices más chicos antes de continuar.

## Decisión

Aceptar el slice `rich-text` con tamaño actual (3477 LOC sin tests). Mismo precedente que `docs/decisions/2026-04-20-discussions-size-exception.md` (slice `discussions` con dominio denso por TipTap AST).

Rationale:

1. **Densidad inherente del dominio rich-text**: 4 surfaces × 4 embeds × 3 triggers de mention × renderer SSR + client + composers + plugins de Lexical son responsabilidades acopladas que no se separan limpiamente sin abstracciones forzadas.
2. **Ya se aplicó split parcial**: el sub-slice `embeds/` extrae 906 LOC. Sin él, el slice principal estaría en ~2580 LOC y la cohesión interna sería peor (los 4 embeds son cosas distintas que comparten poco — separarlas mejora legibilidad).
3. **El renderer SSR + composer base + plugin de mentions son interdependientes**: separarlos en sub-slices crea boundaries artificiales que no aportan a la mantenibilidad. El composer importa el plugin de mentions, el renderer comparte tipos de mention con el plugin, etc.
4. **Trabajos de evolución**: post-MVP, candidatos naturales para sub-slice adicional son `mentions/` (~600 LOC con node + plugin polimórfico) y posiblemente un `embeds/<plugin>/` extra si aparecen más providers (Twitch, Twitter, etc.).

## Alternativas descartadas

### A. Split inmediato `mentions/` en sub-slice

Recortaría ~600 LOC del slice principal. **No se aplica todavía** porque:

- El plugin de mentions y el `MentionNode` (DecoratorNode) están interconectados con el resto del editor; un sub-slice forzaría re-exports cruzados sin reducir complejidad cognitiva.
- Los resolvers de mention son inyectados desde fuera (boundary respetado); el slice sigue siendo importable por una superficie pública limpia.

Si en una sesión futura los sub-slices `embeds/` y `mentions/` ganan suficiente independencia (ej: el slice expone un `useMentionAutocomplete()` hook reusable fuera del editor), reevaluar split.

### B. Mover el renderer SSR a un slice `rich-text-renderer/` separado

Reduciría el slice principal ~400 LOC. Descartado porque el renderer comparte dominio (`MentionNode`, `EmbedNode`, `LexicalDocument`) con el composer; partirlos forzaría duplicación de tipos o un boundary artificial. La regla "lo que cambia junto, vive junto" prevalece.

### C. Reducir surfaces

Cada surface composer pesa ~80–150 LOC. Descartar uno es decisión de producto (los 4 surfaces son requisitos del MVP). No es una palanca técnica.

## Tradeoffs

**A favor del slice grande**:

- Cohesión interna alta: archivos relacionados viven juntos.
- Cero acoplamiento cruzado entre slices artificiales.
- El cap 1500 LOC es heurístico; el sub-slice `embeds/` ya factoriza la parte más extensible.

**En contra**:

- `pnpm wc -l` de un slice gigante hace harder el navegado para nuevos contributors.
- Riesgo que el slice siga creciendo sin freno (post-MVP: poll node, code node, tabla, etc.).

**Mitigación**: revisar el slice cada 2–3 sub-fases del roadmap. Si supera 4500 LOC sin tests, split obligatorio (no se requiere ADR adicional — esta excepción cubre hasta 4500).

## Puntos de revisión

- **Si se agrega un quinto plugin de embed** (ej: Twitch o Twitter): se mantiene en `embeds/<plugin>/`, no afecta el slice principal.
- **Si el plugin de mentions agrega kinds adicionales** (`kind: 'post'`, `kind: 'tag'`): evaluar split a `mentions/` sub-slice si los handlers de trigger crecen >1200 LOC en `mentions/`.
- **Si el renderer SSR adopta lookup paralelo masivo** (ej: 50+ mentions resueltas en paralelo con loaders): puede justificar un sub-slice `renderer/` con sus propios helpers de batching.

## Verificación

```bash
find src/features/rich-text -type f \( -name "*.ts" -o -name "*.tsx" \) \
  -not -path "*/__tests__/*" -not -name "*.test.*" | xargs wc -l
```

Contado al cerrar este plan: 3477 LOC. Cap aceptado por esta excepción: 4500 LOC.

## Referencias

- ADR principal: `docs/decisions/2026-05-06-tiptap-to-lexical.md`.
- Spec: `docs/features/rich-text/spec.md`.
- Plan: `docs/plans/2026-05-06-tiptap-to-lexical-migration.md`.
- Excepción precedente: `docs/decisions/2026-04-20-discussions-size-exception.md`.
- Cap general: `docs/architecture.md` § Límites de tamaño.
