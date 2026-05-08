/**
 * Superficie pública del sub-slice `events/forms`.
 *
 * Sólo el `<EventForm>` — form full client-side que orquesta los
 * fields de evento (title, location, dates) + el body composer
 * (`<EventComposerWrapper>` desde `discussions/composers/public`).
 *
 * **Heavy import**: arrastra Lexical (~126 kB gzip) por la cadena
 * EventForm → EventComposerWrapper → EventComposer. Por eso vive
 * fuera del barrel raíz `events/public`. Sólo `/events/new` y
 * `/events/[id]/edit` lo importan eager (justified — la razón de la
 * page ES el form). Pages que sólo listan o muestran detalle de
 * evento usan `events/public` (lite, sin Lexical).
 *
 * Ver `docs/decisions/2026-05-08-sub-slice-cross-public.md`.
 */

export { EventForm } from '../ui/event-form'
