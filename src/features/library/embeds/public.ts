/**
 * API pública del sub-slice `library/embeds/`.
 *
 * Embeds = TipTap custom node para insertar referencias externas
 * (videos, docs, links) intercaladas en el body de un item de biblioteca.
 *
 * Boundary: cualquier consumer fuera de embeds/ (incluido el parent
 * `library/` raíz y siblings `items/` / `admin/`) importa SOLO desde
 * acá. Imports internos del sub-slice usan paths relativos.
 *
 * Plan: docs/plans/2026-05-04-library-root-sub-split-and-cap-enforcement.md
 * ADR:  docs/decisions/2026-05-04-library-root-sub-split.md
 */

// ---------------------------------------------------------------
// Domain — parser puro de URL → provider + metadata
// ---------------------------------------------------------------

export {
  EMBED_PROVIDERS,
  parseEmbedUrl,
  type EmbedProvider,
  type ParsedEmbed,
} from './domain/embed-parser'

// ---------------------------------------------------------------
// UI — stub F.1: TipTap extension + node-view + toolbar eliminados.
// F.4 reintroduce embeds como `DecoratorNode` Lexical desde el slice
// `rich-text/` (4 providers: YouTube, Spotify, Apple Podcasts, Ivoox).
// ---------------------------------------------------------------
