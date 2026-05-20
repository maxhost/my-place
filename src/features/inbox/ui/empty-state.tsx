import { rootDomain } from "@/shared/lib/root-domain";
import type { InboxLabels } from "./inbox-labels";

// Empty state del Hub (S4 del Hub V1, `docs/features/inbox/spec.md` §"Estado
// vacío"). Se muestra cuando `payload.places` viene sin places (cuenta recién
// creada o sin places activos). Componente puro: 2 CTAs y un copy calmo.
//
// "Crear un lugar" lleva al apex (cross-subdomain: el user está en
// `app.place.community/{locale}/` y `/crear` sólo existe en `(marketing)`).
// El query `?from=hub` le avisa al wizard del apex que el user ya está
// autenticado (S5 lo cablea: salta el Paso 3 "cuenta" y va directo al wizard
// authed).
//
// "Sumarme a un lugar" es V1 disabled — el flujo de invitaciones por link
// (`features/README:75`) entra en Roadmap. Renderea con `aria-disabled="true"`
// + tooltip "Próximamente"; NO es un `<a>` para que un screen reader no lo
// anuncie como link navegable (consistencia con la sidebar del nav-hub).

type Props = {
  labels: InboxLabels;
  locale: string;
};

export function EmptyState({ labels, locale }: Props) {
  const createHref = `https://${rootDomain()}/${locale}/crear?from=hub`;

  return (
    <div className="flex flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <h2 className="text-xl font-medium text-ink">{labels.emptyTitle}</h2>
      <p className="max-w-md text-muted">{labels.emptyBody}</p>
      <div className="mt-2 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
        <a
          href={createHref}
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-accent-strong px-4 text-accent-ink hover:opacity-90"
        >
          {labels.emptyCreateAction}
        </a>
        <span
          aria-disabled="true"
          title={labels.emptyJoinComingSoon}
          className="inline-flex min-h-11 items-center justify-center rounded-md border border-border px-4 text-muted opacity-60"
        >
          {labels.emptyJoinAction}
        </span>
      </div>
    </div>
  );
}
