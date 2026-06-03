// Skeletons del page `/settings/domain` (Phase 2.H.1). Fallback del
// `<Suspense>` que envuelve `<DomainContent />`: el shell + sidebar pintan
// inmediato y esta silueta ocupa el contenido mientras resuelve el
// `await getCustomDomainStatus(...)` del child — el await más lento de los
// settings (SELECT + posible round-trip a la Vercel Domains API), así que es
// el caso testigo del streaming (architecture.md §"Streaming agresivo").
//
// Reglas de estilo (CLAUDE.md + architecture.md §222): Tailwind sólo
// layout/spacing; color de bloques placeholder vía token `bg-border`
// (`--border`), nunca hex. Sin shimmer/pulse (cozytech). `role="status"` +
// `aria-busy` + `aria-label` en español (copy transitorio, sin keys i18n).
//
// Dimensiones espejo del `<DomainSection>` (estado `none`/`pending`): header
// (título + descripción) + card con input + botón submit + tabla DNS.

/** Bloque placeholder neutro (color vía token `--border`). */
function Bar({ className }: { className: string }) {
  return <span className={`block rounded bg-border ${className}`} />;
}

export function DomainSkeleton() {
  return (
    <section
      role="status"
      aria-busy="true"
      aria-label="Cargando dominio"
      className="flex flex-1 flex-col gap-6 px-4 py-6 md:px-8 md:py-10"
    >
      {/* Header: título + 2 líneas de descripción */}
      <div className="flex flex-col gap-2">
        <Bar className="h-7 w-48" />
        <Bar className="h-4 w-full max-w-prose" />
        <Bar className="h-4 w-2/3 max-w-prose" />
      </div>

      {/* Card: label + input + botón */}
      <div className="flex max-w-md flex-col gap-3 rounded-lg border border-border p-4">
        <Bar className="h-3.5 w-28" />
        <Bar className="h-10 w-full" />
        <Bar className="h-10 w-40" />
      </div>

      {/* Placeholder de tabla DNS (3 filas) */}
      <div className="flex max-w-xl flex-col gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Bar key={i} className="h-9 w-full" />
        ))}
      </div>
    </section>
  );
}
