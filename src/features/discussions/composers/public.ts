/**
 * Superficie pública del sub-slice `discussions/composers`.
 *
 * Wrappers client-side que orquestan los Composers Lexical de
 * `@/features/rich-text/composers/public` con las Server Actions de
 * `discussions/server/actions/*`. Cada Wrapper resuelve typeahead `@`
 * + embeds enabled + submit handler y dispara `revalidatePath` desde
 * el server.
 *
 * **Heavy import**: cualquier consumer trae Lexical entero (~126 kB
 * gzip). Los pages que SÓLO listan o renderizan rich-text NO deben
 * importar de acá — usan `discussions/public.ts` (lite). Sólo las
 * pages de creación/edición (`/conversations/new`, `/events/new`,
 * `/events/[id]/edit`, `/library/.../new`, `/library/.../edit`)
 * importan de este sub-slice eager. El thread page carga el
 * `<CommentComposerForm>` lazy via `next/dynamic` desde
 * `<CommentComposerLazy>` (patrón Reddit).
 *
 * Ver `docs/decisions/2026-05-08-sub-slice-cross-public.md`.
 */

export { CommentComposerForm } from '../ui/comment-composer-form'
export { PostComposerWrapper } from '../ui/post-composer-form'
export { EventComposerWrapper } from '../ui/event-composer-form'
export { LibraryItemComposerForm } from '../ui/library-item-composer-form'
export type { LibraryItemComposerFormProps } from '../ui/library-item-composer-form'
