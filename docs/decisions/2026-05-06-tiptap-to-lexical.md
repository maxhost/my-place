# 2026-05-06 — Migración del editor: TipTap → Lexical

**Estado: ✅ ejecutado 2026-05-06.** Plan operacional cerrado en `docs/plans/2026-05-06-tiptap-to-lexical-migration.md`. ADR de excepción al cap del slice `rich-text` en `docs/decisions/2026-05-06-rich-text-size-exception.md`.

## Contexto

El slice `discussions` (y por reuso `events` + `library`) usa TipTap como editor de rich-text. TipTap está construido sobre ProseMirror y obliga a registrar el schema completo al boot del editor: las extensiones del `StarterKit` cargan paragraph + heading + listas + code + blockquote + link + mention + history + dropcursor + gapCursor en bloque, aún cuando el surface concreto sólo necesita un subset.

El producto tiene 4 surfaces de rich-text con necesidades distintas:

- **Comment / respuesta**: text, link, mention.
- **Post (thread)**: text, mention, heading h1–h3, bold, ordered/bullet list, link, embeds (YouTube + Spotify + Apple Podcasts + Ivoox).
- **Evento**: text, link, mention.
- **Library item**: igual que post (thread).

Con TipTap StarterKit, los 4 surfaces cargan el mismo bundle (~150-180 kB gzip). El usuario que abre `/conversations/[postSlug]` (lectura) o `/library/[categorySlug]/[itemSlug]` arrastra el composer al cliente vía el barrel `discussions/public.ts` (ver `docs/decisions/2026-04-21-flags-subslice-split.md` § "Boundary client vs server" para el patrón de barrel-pollution).

Lexical (Meta) tiene una arquitectura diferente: el schema se declara **per-instance** vía `initialConfig.nodes = [...]`. Si un editor no incluye `HeadingNode`, ese nodo no existe en esa instancia. Los plugins son React Components que se componen vía JSX y son lazy-loadables con `next/dynamic`. Core de Lexical: 22 kB min+gzip.

Además, el producto necesita habilitar/deshabilitar embeds **por place** desde `/settings/editor` (cada comunidad decide si quiere YouTube, Spotify, etc.). Con TipTap, esto requiere armar extensiones manualmente (alejarse de StarterKit) y aún así el schema sigue acoplado al editor monolítico. Con Lexical, el `nodes` array se computa por place a partir de `Place.editorPluginsConfig` y la separación es idiomática.

## Decisión

Reemplazar TipTap por Lexical como editor de rich-text en los 4 surfaces. Drop completo de TipTap del codebase (sin coexistencia).

**Estrategia de datos**: drop & recreate columns. El AST de Lexical es estructuralmente distinto al de ProseMirror; reutilizar la misma columna JSON deja riesgo de filas con shape viejo en cualquier rollback parcial. Dado que estamos en pre-producción (sin usuarios reales, todos los posts/comments/events/library-items son data dev), la opción production-minded es: TRUNCATE + DROP COLUMN + ADD COLUMN nueva (mismo nombre, mismo tipo `Json`, semántica nueva).

**Tablas afectadas**:

- `Post.body Json?`
- `Comment.body Json` (NOT NULL)
- `Comment.quotedSnapshot Json?` (incluye `body` adentro)
- `Event.description Json?`

**Mapeo per-surface** (final):

| Surface             | Nodos                                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------------------- |
| Comment / respuesta | text, link, mention                                                                                             |
| Post (thread)       | text, mention, heading h1/h2/h3, bold, ordered list, bullet list, link, YouTube, Spotify, Apple Podcasts, Ivoox |
| Evento              | text, link, mention                                                                                             |
| Library item        | igual que post                                                                                                  |

Italic se aplica vía CSS al texto dentro de un link node (no es toggle del usuario, es estilo automático que comunica "interactivo").

**Mention polimórfico**: un solo `MentionNode` con campo discriminante `kind: 'user' | 'event' | 'library-item'`:

- Trigger `@` → autocompletar usuarios del place.
- Trigger `/event` → autocompletar eventos del place.
- Trigger `/library` → autocompletar two-step, primero categoría, después item dentro de la categoría (`/library/<categoria>/<item>`).

Click en mention navega al recurso. Si el target fue archivado/eliminado/no es públicamente visible al render, mostrar placeholder textual (`[EVENTO NO DISPONIBLE]`, `[RECURSO NO DISPONIBLE]`, `[CONVERSACIÓN NO DISPONIBLE]`). Snapshot del nombre original queda en el AST; lookup defensivo en el renderer.

**Feature flags por place**: nueva columna `Place.editorPluginsConfig: Json` (default todos `true`). Controla **creación**: el composer arma `nodes` + plugins condicional al config del place. NO afecta renderizado de contenido pre-existente (Opción A — semantica cozytech, sin censura retroactiva).

**Plugins / DecoratorNodes**: Lexical no publica YouTube/Spotify/Apple/Ivoox como packages oficiales. Los implementamos en el repo (slice `rich-text`) por analogía al `YouTubeNode` del playground oficial de Facebook. ~80 LOC por embed. URL parser → `iframe sandbox` con allowlist de host.

**CSP**: `next.config.ts` agrega a `frame-src` los hosts: `open.spotify.com`, `embed.podcasts.apple.com`, `www.ivoox.com` (YouTube ya está).

## Alternativas descartadas

### A. Mantener TipTap + split del barrel + lazy load del composer

Sólo recupera la mitad del beneficio: el split corta el barrel pollution pero no resuelve el schema monolítico (cualquier surface paga el costo de todas las extensiones del StarterKit). Además el composer dinámico por-place requiere armar extensiones manualmente y la API se vuelve tan custom que pierde el valor de StarterKit.

### B. Migrar a Lexical pero coexistir con TipTap renderer para data vieja

Razonable en producción con datos reales. En nuestro contexto (pre-prod, datos descartables) duplica complejidad sin beneficio: dos renderers, dos schemas Zod, dos paths de validación, dos sets de tests. Production-minded en este momento = limpieza completa.

### C. Reutilizar columna JSON sin DROP/ADD

Más simple operacionalmente pero deja la tabla con shape ambiguo si alguien restaura un dump viejo. DDL clean es production-grade hygiene incluso cuando la data se truncó.

### D. Renderer estricto que respeta feature flags retroactivos (Opción B)

Implicaría que un admin pueda "censurar" posts viejos al desactivar un plugin. Va contra el principio de Place: "las cosas que se dijeron, se dijeron" — sin gates retroactivos por cambios de configuración.

## Tradeoffs

**A favor**:

- Bundle por-surface: comments/eventos ~50–70 kB gzip vs ~150-180 kB con TipTap StarterKit. Posts/library ~110-130 kB. Ahorro neto −80 a −110 kB por surface en First Load JS.
- Feature flags por place idiomático (no workaround).
- Plugins lazy-loadables con `next/dynamic` (la doc oficial de Lexical lo confirma con `TableOfContentsPlugin`).
- API de Lexical (controlled state, commands, transforms) es más predecible para SSR.

**En contra**:

- Migración grande: 7 sub-fases, ~38 archivos tocados, 4 nuevos tipos de DecoratorNode a mantener.
- Sin packages oficiales para embeds — el código de YouTube/Spotify/Apple/Ivoox es nuestro.
- Drop de columnas es DDL irreversible. Mitigado: estamos en pre-prod, los datos son descartables, snapshot del DB pre-deploy en cloud dev antes de aplicar.
- Lexical es más joven que TipTap; ecosistema de plugins comunitarios más chico.

**Costo del cambio**: ~7 sesiones (F.0 docs, F.1 cleanup, F.2 foundation, F.3 base + comment, F.4 surfaces + embeds, F.5 flags, F.6 verificación).

## Irreversibilidad

- Drop de columnas JSON es **irreversible**: la data queda perdida.
- Drop de packages TipTap del lockfile es reversible (reinstalar) pero el código UI/domain ya no existe.
- Punto de no-retorno: aplicar la migration `<ts>_drop_rich_text_columns/migration.sql` en cloud dev. Antes de ese punto, el plan se puede abortar y revertir vía git.

## Validación

- Tests unitarios TDD para todo el slice `rich-text/`: schemas, size cap, snapshot, mention resolve.
- Tests de integración para los 4 composers (smoke render + envío de doc válido).
- E2E manual de 5 escenarios:
  1. Crear post con YouTube embed.
  2. Crear comment con `@user` mention.
  3. Crear evento con texto + link.
  4. Crear library item con embed Spotify.
  5. Admin desactiva Ivoox en `/settings/editor` → composer no ofrece el toggle Ivoox; posts pre-existentes con Ivoox siguen renderizando.
- Grep de cero residuos al cierre: `grep -rn "@tiptap\|RichTextDocument\|RichTextBlockNode\|frimousse" src/ tests/ docs/` = 0 hits no-historicos.

## Referencias

- Plan operacional: `docs/plans/2026-05-06-tiptap-to-lexical-migration.md`
- Spec del nuevo modelo: `docs/features/rich-text/spec.md`
- Doc oficial Lexical: <https://lexical.dev/docs/intro> (core 22 kB min+gzip, modular)
- Reference DecoratorNodes: <https://github.com/facebook/lexical/tree/main/packages/lexical-playground/src/nodes>
- ADRs predecedentes que esta decisión deja atrás:
  - `docs/decisions/2026-04-20-discussions-size-exception.md` (size cap se preserva, AST cambia)
  - `docs/decisions/2026-04-25-events-size-exception.md` (idem)
