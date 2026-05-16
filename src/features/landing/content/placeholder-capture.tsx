/**
 * Placeholder de captura real del producto. La UI no está construida; donde
 * irían capturas reales van estos bloques claramente marcados (`[CAPTURA: …]`)
 * para reemplazo trivial cuando exista la UI (plan § Dirección de arte).
 *
 * No es <img>: es un bloque tipográfico/SVG sin requests extra (presupuesto
 * de bytes y requests del README). `alt` descriptivo vía aria-label.
 */
export function PlaceholderCapture({ label }: { label: string }) {
  return (
    <div
      role="img"
      aria-label={label}
      className="flex min-h-56 items-center justify-center rounded-xl border border-dashed border-border bg-surface p-8 md:min-h-72"
    >
      <p className="max-w-sm text-center text-sm leading-relaxed text-muted">
        {label}
      </p>
    </div>
  );
}
