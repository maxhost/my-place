import { computeInitials } from "@/shared/lib/initials";
import { rootDomain } from "@/shared/lib/root-domain";
import type { InboxPlace } from "../domain/inbox-payload";
import type { InboxLabels } from "./inbox-labels";
import { PlaceStatusBadge } from "./place-status-badge";

// Card del place en la vista "Tus lugares" del Hub (S4 del Hub V1,
// `docs/features/inbox/spec.md` §"Lista de places"). Componente puro: dado
// el `place` (un `InboxPlace` ya parseado del payload de la stored function)
// + `labels` + `locale`, decide la UX exacta del card según la matriz status
// × ownership:
//
//   ACTIVE  + owner   → "Entrar" + "Configurar" + sin atenuar
//   ACTIVE  + member  → sólo "Entrar"           + sin atenuar
//   resto                → 0 botones                + opacity-60 + badge de estado
//
// "Por qué no mostrar acciones disabled" (spec §G4): un botón disabled
// invita a clickearlo y frustra. Ocultarlo evita la promesa rota — el badge
// cuenta el estado, no la afford-ance.
//
// Detalles:
//
// - El subdomain canónico se construye con `rootDomain()` (`shared/lib`).
//   Custom domains se ignoran en V1 (spec §"Fuera de V1") — siempre
//   `{slug}.place.community`.
// - El cuadrado del card usa `themeAccent` inline (`style.backgroundColor`)
//   — es runtime, custom por place. `null` → fallback con clase `bg-accent`
//   del producto. Iniciales en `text-accent-ink` (blanco, contrasta sobre
//   cualquier acento del producto y la mayoría de los hex del owner; los
//   contraste-bajos se mitigan en el wizard via `guardrailNotice`).
// - "Miembro desde {date}" se rellena con `Intl.DateTimeFormat(locale, …)` —
//   formato "long month + numeric year" (e.g. "marzo de 2024" en es).
// - Links externos abren en nueva pestaña (`target="_blank"
//   rel="noopener noreferrer"`): el Hub queda abierto en la pestaña
//   original — el user puede volver a saltar a otro lugar sin reload.

type Props = {
  place: InboxPlace;
  labels: InboxLabels;
  locale: string;
};

export function PlaceCard({ place, labels, locale }: Props) {
  const initials = computeInitials(place.name) ?? "?";
  const subdomain = `${place.slug}.${rootDomain()}`;
  const baseUrl = `https://${subdomain}`;
  const isActive = place.status === "ACTIVE";

  const memberSinceFormatted = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
  }).format(place.memberSince);
  const memberSinceText = labels.cardMemberSince.replace(
    "{date}",
    memberSinceFormatted,
  );

  const containerClass = [
    "flex items-start gap-4 rounded-lg border border-border bg-surface p-4",
    isActive ? "" : "opacity-60",
  ]
    .filter(Boolean)
    .join(" ");

  const squareStyle = place.themeAccent
    ? { backgroundColor: place.themeAccent }
    : undefined;
  const squareClass = [
    "flex h-12 w-12 shrink-0 items-center justify-center rounded-md text-accent-ink font-medium md:h-16 md:w-16",
    place.themeAccent ? "" : "bg-accent",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article className={containerClass}>
      <div
        data-testid="place-square"
        className={squareClass}
        style={squareStyle}
        aria-hidden="true"
      >
        {initials}
      </div>
      <div className="flex flex-1 flex-col gap-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-medium text-ink">{place.name}</h3>
          <PlaceStatusBadge status={place.status} labels={labels} />
        </div>
        <p className="text-sm text-muted truncate">{subdomain}</p>
        <p className="text-xs text-muted">{memberSinceText}</p>
        {isActive && (
          <div className="mt-2 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
            <a
              href={`${baseUrl}/`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center justify-center rounded-md bg-accent-strong px-4 text-accent-ink hover:opacity-90"
            >
              {labels.cardEnter}
            </a>
            {place.isOwner && (
              <a
                href={`${baseUrl}/settings`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center justify-center rounded-md border border-border px-4 text-ink hover:bg-bg"
              >
                {labels.cardSettings}
              </a>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
