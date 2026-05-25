import type { ReactNode } from "react";

// Badge shared (Feature E S5, plan-sesiones.md §S5). Píldora presentacional
// pura con 4 variants — sin estado, sin handlers. Cada variant mapea a un
// token de color del producto (definidos en src/app/globals.css):
//
//   owner   → bg-accent / text-accent-ink  (CTA-color del place, identidad del
//                                           dueño; ink blanco por contraste)
//   founder → bg-warn   / text-ink         (cálido, distinción del miembro
//                                           temprano; sigue el mismo par que
//                                           PAYMENT_PENDING del Hub)
//   pending → bg-info   / text-ink         (frío, estado transitorio sin
//                                           urgencia; mismo par que
//                                           INACTIVATION_PROCESS del Hub)
//   expired → bg-muted  / text-surface     (gris medio: text-ink falla AA
//                                           sobre #6b6a73, por eso va con
//                                           texto invertido — mismo criterio
//                                           que INACTIVE en PlaceStatusBadge)
//
// El contract de TS exige `variant` (no hay default value): un Badge sin
// variant es siempre un bug del caller, no algo que el componente deba
// "elegir por nosotros".

export type BadgeVariant = "owner" | "founder" | "pending" | "expired";

type BadgeProps = {
  variant: BadgeVariant;
  children: ReactNode;
};

const BASE =
  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium";

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  owner: "bg-accent text-accent-ink",
  founder: "bg-warn text-ink",
  pending: "bg-info text-ink",
  expired: "bg-muted text-surface",
};

export function Badge({ variant, children }: BadgeProps) {
  return (
    <span className={`${BASE} ${VARIANT_CLASSES[variant]}`}>{children}</span>
  );
}
