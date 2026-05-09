/**
 * Superficie pública del sub-slice `rich-text/mentions`.
 *
 * Concentra el `MentionNode` (DecoratorNode polimórfico) + el plugin de
 * typeahead con los 3 triggers (`@`, `/event`, `/library`). Lo consumen los
 * composers (`composers/`) y el renderer (`renderer/`) del slice rich-text.
 *
 * Patrón heredado de `embeds/` (mismo cap 1500 LOC, ver
 * `docs/decisions/2026-04-21-flags-subslice-split.md`).
 */

export { MentionNode, $createMentionNode, $isMentionNode } from './ui/mention-node'
export type { MentionKind, MentionPayload } from './ui/mention-node'

export { MentionPlugin } from './ui/mention-plugin'
export type {
  ComposerMentionResolvers,
  MentionEventResult,
  MentionLibraryCategoryResult,
  MentionLibraryItemResult,
  MentionResolversForEditor,
  MentionUserResult,
} from './ui/mention-types'

// Prefetch background del typeahead. El Context vive acá (sub-slice del
// consumer); el Provider vive en `discussions/composers/`. Ver
// `docs/plans/2026-05-09-mention-prefetch-background.md` § D7-bis.
export { MentionPrefetchContext, useMentionPrefetchSource } from './ui/mention-prefetch-context'
export type { MentionPrefetchValue } from './ui/mention-prefetch-context'
