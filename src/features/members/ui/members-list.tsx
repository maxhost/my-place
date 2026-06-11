"use client";

import Image from "next/image";
import type { ReactNode } from "react";

import { Badge } from "@/shared/ui/badge";

import { getMemberRole, type Member } from "../types";

// `<MembersList />` — Feature E V1 §S10 (spec.md §"UI screens", tests.md §S10).
// Lista presentacional pura de memberships activas. Consume `Member[]` de
// `loadMembers` (S6). El page S11 inyecta el array.
//
// **Post S10.9 (ADR-0043)**: la lista YA NO compone `<MemberRowActionsMenu />`
// internamente. Adopta el patrón render-prop: el page-level co-located
// `<MemberRowActionsMenu />` (vive en `src/app/.../settings/members/_components/`)
// se inyecta vía `renderRowActions={(member) => <MemberRowActionsMenu ... />}`.
// Razón: el menú ensamblaba 2 slices (`members/` + `place-ownership-actions/`,
// este último eliminado por ADR-0054; hoy el menú es remover-only)
// y su composición es naturalmente trabajo del page; mover la wiring a
// page-level libera ~553 LOC del slice `members/` (cerró el gap restante
// post-S10.6/S10.7/S10.8 sin romper el cap heurístico ≤1500).
//
// **Avatar**: render `<Image unoptimized>` cuando `avatarUrl != null`;
// fallback `<span>` con inicial cuando null. Decorativo (`aria-hidden="true"`)
// — el `displayName` es la SoT de identidad accesible. `unoptimized` evita
// requerir `images.remotePatterns` config (los avatares vienen de hosts
// arbitrarios — un wildcard pattern derrota el purpose del whitelist).
// Beneficio del Image component acá vs `<img>`: lazy loading + warning del
// linter resuelto. Para 40×40px la optimization de Next es marginal.
//
// **Headline**: render condicional ADR-0036 §1 (sin placeholder pasivo;
// si `headline == null`, el bloque entero NO aparece).
//
// **Badge**: derivado de `getMemberRole(member)` — founder y owner muestran
// badge; miembro común sin badge. La derivación es pura (fail-loud sobre
// invariantes violados — ADR-0035 §2).
//
// **i18n**: strings ES hardcoded via `labels`. Extracción a
// `t('placeMembers.*')` diferida a S11 (plan-sesiones §S11).

export interface MembersListLabels {
  emptyTitle: string;
  emptyDescription: string;
  badgeFounder: string;
  badgeOwner: string;
}

function avatarInitial(displayName: string): string {
  const first = displayName.trim().charAt(0);
  return first ? first.toUpperCase() : "?";
}

export function MembersList({
  members,
  labels,
  renderRowActions,
}: {
  members: Member[];
  labels: MembersListLabels;
  /**
   * Render-prop opcional para el slot de acciones por fila. El page S11
   * inyecta `(member) => <MemberRowActionsMenu member={member} ... />` desde
   * el componente page-level co-located (ADR-0043). Ausente → la lista no
   * renderiza nada en el slot (legítimo para vistas de sólo-lectura V1.1+).
   */
  renderRowActions?: (member: Member) => ReactNode;
}) {
  if (members.length === 0) {
    return (
      <section className="flex flex-col gap-2 px-4 py-6 md:px-8">
        <h3 className="text-base font-medium text-ink">{labels.emptyTitle}</h3>
        <p className="text-sm text-muted">{labels.emptyDescription}</p>
      </section>
    );
  }

  return (
    <section className="px-4 py-6 md:px-8">
      <ul className="flex flex-col gap-3">
        {members.map((member) => {
          const role = getMemberRole(member);
          return (
            <li
              key={member.userId}
              className="flex items-start justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3"
            >
              <div className="flex flex-1 items-start gap-3">
                {member.avatarUrl !== null ? (
                  <Image
                    src={member.avatarUrl}
                    alt=""
                    aria-hidden="true"
                    width={40}
                    height={40}
                    unoptimized
                    className="h-10 w-10 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-bg text-sm font-medium text-ink"
                  >
                    {avatarInitial(member.displayName)}
                  </span>
                )}
                <div className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-ink">
                      {member.displayName}
                    </span>
                    <span className="text-xs text-muted">@{member.handle}</span>
                    {role === "founder" && (
                      <Badge variant="founder">{labels.badgeFounder}</Badge>
                    )}
                    {role === "owner" && (
                      <Badge variant="owner">{labels.badgeOwner}</Badge>
                    )}
                  </div>
                  {member.headline !== null && (
                    <p className="text-sm text-muted">{member.headline}</p>
                  )}
                </div>
              </div>
              {renderRowActions?.(member)}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
