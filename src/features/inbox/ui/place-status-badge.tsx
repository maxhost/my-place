import type { PlaceStatus } from "../domain/inbox-payload";
import type { InboxLabels } from "./inbox-labels";

// Badge de status del place (S4 del Hub V1, `docs/features/inbox/spec.md`
// §"Badges + acciones por estado"). Componente puro: dado un `status` y los
// `labels` del slice, decide si pinta algo y con qué token de color.
//
// ACTIVE → null: el caso esperado no necesita marca visual (principio del
// producto: "nada grita"). Los otros 3 estados llevan badge con color
// codificado por dominio:
//
//   PAYMENT_PENDING       → bg-warn   (cálido, atención sin urgencia)
//   INACTIVATION_PROCESS  → bg-info   (frío, contención)
//   INACTIVE              → bg-muted  (gris, cerrado/inactivo)
//
// Sobre el color del texto: warn/info son tonos claros — text-ink (≈10:1 y
// ≈9:1, WCAG AAA holgado). bg-muted (#6b6a73) es gris medio — text-ink sólo
// da ≈3.2:1 (falla AA para text-xs); text-surface (blanco) da ≈5.3:1
// (cumple AA). Por eso el INACTIVE va con texto invertido — la decisión
// preserva el contraste sin tocar los tokens del producto.

type Props = {
  status: PlaceStatus;
  labels: InboxLabels;
};

const BASE =
  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium";

export function PlaceStatusBadge({ status, labels }: Props) {
  if (status === "ACTIVE") return null;

  if (status === "PAYMENT_PENDING") {
    return (
      <span className={`${BASE} bg-warn text-ink`}>
        {labels.statusPaymentPending}
      </span>
    );
  }

  if (status === "INACTIVATION_PROCESS") {
    return (
      <span className={`${BASE} bg-info text-ink`}>
        {labels.statusInactivationProcess}
      </span>
    );
  }

  // INACTIVE
  return (
    <span className={`${BASE} bg-muted text-surface`}>
      {labels.statusInactive}
    </span>
  );
}
