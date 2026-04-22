/**
 * Constantes/invariantes del slice `flags`.
 * Ver `docs/features/discussions/spec.md` § 10.
 */

/** `reasonNote` y `reviewNote` máximo en DB (VARCHAR 500). Spec § 10. */
export const FLAG_NOTE_MAX_LENGTH = 500

/** Page size default para la cola admin. */
export const FLAG_PAGE_SIZE = 20

/** Preview de texto plano en la cola admin. */
export const FLAG_PREVIEW_MAX_CHARS = 160
