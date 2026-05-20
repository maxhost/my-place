import type { InboxPayload } from "../domain/inbox-payload";
import { EmptyState } from "./empty-state";
import type { InboxLabels } from "./inbox-labels";
import { PlaceCard } from "./place-card";

// Vista principal del Hub (S4 del Hub V1, `docs/features/inbox/spec.md`
// §"Lista de places"). Componente puro: recibe el `payload` ya resuelto
// (el page del Hub en S5 invoca `getInboxPayload(executor)` y lo pasa como
// prop — patrón seam-split del repo). Si no hay places → `<EmptyState />`;
// si hay → un `<PlaceCard />` por cada uno, respetando el orden del array
// (la stored function ya devuelve owner-first + alfabético, spec §"Orden V1";
// este componente NO re-ordena).
//
// El `<h1>` con `viewTitle` se renderea siempre (incluido el caso vacío) —
// estructura semántica del `<main>` consistente, independiente del estado de
// los datos.

type Props = {
  payload: InboxPayload;
  labels: InboxLabels;
  locale: string;
};

export function PlacesView({ payload, labels, locale }: Props) {
  const hasPlaces = payload.places.length > 0;

  return (
    <section className="mx-auto max-w-3xl px-4 py-6 md:px-6 md:py-8">
      <h1 className="mb-6 text-2xl font-medium text-ink">{labels.viewTitle}</h1>
      {hasPlaces ? (
        <ul className="flex flex-col gap-3">
          {payload.places.map((place) => (
            <li key={place.id}>
              <PlaceCard place={place} labels={labels} locale={locale} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState labels={labels} locale={locale} />
      )}
    </section>
  );
}
