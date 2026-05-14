import type { FlagView } from '@/features/flags/public'

/**
 * Labels en español + clases Tailwind para los chips visuales del sub-slice
 * `flags/admin`. Consumido por `<FlagRow>`, `<FlagDetailPanel>` y los empty
 * states del orchestrator.
 *
 * Single source of truth — antes vivían duplicados en row y detail panel.
 * Si el dominio agrega un nuevo `FlagReason` / `ContentTargetKind`, TS
 * fuerza la actualización acá (Record exhaustivo).
 */

export const REASON_LABEL: Record<FlagView['reason'], string> = {
  SPAM: 'Spam',
  HARASSMENT: 'Acoso',
  OFFTOPIC: 'Fuera de tema',
  MISINFO: 'Desinformación',
  OTHER: 'Otro',
}

export const CONTENT_STATUS_LABEL: Record<FlagView['contentStatus'], string> = {
  VISIBLE: 'visible',
  HIDDEN: 'oculto',
  DELETED: 'eliminado',
}

export const CONTENT_STATUS_CLASSES: Record<FlagView['contentStatus'], string> = {
  VISIBLE: 'border-neutral-300 text-neutral-600',
  HIDDEN: 'border-amber-300 bg-amber-50 text-amber-700',
  DELETED: 'border-red-300 bg-red-50 text-red-700',
}

export const TARGET_TYPE_LABEL: Record<FlagView['targetType'], string> = {
  POST: 'post',
  COMMENT: 'comentario',
  EVENT: 'evento',
}
