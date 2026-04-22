/**
 * Dot de novedad del post. Binario — sin contador. Renderiza sólo cuando el
 * caller decide que `hasUnread === true`. Color del producto: ámbar fijo en
 * `--place-unread` (no customizable, señal consistente entre places).
 */
export function PostUnreadDot(): React.ReactNode {
  return (
    <span
      aria-label="Hay novedad"
      role="status"
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={{ backgroundColor: 'var(--place-unread)' }}
    />
  )
}
