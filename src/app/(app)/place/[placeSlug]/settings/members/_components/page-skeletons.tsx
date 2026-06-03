// Skeletons del page `/settings/members` (Phase 2.H.1). Fallback del
// `<Suspense>` que envuelve `<MembersContent />`: el shell + sidebar
// (`NavPlaceLayout`) pintan inmediato y esta silueta ocupa el contenido
// mientras resuelve el `await getAuthenticatedDbForRequest(...)` del child
// (architecture.md §"Streaming agresivo del shell").
//
// Reglas de estilo (CLAUDE.md §"Estilo de código" + architecture.md §222):
//   - Tailwind sólo para layout/spacing; el color de los bloques placeholder
//     usa el token `bg-border` (CSS custom property `--border`), nunca un hex
//     hardcodeado.
//   - Sin shimmer/pulse: cozytech, "nada parpadea". La silueta es estática.
//
// Dimensiones espejo del `<MembersPageShell />`: header row (tablist + CTA)
// + lista de filas (avatar + 2 líneas de texto). `role="status"` +
// `aria-busy` para que AT anuncie el estado de carga; `aria-label` en español
// (default del producto) — copy transitorio, no justifica keys i18n ×6.

/** Bloque placeholder neutro (color vía token `--border`). */
function Bar({ className }: { className: string }) {
  return <span className={`block rounded bg-border ${className}`} />;
}

/** Una fila de miembro: avatar circular + nombre + handle. */
function MemberRowSkeleton() {
  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-3 md:px-8">
      <span className="block size-10 shrink-0 rounded-full bg-border" />
      <div className="flex flex-1 flex-col gap-2">
        <Bar className="h-3.5 w-40 max-w-[60%]" />
        <Bar className="h-3 w-24 max-w-[40%]" />
      </div>
    </div>
  );
}

export function MembersSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <section
      role="status"
      aria-busy="true"
      aria-label="Cargando miembros"
      className="flex flex-col gap-4"
    >
      {/* Header row: 2 pills de tab + CTA invitar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4 md:px-8">
        <div className="flex flex-wrap gap-2">
          <Bar className="h-10 w-24" />
          <Bar className="h-10 w-28" />
        </div>
        <Bar className="h-10 w-36" />
      </div>

      {/* Lista de filas placeholder */}
      <div className="flex flex-col">
        {Array.from({ length: rows }).map((_, i) => (
          <MemberRowSkeleton key={i} />
        ))}
      </div>
    </section>
  );
}
