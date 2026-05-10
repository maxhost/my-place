/**
 * API pública del sub-slice `discussions/presence/`.
 *
 * Tracking de "quién leyó qué y cuándo" — DwellTracker (medición de
 * tiempo en post), PostRead (marca persistida), ThreadPresence (avatares
 * en vivo via Realtime), PostReadersBlock (renderizado del set).
 */

export { DwellTracker } from './ui/dwell-tracker'
export { PostReadersBlock } from './ui/post-readers-block'
export { PostUnreadDot } from './ui/post-unread-dot'
export { ReaderStack } from './ui/reader-stack'

// Re-export del wrapper lazy bajo el nombre `ThreadPresence` (shape de props
// idéntico al componente real). El wrapper carga el chunk con Supabase
// Realtime + GoTrue (~12-15 kB gzip) post-FCP via `React.lazy` +
// `requestIdleCallback`. El componente real (`./ui/thread-presence`) NO se
// exporta por la pública — sólo se consume desde el wrapper. Ver
// `./ui/thread-presence-lazy.tsx`.
export { ThreadPresenceLazy as ThreadPresence } from './ui/thread-presence-lazy'

export { markPostReadAction } from './server/actions/reads'
