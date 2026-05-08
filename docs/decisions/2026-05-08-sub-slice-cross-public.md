# Sub-slice public surfaces permitidos cross-slice

**Fecha:** 2026-05-08
**Milestone:** Sesión perf-1 / perf-2 (bundle splitting de `/conversations/[postSlug]`)
**Autor:** Max

## Contexto

El barrel raíz `rich-text/public.ts` re-exportaba todo el slice: `BaseComposer`,
los 4 surface composers (Comment/Post/Event/LibraryItem), `RichTextRendererClient`,
`richTextExcerpt`, types del documento Lexical, schemas Zod y mention nodes.

Cualquier Client Component (`'use client'`) que importara **una sola cosa** del
barrel — incluso un type o el helper `richTextExcerpt` — arrastraba el grafo
completo al chunk eager. Webpack no tree-shakea barrels que mezclan
`'use client'` modules: los considera con side effects implícitos.

Caso canónico observado en `comment-item-client.tsx`:

```ts
import {
  RichTextRendererClient,
  richTextExcerpt,
  type LexicalDocument,
} from '@/features/rich-text/public'
```

Tres imports livianos → arrastra `BaseComposer` + `CommentComposer` +
`PostComposer` + `EventComposer` + `LibraryItemComposer` + Lexical core +
13 extensiones Lexical = **~126 kB gzip** al chunk eager. La página de
detalle del thread (`/conversations/[postSlug]`) cerró 394 kB First Load
con esa contaminación, igual que `/conversations` (lista, donde el viewer
ni siquiera puede componer).

## Decisión

1. **Split del barrel `rich-text/public.ts` en barrel **lite** + sub-slice
   public para Composers**:
   - `rich-text/public.ts` queda como barrel **lite**: types, schemas Zod,
     `RichTextRendererClient`, `richTextExcerpt`, `assertRichTextSize`,
     mention nodes, errors. Sin Composers ni Lexical core.
   - `rich-text/composers/public.ts` (sub-slice public) re-exporta
     `BaseComposer` + los 4 surface composers + sus types.

2. **Boundary rule extendida**: `tests/boundaries.test.ts` y la regla
   conceptual permiten ahora **dos formas válidas** de cross-slice:
   - Barrel raíz: `@/features/<slice>/public` o `public.server` (regla original).
   - Sub-slice public: `@/features/<slice>/<sub>/public` o `<sub>/public.server`
     (un solo nivel de anidación; no se permiten paths más profundos
     `<a>/<b>/public`).

3. **Discussion's barrel raíz queda más fino**: `discussions/public.ts`
   re-exportaba `CommentComposer/PostComposer/EventComposer/LibraryItemComposer`
   crudos desde `rich-text/public` para minimizar churn pre-split. Esos
   re-exports se eliminan; los pocos consumers que los usaban no existían
   (todos consumían los Wrappers `*ComposerForm`/`*ComposerWrapper`).

## Consecuencias

**Ganancias inmediatas**:

- Pages que sólo renderizan rich-text (lista de conversations, lista de
  events, lista de library, member detail) ya no traen Lexical al bundle
  eager. El First Load JS de la familia 394 kB esperado en el rango
  ~245 kB después de perf-2.
- Pages de creación/edición (`/conversations/new`, `/events/new`,
  `/events/[id]/edit`, `/library/.../new`, `/library/.../edit`) siguen
  importando del sub-slice composers eager (UX justificada: la razón de ser
  de la página ES el editor).
- Page de detalle thread carga el composer **lazy via `next/dynamic`**
  desde `<CommentComposerLazy>` (patrón Reddit). El sub-slice
  `composers/public` baja en un chunk separado on-focus.

**Costo del cambio**:

- ~5 imports en `discussions/ui/*-composer-form.tsx` actualizados a
  `rich-text/composers/public`. Cambio mecánico, 1 línea por archivo.
- `tests/boundaries.test.ts` extendido con dos regex adicionales —
  cubre exactamente un nivel de anidación (`<sub>/public(.ts)?`).
- `MEMORY.md` y CLAUDE.md gotchas no requieren update — el patrón
  está documentado en este ADR.

**Riesgos descartados**:

- _Boundary fuzzing_: ¿alguien podría crear un sub-slice falso para
  bypassear la regla? Sí, pero el mismo patrón ya era posible con
  re-exports en el barrel raíz. La defensa es revisión humana, no la regla.
- _Anidación arbitraria_: explícitamente NO se permite
  `<feature>/<a>/<b>/public`. Los regex usan `[a-z0-9-]+/public` —
  un solo segmento.
- _API breaking_: zero. Los Composers exponen exactamente las mismas
  props y signatures. Sólo cambia el path desde el cual se importan.

## Verificación

- `pnpm typecheck && pnpm lint`: verde.
- `pnpm test --run` (incluyendo `tests/boundaries.test.ts`): verde.
- `ANALYZE=true pnpm build`: chunk Lexical (`6936` o equivalente)
  desaparece del manifest de pages que no componen.
- Smoke manual: thread detail abre, click "Sumate a la conversación"
  → editor real aparece tras ~150ms con foco. Edición y publicación
  funcionan idénticas.

## Alternativas descartadas

1. **Mantener un único barrel y depender de `optimizePackageImports`
   para nuestros slices**: ese feature de Next es para libs externas con
   shape estable; aplicarlo a slices internos en evolución multiplica los
   bugs sutiles del bundler. Descartada.

2. **Convertir `rich-text/public.ts` en namespace `import * as rt`**:
   no resuelve nada — webpack sigue trazando el grafo entero por
   `'use client'` boundary.

3. **Dynamic import de Composers en cada Wrapper individualmente
   (sin split del barrel)**: requiere editar 5 wrappers + se pierde
   SSR del editor en `/new` y `/edit` donde sí lo queremos. Trade-off
   peor que el split estructural.

4. **Mover Composers a un slice nuevo `composers/`**: rompe la
   ontología — los Composers son el sub-slice de `rich-text/` que opera
   sobre el AST Lexical de `rich-text/domain/`. Separarlos en slice
   propio fragmenta la cohesión del dominio.
